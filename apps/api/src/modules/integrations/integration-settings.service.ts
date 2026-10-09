import { Injectable, Logger } from "@nestjs/common";
import type {
  ApiKeyState,
  IntegrationSettingsDto,
  IntegrationTestResult,
  UpdateIntegrationSettingsInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runUnscoped, tenancyMode } from "../../infra/tenant/tenant.context";
import { env } from "../../common/utils/env";
import { publicApiBase } from "../../common/utils/public-api-base";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "../../common/utils/secret-box";


interface SecretSource {
  value: string | null;
  source: ApiKeyState["source"];
}

/**
 * Credenciales de terceros que consume el CRM (Voyage para embeddings,
 * WhatsApp a nivel de app de Meta), editables desde Ajustes › Integraciones.
 *
 * Mismo contrato que AiSettingsService: la BD manda, el .env es el respaldo,
 * y se cachea unos segundos porque esto se consulta en caliente (la firma de
 * cada webhook entrante, cada lote de embeddings).
 */
@Injectable()
export class IntegrationSettingsService {
  private readonly logger = new Logger("Integrations");
  // Caché por organización. Una sola entrada global serviría la configuración
  // de una empresa a otra en cuanto haya más de una.
  private cache = new Map<string, { row: SettingsRow; at: number }>();
  private static readonly TTL_MS = 15_000;

  constructor(

    private readonly prisma: PrismaService,

    private readonly tenant: TenantService,

  ) {}

  async getSettings(): Promise<IntegrationSettingsDto> {
    const row = await this.load();
    const voyage = this.secret(row.voyageKeyEnc, "VOYAGE_API_KEY");
    // En SaaS lo de WhatsApp es la app PROPIA de la empresa, si la tiene: el
    // entorno es de la plataforma y no cuenta como "configurado" para ella.
    const saas = tenancyMode === "multi";
    const appSecret = saas
      ? this.secretDb(row.whatsappAppSecretEnc)
      : this.secret(row.whatsappAppSecretEnc, "WHATSAPP_APP_SECRET");
    const verifyToken = saas
      ? this.secretDb(row.whatsappVerifyTokenEnc)
      : this.secret(row.whatsappVerifyTokenEnc, "WHATSAPP_VERIFY_TOKEN");

    return {
      voyageKey: this.toState(voyage),
      voyageModel: row.voyageModel,
      embeddingsProvider: voyage.value ? "voyage" : "fake",
      whatsappAppId:
        row.whatsappAppId ?? (saas ? null : (env("WHATSAPP_APP_ID") ?? null)),
      whatsappAppSecret: this.toState(appSecret),
      whatsappVerifyToken: this.toState(verifyToken),
      whatsappGraphVersion: row.whatsappGraphVersion,
      whatsappWebhookUrl: saas ? await this.ownWebhookUrl() : null,
      webhookSignatureVerified: !!appSecret.value,
      twilioAccountSid: row.twilioAccountSid,
      twilioAuthToken: this.toState(this.secretDb(row.twilioAuthTokenEnc)),
      twilioApiKeySid: row.twilioApiKeySid,
      twilioApiKeySecret: this.toState(this.secretDb(row.twilioApiKeySecretEnc)),
      twilioNumber: row.twilioNumber,
      twilioRecord: row.twilioRecord,
      twilioAppSid: row.twilioAppSid,
      twilioConfigured: !!(
        row.twilioAccountSid &&
        row.twilioApiKeySid &&
        row.twilioNumber &&
        this.secretDb(row.twilioAuthTokenEnc).value &&
        this.secretDb(row.twilioApiKeySecretEnc).value
      ),
      twilioWebhookBase: await this.twilioWebhookBase(),
    };
  }

  async updateSettings(
    input: UpdateIntegrationSettingsInput,
  ): Promise<IntegrationSettingsDto> {
    await this.load();
    const data: Record<string, unknown> = {};

    if (input.voyageModel !== undefined) data.voyageModel = input.voyageModel;
    if (input.whatsappGraphVersion !== undefined) {
      data.whatsappGraphVersion = input.whatsappGraphVersion;
    }
    if (input.whatsappAppId !== undefined) {
      data.whatsappAppId = input.whatsappAppId?.trim() || null;
    }
    // Cadena vacía = borrar de la BD y volver a la variable de entorno.
    if (input.voyageKey !== undefined) {
      data.voyageKeyEnc = this.encodeOrNull(input.voyageKey);
    }
    if (input.whatsappAppSecret !== undefined) {
      data.whatsappAppSecretEnc = this.encodeOrNull(input.whatsappAppSecret);
    }
    if (input.whatsappVerifyToken !== undefined) {
      data.whatsappVerifyTokenEnc = this.encodeOrNull(input.whatsappVerifyToken);
    }
    // Twilio: credenciales de la empresa, cifradas; "" borra.
    if (input.twilioAccountSid !== undefined) data.twilioAccountSid = input.twilioAccountSid?.trim() || null;
    if (input.twilioApiKeySid !== undefined) data.twilioApiKeySid = input.twilioApiKeySid?.trim() || null;
    if (input.twilioNumber !== undefined) data.twilioNumber = input.twilioNumber?.trim() || null;
    if (input.twilioRecord !== undefined) data.twilioRecord = input.twilioRecord;
    if (input.twilioAuthToken !== undefined) data.twilioAuthTokenEnc = this.encodeOrNull(input.twilioAuthToken);
    if (input.twilioApiKeySecret !== undefined) data.twilioApiKeySecretEnc = this.encodeOrNull(input.twilioApiKeySecret);

    const orgId = this.tenant.orgId();
    await this.prisma.integrationSetting.update({ where: { orgId }, data });
    this.cache.delete(orgId);
    return this.getSettings();
  }

  // ── Twilio (llamadas) ───────────────────────────────────────
  /** Credenciales de Twilio de la empresa (con `orgId`, sin contexto: los webhooks). */
  async twilio(orgId?: string): Promise<TwilioCreds> {
    const row = orgId ? await this.loadFor(orgId) : await this.load();
    if (!row) {
      return { accountSid: null, authToken: null, apiKeySid: null, apiKeySecret: null, number: null, appSid: null, record: true };
    }
    return {
      accountSid: row.twilioAccountSid,
      authToken: this.secretDb(row.twilioAuthTokenEnc).value,
      apiKeySid: row.twilioApiKeySid,
      apiKeySecret: this.secretDb(row.twilioApiKeySecretEnc).value,
      number: row.twilioNumber,
      appSid: row.twilioAppSid,
      record: row.twilioRecord,
    };
  }

  async setTwilioAppSid(appSid: string | null): Promise<void> {
    const orgId = this.tenant.orgId();
    await this.prisma.integrationSetting.update({ where: { orgId }, data: { twilioAppSid: appSid } });
    this.cache.delete(orgId);
  }

  /**
   * Base pública de la API (`https://api.driony.com`): API_PUBLIC_URL o, en
   * SaaS, `api.<dominio>`. Null si el servidor no sabe su propia dirección.
   */
  async publicApiBase(): Promise<string | null> {
    return publicApiBase();
  }

  private async twilioWebhookBase(): Promise<string | null> {
    const base = await this.publicApiBase();
    if (!base) return null;
    const org = await this.prisma.organization.findUnique({ where: { id: this.tenant.orgId() }, select: { slug: true } });
    return org ? `${base}/api/v1/calls/twilio/${org.slug}` : null;
  }

  // ── Accesores para el resto de la app ───────────────────────
  async voyage(): Promise<{ apiKey: string | null; model: string }> {
    const row = await this.load();
    return {
      apiKey: this.secret(row.voyageKeyEnc, "VOYAGE_API_KEY").value,
      model: row.voyageModel || env("VOYAGE_MODEL") || "voyage-3.5",
    };
  }

  // ── WhatsApp: el app secret cambia de dueño según el modo ──────
  //
  // Con una sola empresa, la app de Meta es del negocio y sus credenciales
  // viven en Ajustes › Integraciones (con respaldo en el .env).
  //
  // En SaaS hay UNA app de Meta, la de la plataforma, que firma los webhooks
  // de todos los clientes. Y esos webhooks llegan ANTES de saber de qué
  // empresa son: no hay fila de ajustes que consultar, y `load()` fallaría por
  // falta de contexto. Por eso en modo multi estas tres salen del entorno y
  // nunca de la base. (ARCHITECTURE-MULTITENANT.md §5.)

  async whatsappAppSecret(): Promise<string | null> {
    if (tenancyMode === "multi") return env("WHATSAPP_APP_SECRET") ?? null;
    const row = await this.load();
    return this.secret(row.whatsappAppSecretEnc, "WHATSAPP_APP_SECRET").value;
  }

  async whatsappVerifyToken(): Promise<string | null> {
    if (tenancyMode === "multi") return env("WHATSAPP_VERIFY_TOKEN") ?? null;
    const row = await this.load();
    return this.secret(row.whatsappVerifyTokenEnc, "WHATSAPP_VERIFY_TOKEN")
      .value;
  }

  async whatsappApp(): Promise<{
    appId: string | null;
    appSecret: string | null;
    graphVersion: string;
  }> {
    if (tenancyMode === "multi") {
      return {
        appId: env("WHATSAPP_APP_ID") ?? null,
        appSecret: env("WHATSAPP_APP_SECRET") ?? null,
        graphVersion: env("WHATSAPP_GRAPH_VERSION") || "v24.0",
      };
    }
    const row = await this.load();
    return {
      appId: row.whatsappAppId ?? env("WHATSAPP_APP_ID") ?? null,
      appSecret: this.secret(row.whatsappAppSecretEnc, "WHATSAPP_APP_SECRET")
        .value,
      graphVersion:
        row.whatsappGraphVersion || env("WHATSAPP_GRAPH_VERSION") || "v24.0",
    };
  }

  // ── La app de Meta PROPIA de una empresa (SaaS) ────────────────
  //
  // El Embedded Signup solo incorpora clientes cuando Meta ha dado a la
  // plataforma acceso avanzado a los permisos de WhatsApp. Mientras tanto —o
  // si lo prefiere— una empresa puede usar su propia app de Meta: guarda aquí
  // su App ID, App secret y verify token, apunta el webhook de su app a
  // `acme.driony.com/api/v1/webhooks/whatsapp` y añade el número a mano con
  // su token. Solo cuenta lo guardado en la base: el entorno es de la
  // plataforma.

  /**
   * La app propia de la empresa, o null si no la configuró. Con `orgId` no
   * hace falta contexto: el webhook llega antes de tenerlo.
   */
  async ownWhatsappApp(orgId?: string): Promise<OwnWhatsappApp | null> {
    if (tenancyMode !== "multi") {
      const { appId, appSecret, graphVersion } = await this.whatsappApp();
      return { appId, appSecret, verifyToken: await this.whatsappVerifyToken(), graphVersion };
    }
    const row = orgId ? await this.loadFor(orgId) : await this.load();
    if (!row) return null;
    const appSecret = this.secretDb(row.whatsappAppSecretEnc).value;
    const verifyToken = this.secretDb(row.whatsappVerifyTokenEnc).value;
    if (!appSecret && !verifyToken && !row.whatsappAppId) return null;
    return {
      appId: row.whatsappAppId,
      appSecret,
      verifyToken,
      graphVersion:
        row.whatsappGraphVersion || env("WHATSAPP_GRAPH_VERSION") || "v24.0",
    };
  }

  /**
   * La app con la que opera esta empresa: la propia si la tiene completa
   * (id y secreto); si no, la de la plataforma. Para lo que se hace con el
   * token de un número —subir el ejemplo de una plantilla— y debe ir por la
   * misma app que emitió ese token. El canje del Embedded Signup NO pasa por
   * aquí: ese code lo emitió la app de la plataforma.
   */
  async whatsappAppForOrg(): Promise<{
    appId: string | null;
    appSecret: string | null;
    graphVersion: string;
  }> {
    if (tenancyMode === "multi") {
      const propia = await this.ownWhatsappApp();
      if (propia?.appId && propia.appSecret) {
        return { appId: propia.appId, appSecret: propia.appSecret, graphVersion: propia.graphVersion };
      }
    }
    return this.whatsappApp();
  }

  /**
   * `https://api.driony.com/api/v1/webhooks/whatsapp/acme`, o null sin
   * dominio base. Va directa a la API (que el proxy publica en `api.<dominio>`,
   * o en `API_PUBLIC_URL` si es otra): bajo el subdominio de la empresa la
   * ruta se la quedaría el frontend.
   */
  private async ownWebhookUrl(): Promise<string | null> {
    const base = env("SAAS_BASE_DOMAIN");
    if (!base) return null;
    const org = await this.prisma.organization.findUnique({
      where: { id: this.tenant.orgId() },
      select: { slug: true },
    });
    if (!org) return null;
    const protocolo = base.startsWith("localhost") ? "http" : "https";
    const api = (env("API_PUBLIC_URL") ?? `${protocolo}://api.${base}`).replace(/\/+$/, "");
    return `${api}/api/v1/webhooks/whatsapp/${org.slug}`;
  }

  // Llamada mínima real a Voyage para confirmar que la key sirve.
  async test(): Promise<IntegrationTestResult> {
    const { apiKey, model } = await this.voyage();
    if (!apiKey) {
      return {
        ok: false,
        message:
          "Sin API key de Voyage: los embeddings del RAG son simulados (búsqueda pobre).",
        latencyMs: 0,
      };
    }
    const started = Date.now();
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: ["ping"], model }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return {
          ok: false,
          message: `Voyage ${res.status}: ${detail.slice(0, 200)}`,
          latencyMs: Date.now() - started,
        };
      }
      const data = (await res.json()) as { data?: { embedding: number[] }[] };
      const dim = data.data?.[0]?.embedding?.length ?? 0;
      return {
        ok: true,
        message: `Conexión correcta con ${model} (vectores de ${dim} dimensiones).`,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      return {
        ok: false,
        message: (e as Error).message.slice(0, 200),
        latencyMs: Date.now() - started,
      };
    }
  }

  invalidate(): void {
    this.cache.delete(this.tenant.orgId());
  }

  // ── Internos ────────────────────────────────────────────────
  private encodeOrNull(value: string): string | null {
    return value.trim() ? encryptSecret(value.trim()) : null;
  }

  private secret(enc: string | null, envVar: string): SecretSource {
    if (enc) {
      const plain = decryptSecret(enc);
      if (plain) return { value: plain, source: "db" };
      this.logger.warn(
        `No se pudo descifrar ${envVar} (¿cambió APP_ENCRYPTION_KEY?). Se usa el entorno.`,
      );
    }
    const fromEnv = env(envVar);
    if (fromEnv) return { value: fromEnv, source: "env" };
    return { value: null, source: "none" };
  }

  /** Solo lo guardado por la empresa: sin respaldo en el entorno. */
  private secretDb(enc: string | null): SecretSource {
    if (!enc) return { value: null, source: "none" };
    const plain = decryptSecret(enc);
    if (plain) return { value: plain, source: "db" };
    this.logger.warn("No se pudo descifrar un secreto de WhatsApp (¿cambió APP_ENCRYPTION_KEY?).");
    return { value: null, source: "none" };
  }

  private toState(src: SecretSource): ApiKeyState {
    return {
      configured: !!src.value,
      source: src.source,
      masked: src.value ? maskSecret(src.value) : null,
    };
  }

  /**
   * Ajustes de una empresa concreta, sin contexto y sin crear la fila: es lo
   * que consulta el webhook de su app propia, que llega antes de saber nada.
   */
  private async loadFor(orgId: string): Promise<SettingsRow | null> {
    const now = Date.now();
    const hit = this.cache.get(orgId);
    if (hit && now - hit.at < IntegrationSettingsService.TTL_MS) {
      return hit.row;
    }
    const row = await runUnscoped("webhook propio: ajustes de la empresa", () =>
      this.prisma.integrationSetting.findUnique({ where: { orgId } }),
    );
    if (row) this.cache.set(orgId, { row, at: now });
    return row;
  }

  private async load(): Promise<SettingsRow> {
    const orgId = this.tenant.orgId();
    const now = Date.now();
    const hit = this.cache.get(orgId);
    if (hit && now - hit.at < IntegrationSettingsService.TTL_MS) {
      return hit.row;
    }
    const row = await this.prisma.integrationSetting.upsert({
      where: { orgId },
      create: { orgId },
      update: {},
    });
    this.cache.set(orgId, { row, at: now });
    return row;
  }
}

export interface TwilioCreds {
  accountSid: string | null;
  authToken: string | null;
  apiKeySid: string | null;
  apiKeySecret: string | null;
  number: string | null;
  appSid: string | null;
  record: boolean;
}

export interface OwnWhatsappApp {
  appId: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  graphVersion: string;
}

type SettingsRow = {
  voyageKeyEnc: string | null;
  voyageModel: string;
  whatsappAppId: string | null;
  whatsappAppSecretEnc: string | null;
  whatsappVerifyTokenEnc: string | null;
  whatsappGraphVersion: string;
  twilioAccountSid: string | null;
  twilioAuthTokenEnc: string | null;
  twilioApiKeySid: string | null;
  twilioApiKeySecretEnc: string | null;
  twilioNumber: string | null;
  twilioAppSid: string | null;
  twilioRecord: boolean;
};
