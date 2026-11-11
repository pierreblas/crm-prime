import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  AI_INCLUDED_MODEL,
  AI_GRACE,
  aiIncludedTotal,
  includedAiCapUsd,
  effectivePlan,
  type OrgAiBillingMode,
  type AiCredentialStatus,
  type AiIncluded,
  type AiSettingEventAction,
  type AiSettingEventDto,
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
import { credentialStatusFromError, normalizeProviderBaseUrl } from "./ai-http";
import { AiUsageService, nextMonthStart } from "./ai-usage.service";
import { AiPacksService } from "./ai-packs.service";

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
  /**
   * Quién paga esta llamada. Sale de la credencial elegida, nunca se infiere
   * después: MANAGED con la clave de la plataforma, BYOK con la de la empresa.
   * El registro de consumo lo copia tal cual.
   */
  billingMode: OrgAiBillingMode;
  /** Lo que se sabe de la clave propia (solo cuando la credencial es suya). */
  credentialStatus?: AiCredentialStatus;
}

interface KeySource {
  key: string | null;
  source: ApiKeyState["source"];
}

interface PendingEvent {
  action: AiSettingEventAction;
  provider: "openai" | "anthropic" | null;
  details: Record<string, unknown>;
}

/** Resultado de «Probar conexión», para dejarlo en el historial y en el estado de la clave. */
export interface ConnectionTestOutcome {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  /** Se probó la IA de Driony, no la clave de la empresa: el estado de su clave no cambia. */
  included: boolean;
  error?: unknown;
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
 * Con el cupo lleno, cada conversación nueva gasta una de sus conversaciones
 * extra (paquetes, AiPacksService); sin extra, el agente termina las que ya
 * atendía y las nuevas pasan al equipo (lo decide allowsConversation). Con el tope en
 * dólares alcanzado, la clave deja de prestarse salvo para indexar el
 * conocimiento: si no, los documentos nuevos quedarían indexados con el
 * simulado y la búsqueda no los encontraría al volver el cupo.
 *
 * Modalidad (`billingMode`): una por empresa, MANAGED o BYOK. Hoy sigue a la
 * clave (guardar una pasa a BYOK, borrarla vuelve a MANAGED) y cada cambio
 * queda en `ai_setting_events` con quién lo hizo. Una empresa BYOK sin clave
 * utilizable (cifrado roto, clave borrada) NO vuelve sola a la IA de Driony:
 * el agente para con «Falta la clave de IA» hasta que alguien decida.
 *
 * Facturación mixta, declarada: lo que solo OpenAI hace (audio, visión,
 * embeddings) corre con la IA de Driony si la empresa no tiene clave de OpenAI
 * aunque tenga la de Anthropic, dentro de su tope en dólares. Está escrito en
 * la documentación de planes.
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
    private readonly packs: AiPacksService,
  ) {}

  // ── Lectura para la UI (nunca devuelve keys en claro) ───────
  async getSettings(): Promise<AiSettingsDto> {
    const row = await this.load();
    const openai = this.keyFor("openai", row);
    const anthropic = this.keyFor("anthropic", row);
    const own = this.resolveFrom(row, openai, anthropic);
    const included = await this.included();
    const active = own.apiKey || row.provider === "fake" ? own : this.includedCreds(included) ?? own;
    const updatedBy = row.updatedBy ? await this.userRef(row.updatedBy) : null;

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
      billingMode: modeOf(row),
      credentialStatus: statusOf(row),
      validatedAt: row.validatedAt?.toISOString() ?? null,
      rotatedAt: row.rotatedAt?.toISOString() ?? null,
      updatedBy,
    };
  }

  /**
   * Guarda los ajustes y deja en el historial lo que cambió: clave guardada,
   * cambiada o borrada (solo sus últimos caracteres), modalidad, proveedor,
   * modelos y URL base. La modalidad sigue a la clave: con alguna clave
   * guardada la empresa es BYOK; sin ninguna, MANAGED.
   */
  async updateSettings(input: UpdateAiSettingsInput, actorId?: string): Promise<AiSettingsDto> {
    const before = await this.load(true);
    const data: Record<string, unknown> = {};
    const events: PendingEvent[] = [];

    // Proveedor, modelos y URL base: un solo evento con lo que cambió.
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    if (input.provider !== undefined && input.provider !== before.provider) {
      data.provider = input.provider;
      changed.provider = { from: before.provider, to: input.provider };
    }
    if (input.openaiModel !== undefined && input.openaiModel !== before.openaiModel) {
      data.openaiModel = input.openaiModel;
      changed.openaiModel = { from: before.openaiModel, to: input.openaiModel };
    }
    if (input.anthropicModel !== undefined && input.anthropicModel !== before.anthropicModel) {
      data.anthropicModel = input.anthropicModel;
      changed.anthropicModel = { from: before.anthropicModel, to: input.anthropicModel };
    }
    if (input.openaiBaseUrl !== undefined) {
      let url: string | null = null;
      if (input.openaiBaseUrl?.trim()) {
        try {
          url = normalizeProviderBaseUrl(input.openaiBaseUrl);
        } catch (e) {
          throw new BadRequestException((e as Error).message);
        }
      }
      if (url !== before.openaiBaseUrl) {
        data.openaiBaseUrl = url;
        changed.openaiBaseUrl = { from: hostOnly(before.openaiBaseUrl), to: hostOnly(url) };
      }
    }
    if (Object.keys(changed).length) events.push({ action: "settings_changed", provider: null, details: changed });

    // Claves: cadena vacía = borrar la key de la BD y volver a la del entorno.
    let rotated = false;
    for (const which of ["openai", "anthropic"] as const) {
      const incoming = which === "openai" ? input.openaiKey : input.anthropicKey;
      if (incoming === undefined) continue;
      const column = which === "openai" ? "openaiKeyEnc" : "anthropicKeyEnc";
      const next = incoming.trim() || null;
      const prevEnc = before[column];
      const prev = prevEnc ? decryptSecret(prevEnc) : null;
      if (next) {
        if (prevEnc && prev === next) continue; // la misma clave otra vez: nada que hacer
        data[column] = encryptSecret(next);
        rotated = true;
        events.push({
          action: prevEnc ? "key_rotated" : "key_set",
          provider: which,
          details: { masked: maskSecret(next) },
        });
      } else if (prevEnc) {
        data[column] = null;
        events.push({ action: "key_revoked", provider: which, details: { masked: prev ? maskSecret(prev) : null } });
      }
    }

    // La modalidad sigue a la clave, y el cambio queda escrito.
    const keyAfter = (c: "openaiKeyEnc" | "anthropicKeyEnc") => (c in data ? data[c] : before[c]);
    const hasKey = !!(keyAfter("openaiKeyEnc") || keyAfter("anthropicKeyEnc"));
    const hadKey = !!(before.openaiKeyEnc || before.anthropicKeyEnc);
    const modeBefore = modeOf(before);
    const modeAfter: OrgAiBillingMode = hasKey ? "BYOK" : "MANAGED";
    if (modeAfter !== modeBefore) {
      data.billingMode = modeAfter;
      events.push({
        action: "mode_changed",
        provider: null,
        details: { from: modeBefore, to: modeAfter, reason: hasKey ? "key_set" : "key_revoked" },
      });
    }
    if (rotated) {
      data.credentialStatus = "untested";
      data.rotatedAt = new Date();
    } else if (hadKey && !hasKey) {
      data.credentialStatus = "revoked";
    }

    const orgId = this.tenant.orgId();
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (Object.keys(data).length) {
      if (actorId) data.updatedBy = actorId;
      ops.push(this.prisma.aiSetting.update({ where: { orgId }, data }));
    }
    if (events.length) ops.push(this.eventsInsert(orgId, events, actorId));
    if (ops.length) await this.prisma.$transaction(ops);

    this.cache.delete(orgId);
    this.includedCache.delete(orgId);
    return this.getSettings();
  }

  /**
   * «Probar conexión» deja huella: el evento siempre y, si se probó la clave de
   * la empresa, su estado (valid; o invalid/exhausted si el proveedor la
   * rechazó o no tiene cuota). Un fallo de red no dice nada de la clave.
   */
  async recordTest(outcome: ConnectionTestOutcome, actorId?: string): Promise<void> {
    const orgId = this.tenant.orgId();
    const data: Record<string, unknown> = {};
    if (!outcome.included && outcome.provider !== "fake") {
      if (outcome.ok) {
        data.credentialStatus = "valid";
        data.validatedAt = new Date();
      } else {
        const status = credentialStatusFromError(outcome.error);
        if (status) data.credentialStatus = status;
      }
    }
    const errorText = outcome.error ? String((outcome.error as Error).message ?? outcome.error).slice(0, 200) : null;
    const details: Record<string, unknown> = {
      model: outcome.model,
      latencyMs: outcome.latencyMs,
      included: outcome.included,
      ...(errorText ? { error: errorText } : {}),
    };
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.eventsInsert(orgId, [{ action: outcome.ok ? "test_ok" : "test_failed", provider: providerOrNull(outcome.provider), details }], actorId),
    ];
    if (Object.keys(data).length) ops.unshift(this.prisma.aiSetting.update({ where: { orgId }, data }));
    await this.prisma.$transaction(ops);
    this.cache.delete(orgId);
  }

  /** Los últimos cambios de los ajustes de IA de la empresa, con quién los hizo. */
  async events(limit = 30): Promise<AiSettingEventDto[]> {
    const orgId = this.tenant.orgId();
    const rows = await this.prisma.aiSettingEvent.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const ids = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
      : [];
    const byId = new Map(users.map((u) => [u.id, { id: u.id, name: u.name || u.email }]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action as AiSettingEventAction,
      provider: r.provider,
      details: (r.details ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
      user: r.userId ? byId.get(r.userId) ?? null : null,
    }));
  }

  // ── Resolución para los adaptadores de LLM ──────────────────
  async resolve(): Promise<ResolvedCredentials> {
    const row = await this.load();
    const own = this.resolveFrom(
      row,
      this.keyFor("openai", row),
      this.keyFor("anthropic", row),
    );
    // "Simulado" elegido a mano se respeta. Una empresa BYOK sin clave utilizable
    // tampoco cae en la de Driony: eso sería cambiarle la factura sin avisar.
    if (own.apiKey || row.provider === "fake" || modeOf(row) === "BYOK") return own;
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
    const viaIncluded =
      !own.apiKey && row.provider !== "fake" && modeOf(row) !== "BYOK" ? this.includedCreds(included) : null;
    const active = viaIncluded ?? own;
    return {
      ready: active.provider !== "fake" && !!active.apiKey,
      provider: active.provider,
      model: active.model,
      source: viaIncluded ? "included" : !used?.key ? "none" : used.source === "db" ? "own" : "platform",
      saas: tenancyMode === "multi",
      included,
      ownTokens: await this.usage.ownTokensThisMonth(this.tenant.orgId()),
    };
  }

  // Credenciales de un proveedor concreto (para "Probar conexión").
  async resolveFor(
    provider: Exclude<LlmProviderName, "auto">,
    opts: { purpose?: "embeddings" } = {},
  ): Promise<ResolvedCredentials> {
    const row = await this.load();
    if (provider === "fake") return this.fakeCreds(row);
    if (provider === "openai") {
      const openai = this.keyFor("openai", row);
      if (!openai.key) {
        // Facturación mixta, declarada: lo que solo OpenAI hace (audio, visión,
        // embeddings) corre con la IA de Driony si la empresa no tiene clave de
        // OpenAI, también cuando es BYOK con solo Anthropic. Una empresa BYOK sin
        // ninguna clave no recibe nada: ahí sí sería un cambio de factura a escondidas.
        const hasOtherKey = !!this.keyFor("anthropic", row).key;
        if (modeOf(row) !== "BYOK" || hasOtherKey) {
          const included = this.includedCreds(await this.included(), opts.purpose === "embeddings");
          if (included) return included;
        }
      }
      return this.ownCreds("openai", openai, row);
    }
    return this.ownCreds("anthropic", this.keyFor("anthropic", row), row);
  }

  invalidate(): void {
    const orgId = this.tenant.orgId();
    this.cache.delete(orgId);
    this.includedCache.delete(orgId);
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

    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true, trialEndsAt: true } });
    const limit = effectivePlan(org?.plan, org?.trialEndsAt).aiTokens;
    let value: AiIncluded | null = null;
    if (limit !== null && limit > 0) {
      const used = await this.usage.includedUsage(orgId);
      let extra = await this.packs.extra(orgId);
      // Lo gastado por encima del cupo del plan se carga a los paquetes, y el
      // saldo se pone al día aquí mismo (volver a cargar lo mismo no gasta dos veces).
      const excess = used.tokens - limit;
      if (excess > extra.usedThisMonth && extra.remaining > 0) {
        await this.packs.settle(orgId, excess);
        extra = await this.packs.extra(orgId);
      }
      // Los extra suben el tope: los gastados este mes y los que aún quedan.
      const total = limit + extra.usedThisMonth + extra.remaining;
      const capUsd = includedAiCapUsd(total);
      value = {
        tokens: used.tokens,
        conversations: used.conversations,
        limit,
        extraRemaining: extra.remaining,
        extraUsed: extra.usedThisMonth,
        extraExpiresAt: extra.nextExpiresAt?.toISOString() ?? null,
        costUsd: used.costUsd,
        capUsd,
        full: used.tokens >= total,
        exhausted: used.costUsd >= capUsd,
        resetsAt: nextMonthStart().toISOString(),
      };
      if ((value.full && !hit?.value?.full) || (value.exhausted && !hit?.value?.exhausted)) {
        this.logger.warn(
          `IA incluida ${value.exhausted ? "al tope de gasto" : "con el cupo lleno"} en ${orgId}: ${used.tokens}/${total} tokens (${extra.usedThisMonth} de paquetes), US${used.costUsd.toFixed(2)}/${capUsd.toFixed(2)}`,
        );
      }
    }
    this.includedCache.set(orgId, { value, at: now });
    return value;
  }

  /**
   * ¿Puede el agente atender esta conversación? Siempre con clave propia; con
   * la IA de Driony, mientras queden tokens (del plan o extra). Con todo
   * gastado, solo una conversación que ya atendía este mes, y solo dentro del
   * margen AI_GRACE: así nadie se queda a medias y lo nuevo pasa al equipo.
   */
  async allowsConversation(conversationId: string): Promise<boolean> {
    const creds = await this.resolve();
    // Clave propia (o simulado): el cupo de Driony no pinta nada.
    if (!creds.included && creds.apiKey) return true;
    const included = await this.included();
    if (!included || !included.full) return true;
    if (included.exhausted || !this.withinGrace(included)) return false;
    return this.usage.countedThisMonth(this.tenant.orgId(), conversationId);
  }

  /** Con el cupo lleno, aún no se pasó el margen para terminar lo empezado. */
  private withinGrace(included: AiIncluded): boolean {
    return included.tokens < aiIncludedTotal(included) * (1 + AI_GRACE);
  }

  // Credenciales de la IA de Driony si queda dinero del tope y, con el cupo
  // lleno, margen para terminar lo empezado (o, para indexar el conocimiento,
  // mientras la empresa tenga IA incluida en su plan).
  private includedCreds(included: AiIncluded | null, evenIfExhausted = false): ResolvedCredentials | null {
    if (!included) return null;
    if (!evenIfExhausted && (included.exhausted || (included.full && !this.withinGrace(included)))) return null;
    const apiKey = env("OPENAI_API_KEY");
    if (!apiKey) return null;
    return {
      provider: "openai",
      apiKey,
      model: env("AI_INCLUDED_MODEL") ?? AI_INCLUDED_MODEL,
      baseUrl: null,
      included: true,
      billingMode: "MANAGED",
    };
  }

  // ── Internos ────────────────────────────────────────────────
  private resolveFrom(
    row: SettingsRow,
    openai: KeySource,
    anthropic: KeySource,
  ): ResolvedCredentials {
    const forced = row.provider as LlmProviderName;

    if (forced === "openai") return this.ownCreds("openai", openai, row);
    if (forced === "anthropic") return this.ownCreds("anthropic", anthropic, row);
    if (forced === "fake") return this.fakeCreds(row);

    // "auto": el primero que tenga credencial.
    if (openai.key) return this.ownCreds("openai", openai, row);
    if (anthropic.key) return this.ownCreds("anthropic", anthropic, row);
    return this.fakeCreds(row);
  }

  /**
   * La credencial de la propia empresa para un proveedor. Paga ella (BYOK)
   * salvo que la clave sea la del .env de la plataforma en SaaS
   * (AI_SHARED_KEYS): entonces la paga la plataforma, sin cupo.
   */
  private ownCreds(provider: "openai" | "anthropic", src: KeySource, row: SettingsRow): ResolvedCredentials {
    return {
      provider,
      apiKey: src.key,
      model: provider === "openai" ? row.openaiModel : row.anthropicModel,
      baseUrl: provider === "openai" ? row.openaiBaseUrl : null,
      billingMode: src.source === "env" && tenancyMode === "multi" ? "MANAGED" : src.source === "db" ? "BYOK" : modeOf(row),
      credentialStatus: src.source === "db" ? statusOf(row) : undefined,
    };
  }

  private fakeCreds(row: SettingsRow): ResolvedCredentials {
    return { provider: "fake", apiKey: null, model: "fake", baseUrl: null, billingMode: modeOf(row), credentialStatus: statusOf(row) };
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

  private eventsInsert(orgId: string, events: PendingEvent[], actorId?: string): Prisma.PrismaPromise<unknown> {
    return this.prisma.aiSettingEvent.createMany({
      data: events.map((e) => ({
        orgId,
        userId: actorId ?? null,
        action: e.action,
        provider: e.provider,
        details: e.details as Prisma.InputJsonValue,
      })),
    });
  }

  private async userRef(id: string): Promise<{ id: string; name: string } | null> {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
    return u ? { id: u.id, name: u.name || u.email } : null;
  }

  /** La fila de ajustes; `fresh` salta la caché (para comparar antes de guardar). */
  private async load(fresh = false): Promise<SettingsRow> {
    const orgId = this.tenant.orgId();
    const now = Date.now();
    const hit = this.cache.get(orgId);
    if (!fresh && hit && now - hit.at < AiSettingsService.TTL_MS) {
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
  billingMode: string;
  credentialStatus: string;
  validatedAt: Date | null;
  rotatedAt: Date | null;
  updatedBy: string | null;
};

function modeOf(row: Pick<SettingsRow, "billingMode">): OrgAiBillingMode {
  return row.billingMode === "BYOK" ? "BYOK" : "MANAGED";
}

function statusOf(row: Pick<SettingsRow, "credentialStatus">): AiCredentialStatus {
  const s = row.credentialStatus as AiCredentialStatus | undefined;
  return s && ["unconfigured", "untested", "valid", "invalid", "exhausted", "revoked"].includes(s) ? s : "unconfigured";
}

function providerOrNull(p: string): "openai" | "anthropic" | null {
  return p === "openai" || p === "anthropic" ? p : null;
}

/** Para el historial: el host de una URL base, nunca la URL entera (podría llevar rutas con tokens). */
function hostOnly(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}
