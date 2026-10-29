import { Injectable, Logger } from "@nestjs/common";
import {
  AI_INCLUDED_MODEL,
  includedAiCapUsd,
  planFor,
  type AiIncluded,
  type AiStatus,
  type AiSettingsDto,
  type ApiKeyState,
  type LlmProviderName,
  type UpdateAiSettingsInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { tenancyMode } from "../../infra/tenant/tenant.context";
import { env } from "../../common/utils/env";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "../../common/utils/secret-box";
import { AiUsageService, nextMonthStart } from "./ai-usage.service";

// Credenciales ya resueltas (BD con respaldo del entorno) para una llamada.
export interface ResolvedCredentials {
  provider: Exclude<LlmProviderName, "auto">;
  apiKey: string | null;
  model: string;
  baseUrl: string | null;
  /**
   * Es la IA de Driony (cupo del plan): el modelo es fijo y no se acepta otro
   * ni otra URL base, que mandaría la clave de Driony a un servidor ajeno.
   */
  included?: boolean;
}

interface KeySource {
  key: string | null;
  source: ApiKeyState["source"];
}

/**
 * Fuente de verdad de qué proveedor de IA se usa y con qué credencial.
 * Prioridad para cada key: la guardada en BD (cifrada) y, si no hay, la
 * variable de entorno. Así el .env sigue funcionando sin configurar nada.
 *
 * En SaaS el .env es de la **plataforma**, no de la empresa: cada empresa
 * pone su propia key en Ajustes › IA y paga su consumo a su proveedor. Las
 * keys del entorno solo se prestan si el operador lo decide
 * (`AI_SHARED_KEYS=true`), y aun así el tope mensual por agente sigue
 * aplicando. Sin key y sin préstamo, el proveedor es "fake": el agente no
 * responde, y la UI lo dice en vez de simular.
 *
 * IA de Driony (AI_INCLUDED=true): a una empresa sin clave propia se le presta
 * la clave de OpenAI de la plataforma con el modelo fijo AI_INCLUDED_MODEL y
 * un cupo de conversaciones al mes según su plan, más un tope en dólares. Es
 * siempre el último recurso: si la empresa tiene una clave, se usa la suya.
 * Con el cupo lleno, el agente termina las conversaciones que ya atendía y las
 * nuevas pasan al equipo (lo decide allowsConversation). Con el tope en
 * dólares alcanzado, la clave deja de prestarse salvo para indexar el
 * conocimiento: si no, los documentos nuevos quedarían indexados con el
 * simulado y la búsqueda no los encontraría al volver el cupo.
 *
 * Se cachea unos segundos para no golpear la BD en cada llamada al LLM;
 * al guardar desde Ajustes la caché se invalida al instante.
 */
@Injectable()
export class AiSettingsService {
  /** Con una sola empresa el .env es suyo; en SaaS, solo si el operador comparte sus keys. */
  static platformKeysShared(): boolean {
    return tenancyMode !== "multi" || env("AI_SHARED_KEYS") === "true";
  }

  /**
   * La IA de Driony está encendida: SaaS, el operador la activó y hay clave de
   * la plataforma. AI_INCLUDED=false es el interruptor de emergencia.
   */
  static includedEnabled(): boolean {
    return (
      tenancyMode === "multi" &&
      !AiSettingsService.platformKeysShared() &&
      env("AI_INCLUDED") === "true" &&
      !!env("OPENAI_API_KEY")
    );
  }

  private readonly logger = new Logger("AiSettings");
  // Caché por organización. Una sola entrada global serviría la configuración
  // de una empresa a otra en cuanto haya más de una.
  private cache = new Map<string, { row: SettingsRow; at: number }>();
  // Uso de la IA incluida por empresa, con la misma caché corta: el cupo
  // puede pasarse por unas pocas llamadas, a cambio de no contar en cada una.
  private includedCache = new Map<string, { value: AiIncluded | null; at: number }>();
  private static readonly TTL_MS = 15_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly usage: AiUsageService,
  ) {}

  // ── Lectura para la UI (nunca devuelve keys en claro) ───────
  async getSettings(): Promise<AiSettingsDto> {
    const row = await this.load();
    const openai = this.keyFor("openai", row);
    const anthropic = this.keyFor("anthropic", row);
    const own = this.resolveFrom(row, openai, anthropic);
    const included = await this.included();
    const active = own.apiKey || row.provider === "fake" ? own : this.includedCreds(included) ?? own;

    return {
      provider: row.provider as LlmProviderName,
      openaiModel: row.openaiModel,
      anthropicModel: row.anthropicModel,
      openaiBaseUrl: row.openaiBaseUrl,
      openaiKey: this.toState(openai),
      anthropicKey: this.toState(anthropic),
      activeProvider: active.provider,
      activeModel: active.model,
      saas: tenancyMode === "multi",
      platformKeys: AiSettingsService.platformKeysShared(),
      included,
    };
  }

  async updateSettings(input: UpdateAiSettingsInput): Promise<AiSettingsDto> {
    await this.load(); // garantiza que la fila existe
    const data: Record<string, unknown> = {};

    if (input.provider !== undefined) data.provider = input.provider;
    if (input.openaiModel !== undefined) data.openaiModel = input.openaiModel;
    if (input.anthropicModel !== undefined) {
      data.anthropicModel = input.anthropicModel;
    }
    if (input.openaiBaseUrl !== undefined) {
      data.openaiBaseUrl = input.openaiBaseUrl?.trim() || null;
    }
    // Cadena vacía = borrar la key de la BD y volver a la del entorno.
    if (input.openaiKey !== undefined) {
      data.openaiKeyEnc = input.openaiKey.trim()
        ? encryptSecret(input.openaiKey.trim())
        : null;
    }
    if (input.anthropicKey !== undefined) {
      data.anthropicKeyEnc = input.anthropicKey.trim()
        ? encryptSecret(input.anthropicKey.trim())
        : null;
    }

    const orgId = this.tenant.orgId();
    await this.prisma.aiSetting.update({ where: { orgId }, data });
    this.cache.delete(orgId);
    this.usage.invalidate(orgId);
    return this.getSettings();
  }

  // ── Resolución para los adaptadores de LLM ──────────────────
  async resolve(): Promise<ResolvedCredentials> {
    const row = await this.load();
    const own = this.resolveFrom(
      row,
      this.keyFor("openai", row),
      this.keyFor("anthropic", row),
    );
    // "Simulado" elegido a mano se respeta; si no, sin clave propia, la de Driony.
    if (own.apiKey || row.provider === "fake") return own;
    return this.includedCreds(await this.included()) ?? own;
  }

  /**
   * Si la IA está lista para esta empresa, y con la clave de quién. Lo usan el
   * copiloto y la interfaz para no ofrecer lo que no va a funcionar.
   */
  async status(): Promise<AiStatus> {
    const row = await this.load();
    const openai = this.keyFor("openai", row);
    const anthropic = this.keyFor("anthropic", row);
    const own = this.resolveFrom(row, openai, anthropic);
    const used = own.provider === "openai" ? openai : own.provider === "anthropic" ? anthropic : null;
    const included = await this.included();
    const viaIncluded = !own.apiKey && row.provider !== "fake" ? this.includedCreds(included) : null;
    const active = viaIncluded ?? own;
    return {
      ready: active.provider !== "fake" && !!active.apiKey,
      provider: active.provider,
      model: active.model,
      source: viaIncluded ? "included" : !used?.key ? "none" : used.source === "db" ? "own" : "platform",
      saas: tenancyMode === "multi",
      included,
    };
  }

  // Credenciales de un proveedor concreto (para "Probar conexión").
  async resolveFor(
    provider: Exclude<LlmProviderName, "auto">,
    opts: { purpose?: "embeddings" } = {},
  ): Promise<ResolvedCredentials> {
    const row = await this.load();
    if (provider === "fake") {
      return { provider: "fake", apiKey: null, model: "fake", baseUrl: null };
    }
    if (provider === "openai") {
      const key = this.keyFor("openai", row).key;
      if (!key) {
        const included = this.includedCreds(await this.included(), opts.purpose === "embeddings");
        if (included) return included;
      }
      return {
        provider: "openai",
        apiKey: key,
        model: row.openaiModel,
        baseUrl: row.openaiBaseUrl,
      };
    }
    return {
      provider: "anthropic",
      apiKey: this.keyFor("anthropic", row).key,
      model: row.anthropicModel,
      baseUrl: null,
    };
  }

  invalidate(): void {
    const orgId = this.tenant.orgId();
    this.cache.delete(orgId);
    this.includedCache.delete(orgId);
    this.usage.invalidate(orgId);
  }

  /**
   * Cupo y gasto de la IA de Driony este mes, o null si la empresa no puede
   * usarla (apagada, instalación propia o plan sin cupo).
   */
  async included(): Promise<AiIncluded | null> {
    if (!AiSettingsService.includedEnabled()) return null;
    const orgId = this.tenant.orgId();
    const now = Date.now();
    const hit = this.includedCache.get(orgId);
    if (hit && now - hit.at < AiSettingsService.TTL_MS) return hit.value;

    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
    const limit = planFor(org?.plan).aiConversations;
    let value: AiIncluded | null = null;
    if (limit !== null && limit > 0) {
      const used = await this.usage.includedUsage(orgId);
      const capUsd = includedAiCapUsd(limit);
      value = {
        conversations: used.conversations,
        limit,
        costUsd: used.costUsd,
        capUsd,
        full: used.conversations >= limit,
        exhausted: used.costUsd >= capUsd,
        resetsAt: nextMonthStart().toISOString(),
      };
      if ((value.full && !hit?.value?.full) || (value.exhausted && !hit?.value?.exhausted)) {
        this.logger.warn(
          `IA incluida ${value.exhausted ? "al tope de gasto" : "con el cupo lleno"} en ${orgId}: ${used.conversations}/${limit} conversaciones, US$${used.costUsd.toFixed(2)}/${capUsd.toFixed(2)}`,
        );
      }
    }
    this.includedCache.set(orgId, { value, at: now });
    return value;
  }

  /**
   * ¿Puede el agente atender esta conversación? Siempre con clave propia; con
   * la IA de Driony y el cupo lleno, solo si ya la atendía este mes (así nadie
   * se queda a medias y lo nuevo pasa al equipo).
   */
  async allowsConversation(conversationId: string): Promise<boolean> {
    const creds = await this.resolve();
    if (!creds.included) return true;
    const included = await this.included();
    if (!included?.full) return true;
    return this.usage.countedThisMonth(this.tenant.orgId(), conversationId);
  }

  // Credenciales de la IA de Driony si queda dinero del tope (o, para indexar
  // el conocimiento, mientras la empresa tenga IA incluida en su plan).
  private includedCreds(included: AiIncluded | null, evenIfExhausted = false): ResolvedCredentials | null {
    if (!included || (included.exhausted && !evenIfExhausted)) return null;
    const apiKey = env("OPENAI_API_KEY");
    if (!apiKey) return null;
    return {
      provider: "openai",
      apiKey,
      model: env("AI_INCLUDED_MODEL") ?? AI_INCLUDED_MODEL,
      baseUrl: null,
      included: true,
    };
  }

  // ── Internos ────────────────────────────────────────────────
  private resolveFrom(
    row: SettingsRow,
    openai: KeySource,
    anthropic: KeySource,
  ): ResolvedCredentials {
    const forced = row.provider as LlmProviderName;

    if (forced === "openai") {
      return {
        provider: "openai",
        apiKey: openai.key,
        model: row.openaiModel,
        baseUrl: row.openaiBaseUrl,
      };
    }
    if (forced === "anthropic") {
      return {
        provider: "anthropic",
        apiKey: anthropic.key,
        model: row.anthropicModel,
        baseUrl: null,
      };
    }
    if (forced === "fake") {
      return { provider: "fake", apiKey: null, model: "fake", baseUrl: null };
    }

    // "auto": el primero que tenga credencial.
    if (openai.key) {
      return {
        provider: "openai",
        apiKey: openai.key,
        model: row.openaiModel,
        baseUrl: row.openaiBaseUrl,
      };
    }
    if (anthropic.key) {
      return {
        provider: "anthropic",
        apiKey: anthropic.key,
        model: row.anthropicModel,
        baseUrl: null,
      };
    }
    return { provider: "fake", apiKey: null, model: "fake", baseUrl: null };
  }

  private keyFor(which: "openai" | "anthropic", row: SettingsRow): KeySource {
    const enc = which === "openai" ? row.openaiKeyEnc : row.anthropicKeyEnc;
    if (enc) {
      const plain = decryptSecret(enc);
      if (plain) return { key: plain, source: "db" };
      this.logger.warn(
        `No se pudo descifrar la key de ${which} (¿cambió APP_ENCRYPTION_KEY?). Se usa el entorno.`,
      );
    }
    // En SaaS la variable de entorno es la key de la plataforma: no se
    // presta a las empresas salvo que el operador lo haya pedido.
    if (!AiSettingsService.platformKeysShared()) return { key: null, source: "none" };
    const fromEnv =
      which === "openai" ? env("OPENAI_API_KEY") : env("ANTHROPIC_API_KEY");
    if (fromEnv) return { key: fromEnv, source: "env" };
    return { key: null, source: "none" };
  }

  private toState(src: KeySource): ApiKeyState {
    return {
      configured: !!src.key,
      source: src.source,
      masked: src.key ? maskSecret(src.key) : null,
    };
  }

  private async load(): Promise<SettingsRow> {
    const orgId = this.tenant.orgId();
    const now = Date.now();
    const hit = this.cache.get(orgId);
    if (hit && now - hit.at < AiSettingsService.TTL_MS) {
      return hit.row;
    }
    const row = await this.prisma.aiSetting.upsert({
      where: { orgId },
      create: { orgId },
      update: {},
    });
    this.cache.set(orgId, { row, at: now });
    return row;
  }
}

type SettingsRow = {
  provider: string;
  openaiKeyEnc: string | null;
  anthropicKeyEnc: string | null;
  openaiModel: string;
  anthropicModel: string;
  openaiBaseUrl: string | null;
};
