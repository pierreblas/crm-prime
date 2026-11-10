import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { MERCADO_LIBRE_SITES, type MercadoLibreConfig, type MercadoLibreSiteId, type StartMercadoLibreConnectInput } from "@crm/shared";
import type { ProductSource } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { OneTimeTicketService } from "../../infra/tickets/one-time-ticket.service";
import { env } from "../../common/utils/env";
import { publicApiBase } from "../../common/utils/public-api-base";
import { encryptSecret } from "../../common/utils/secret-box";
import { MercadoLibreClient, type MercadoLibreMe, type MercadoLibreTokens } from "./connectors/mercadolibre.client";
import { ProductSyncService } from "./product-sync.service";

const PROPOSITO = "mercadolibre-connect";
const VERIFIER_TTL_MS = 15 * 60_000;
/** Temas de notificación que significan «cambió una publicación». */
const TOPICS = new Set(["items", "items_prices", "stock-locations"]);

interface Claims {
  sub: string;
  org: string;
  site: MercadoLibreSiteId;
  syncEvery: number;
  pkce: string;
}

export interface MercadoLibreNotification {
  topic?: string;
  resource?: string;
  user_id?: number | string;
  application_id?: number | string;
}

/**
 * Conectar una cuenta de vendedor de Mercado Libre como catálogo: OAuth en
 * auth.mercadolibre.<país> con un pase de un solo uso como `state` (y PKCE),
 * la cuenta queda como conexión «mercadolibre» con sus tokens cifrados, y las
 * notificaciones de la app (una URL para todos los vendedores, configurada en
 * el portal de desarrolladores) disparan una relectura.
 */
@Injectable()
export class MercadoLibreConnectService {
  private readonly logger = new Logger("MercadoLibre");
  /** Verificadores PKCE por pase emitido: no viajan en la URL. Caducan con el pase. */
  private readonly verifiers = new Map<string, { verifier: string; expires: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: ProductSyncService,
    private readonly tickets: OneTimeTicketService,
    private readonly client: MercadoLibreClient,
  ) {}

  /** La URL de retorno de la autorización: tiene que estar registrada en la app de Mercado Libre. */
  callbackUrl(): string | null {
    const base = publicApiBase() ?? (env("API_PORT") ? `http://localhost:${env("API_PORT")}` : null);
    return base ? `${base}/api/v1/products/sources/mercadolibre/callback` : null;
  }

  /** La URL de notificaciones de la app (tema «items»): se pone una vez en el portal de desarrolladores. */
  notificationsUrl(): string | null {
    const base = publicApiBase();
    return base ? `${base}/api/v1/products/sources/mercadolibre/notifications` : null;
  }

  config(): MercadoLibreConfig {
    return { configured: this.client.configured, callbackUrl: this.callbackUrl(), notificationsUrl: this.notificationsUrl() };
  }

  /** Paso 1: el pase y la URL de Mercado Libre a la que mandar al administrador. */
  async start(user: { sub: string; org: string }, input: StartMercadoLibreConnectInput): Promise<{ url: string }> {
    if (!this.client.configured) {
      throw new BadRequestException("Falta la app de Mercado Libre en el servidor (MERCADOLIBRE_APP_ID y MERCADOLIBRE_APP_SECRET).");
    }
    const redirect = this.callbackUrl();
    if (!redirect) throw new BadRequestException("Falta la URL pública de la API (API_PUBLIC_URL) para recibir la autorización de Mercado Libre.");
    const { verifier, challenge } = MercadoLibreClient.pkce();
    const pkce = randomUUID();
    this.rememberVerifier(pkce, verifier);
    const claims: Omit<Claims, "sub"> & { sub: string } = { sub: user.sub, org: user.org, site: input.site, syncEvery: input.syncEvery, pkce };
    const ticket = await this.tickets.issue(PROPOSITO, claims, "15m");
    return { url: this.client.authorizeUrl(input.site, redirect, ticket, challenge) };
  }

  /**
   * Paso 2: Mercado Libre devuelve al navegador con `code` y nuestro `state`.
   * Se canjea el pase (quién y de qué empresa), se piden los tokens, se
   * pregunta quién es el vendedor y la cuenta queda conectada. Devuelve a
   * dónde mandar al navegador.
   */
  async complete(input: { code?: string; state?: string; error?: string; errorDescription?: string }): Promise<string> {
    if (!input.state) throw new BadRequestException("Falta el pase de la conexión (state)");
    const claims = await this.tickets.redeem<Claims>(PROPOSITO, input.state);
    const org = await runUnscoped("conexión de Mercado Libre: empresa del pase", () =>
      this.prisma.organization.findUnique({ where: { id: claims.org }, select: { id: true, slug: true } }),
    );
    if (!org) throw new BadRequestException("Empresa no encontrada");
    const back = (query: string) => `${this.webBase(org.slug)}/products?stores=mercadolibre&${query}`;

    if (input.error || !input.code) {
      const reason = input.errorDescription || input.error || "La autorización se canceló";
      return back(`error=${encodeURIComponent(reason)}`);
    }
    const verifier = this.takeVerifier(claims.pkce);
    try {
      const row = await runInOrg(org.id, async () => {
        // El pase se emitió a un administrador; se comprueba que lo sigue siendo.
        const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, select: { role: true, isActive: true } });
        if (!user || !user.isActive || user.role !== "ADMIN") throw new BadRequestException("Solo un administrador puede conectar cuentas");
        const tokens = await this.client.exchangeCode(input.code!, this.callbackUrl() ?? "", verifier ?? "");
        const me = await this.client.me(tokens.accessToken).catch(() => ({ id: Number(tokens.userId) }) as MercadoLibreMe);
        return this.connect(org.id, tokens, me, claims.site, claims.syncEvery);
      });
      await this.sync.enqueue(row.id, row.orgId).catch((e) => this.logger.warn(`no se pudo encolar la primera lectura de ${row.id}: ${(e as Error).message}`));
      this.logger.log(`Mercado Libre conectado: ${row.name} (${row.target})`);
      return back("connected=1");
    } catch (e) {
      this.logger.warn(`Conexión de Mercado Libre fallida: ${(e as Error).message}`);
      return back(`error=${encodeURIComponent((e as Error).message)}`);
    }
  }

  /** La conexión del vendedor en la empresa: se crea, o si ya estaba se renueva su autorización. Debe correr dentro de la empresa. */
  async connect(orgId: string, tokens: MercadoLibreTokens, me: MercadoLibreMe, site: MercadoLibreSiteId, syncEvery: number): Promise<ProductSource> {
    const userId = String(me.id || tokens.userId);
    if (!/^\d+$/.test(userId)) throw new BadRequestException("Mercado Libre no dijo de qué vendedor es la autorización");
    const siteId = (me.site_id as MercadoLibreSiteId | undefined) ?? site;
    const nickname = me.nickname?.trim() || "";
    const credentials = encryptSecret(
      JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: String(tokens.expiresAt),
        userId,
        nickname,
        siteId,
      }),
    );
    const existing = await this.prisma.productSource.findFirst({ where: { kind: "mercadolibre", target: userId } });
    if (existing) {
      return this.prisma.productSource.update({
        where: { id: existing.id },
        data: { credentials, name: existing.name || nickname || existing.name, status: "idle", lastError: null, isActive: true, nextSyncAt: new Date() },
      });
    }
    return this.prisma.productSource.create({
      data: {
        orgId,
        kind: "mercadolibre",
        name: nickname || `Mercado Libre · ${userId}`,
        target: userId,
        defaultCurrency: MERCADO_LIBRE_SITES.find((s) => s.id === siteId)?.currency ?? null,
        credentials,
        syncEvery,
        nextSyncAt: new Date(),
        status: "idle",
        webhookToken: randomBytes(24).toString("hex"),
      },
    });
  }

  /**
   * Notificación de la app. Solo dice que algo cambió en la cuenta `user_id`;
   * no trae datos ni firma, así que se comprueba que sea de nuestra app y de
   * un vendedor conectado, y se relee con las credenciales guardadas. Hay
   * que responder 200 en menos de 500 ms: el trabajo sigue en segundo plano.
   */
  notify(body: unknown): void {
    void this.handleNotification(body).catch((e) => this.logger.warn(`aviso de Mercado Libre: ${(e as Error).message}`));
  }

  async handleNotification(body: unknown): Promise<{ queued: number }> {
    const n = body as MercadoLibreNotification | null;
    if (!n || typeof n !== "object" || !TOPICS.has(String(n.topic ?? ""))) return { queued: 0 };
    const appId = this.client.appId;
    if (appId && n.application_id !== undefined && String(n.application_id) !== appId) {
      this.logger.warn("aviso de Mercado Libre de otra app: se ignora");
      return { queued: 0 };
    }
    const userId = String(n.user_id ?? "");
    if (!/^\d+$/.test(userId)) return { queued: 0 };
    const sources = await runUnscoped("aviso de Mercado Libre: vendedor", () =>
      this.prisma.productSource.findMany({ where: { kind: "mercadolibre", target: userId } }),
    );
    let queued = 0;
    for (const s of sources) {
      await runInOrg(s.orgId, async () => {
        await this.prisma.productSource.update({ where: { id: s.id }, data: { lastWebhookAt: new Date() } });
        if (s.isActive) {
          // Se espera 10 s antes de leer: un cambio manda varios avisos y así la ráfaga es una sola lectura.
          await this.sync.enqueue(s.id, s.orgId, { delayMs: 10_000, tag: "hook" });
          queued++;
        }
      });
    }
    return { queued };
  }

  private rememberVerifier(key: string, verifier: string): void {
    const now = Date.now();
    for (const [k, v] of this.verifiers) if (v.expires < now) this.verifiers.delete(k);
    this.verifiers.set(key, { verifier, expires: now + VERIFIER_TTL_MS });
  }

  private takeVerifier(key: string | undefined): string | null {
    if (!key) return null;
    const v = this.verifiers.get(key);
    this.verifiers.delete(key);
    return v && v.expires >= Date.now() ? v.verifier : null;
  }

  /** El panel de la empresa: su subdominio en el SaaS, o la web configurada en una instalación propia. */
  private webBase(slug: string): string {
    const base = env("SAAS_BASE_DOMAIN");
    if (base) return `${base.startsWith("localhost") ? "http" : "https"}://${slug}.${base}`;
    return (env("WEB_PUBLIC_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
  }
}
