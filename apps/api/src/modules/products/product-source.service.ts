import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  PRODUCT_SOURCE_LABEL,
  type ConnectProductSourceInput,
  type ProductSourceDto,
  type ProductSourceKind,
  type ProductSourceStatus,
  type ProductSyncSummary,
  type RemoveProductSourceMode,
  type SyncProductSourceResult,
  type TestProductSourceResult,
  type UpdateProductSourceInput,
} from "@crm/shared";
import type { Prisma, ProductSource } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { encryptSecret, maskSecret } from "../../common/utils/secret-box";
import { publicApiBase } from "../../common/utils/public-api-base";
import { ConnectorError, type CatalogConnector, type SourceConfig, type TestResult } from "./connectors/types";
import {
  registerShopifyWebhooks,
  registerWooWebhooks,
  unregisterShopifyWebhooks,
  unregisterWooWebhooks,
  verifyShopifyHmac,
  verifyWooSignature,
} from "./connectors/store-webhooks";
import { ProductSyncService } from "./product-sync.service";

const STALE_RUN_MS = 30 * 60_000;
const CREDENTIAL_KEYS = ["consumerKey", "consumerSecret", "accessToken", "clientId", "clientSecret"] as const;
const NO_PUBLIC_URL = "El servidor no tiene dirección pública (API_PUBLIC_URL), así que la tienda no puede avisar: se lee por horario.";

type SourceRow = ProductSource & { _count: { products: number } };
const WITH_COUNT = { _count: { select: { products: true } } } as const;

/**
 * Las conexiones de catálogo de la empresa: conectar (probando antes), ver su
 * estado, cambiar frecuencia o credenciales, leer ahora, recibir el aviso de
 * la tienda y quitar. Las de tipo «api» no se leen: las llena un sistema
 * externo con una clave de API.
 */
@Injectable()
export class ProductSourceService {
  private readonly logger = new Logger("ProductSources");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly sync: ProductSyncService,
  ) {}

  async list(): Promise<ProductSourceDto[]> {
    const rows = await this.prisma.productSource.findMany({ orderBy: { createdAt: "asc" }, include: WITH_COUNT });
    return rows.map((r) => this.toDto(r));
  }

  /** Probar sin guardar: lo que verá el usuario antes de pulsar «Conectar». */
  async test(input: ConnectProductSourceInput): Promise<TestProductSourceResult> {
    const { connector, cfg } = await this.prepare(input);
    const { credentialsPatch: _patch, ...result } = await this.safeTest(connector, cfg);
    return result;
  }

  async create(input: ConnectProductSourceInput): Promise<ProductSourceDto> {
    const { connector, cfg } = await this.prepare(input);
    const test = await this.safeTest(connector, cfg);
    const credentials = { ...cfg.credentials, ...(test.credentialsPatch ?? {}) };
    let row = await this.prisma.productSource.create({
      data: {
        orgId: this.tenant.orgId(),
        kind: input.kind,
        name: input.name?.trim() || test.name || defaultName(input.kind, cfg.target),
        target: cfg.target,
        defaultCurrency: cfg.defaultCurrency ?? test.currency ?? null,
        credentials: Object.keys(credentials).length ? encryptSecret(JSON.stringify(credentials)) : null,
        syncEvery: input.syncEvery,
        nextSyncAt: new Date(),
        status: "idle",
        webhookToken: newToken(),
      },
      include: WITH_COUNT,
    });
    // Los avisos de la tienda: se registran solos cuando la tienda lo permite.
    row = await this.registerWebhooks(row);
    await this.sync.enqueue(row.id, row.orgId).catch((e) => this.logger.warn(`no se pudo encolar la primera lectura de ${row.id}: ${(e as Error).message}`));
    return this.toDto(row);
  }

  async update(id: string, input: UpdateProductSourceInput): Promise<ProductSourceDto> {
    const row = await this.get(id);
    const data: Prisma.ProductSourceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.syncEvery !== undefined && row.kind !== "api") {
      data.syncEvery = input.syncEvery;
      data.nextSyncAt = input.syncEvery > 0 ? new Date(Date.now() + input.syncEvery * 60_000) : null;
    }
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
      if (input.isActive && row.kind !== "api" && (input.syncEvery ?? row.syncEvery) > 0) data.nextSyncAt = new Date();
    }
    if (input.defaultCurrency !== undefined) data.defaultCurrency = input.defaultCurrency;

    // Dirección o credenciales nuevas: se prueban antes de guardarlas.
    const fresh: Record<string, string> = {};
    for (const k of CREDENTIAL_KEYS) if (input[k]?.trim()) fresh[k] = input[k]!.trim();
    const newTarget = input.url ?? input.shop;
    if (row.kind !== "api" && (Object.keys(fresh).length || newTarget)) {
      const connector = this.sync.connector(row.kind);
      const target = newTarget ? this.normalize(connector, newTarget) : row.target;
      const current = this.sync.credentials(row);
      let credentials = current;
      if (Object.keys(fresh).length) {
        // Shopify: cambiar de token a app (o al revés) sustituye el juego entero y olvida el token temporal.
        if (row.kind === "shopify") {
          credentials = fresh.accessToken
            ? { accessToken: fresh.accessToken }
            : { clientId: fresh.clientId ?? current.clientId ?? "", clientSecret: fresh.clientSecret ?? current.clientSecret ?? "" };
        } else credentials = { ...current, ...fresh };
      }
      if (row.kind === "shopify") assertShopifyCredentials(credentials);
      const cfg: SourceConfig = {
        target,
        defaultCurrency: input.defaultCurrency !== undefined ? input.defaultCurrency : row.defaultCurrency,
        credentials,
        fields: await this.sync.knownFields(),
      };
      const test = await this.safeTest(connector, cfg);
      data.target = target;
      data.credentials = encryptSecret(JSON.stringify({ ...credentials, ...(test.credentialsPatch ?? {}) }));
      data.status = "idle";
      data.lastError = null;
      data.nextSyncAt = new Date();
    }

    let updated = await this.prisma.productSource.update({ where: { id }, data, include: WITH_COUNT });
    // Con credenciales nuevas, los webhooks se vuelven a intentar (quizá ahora la clave puede crearlos).
    if (Object.keys(fresh).length || newTarget) updated = await this.registerWebhooks(updated);
    if (updated.isActive && data.nextSyncAt instanceof Date && data.nextSyncAt.getTime() <= Date.now() + 1000) {
      await this.sync.enqueue(updated.id, updated.orgId).catch(() => undefined);
    }
    return this.toDto(updated);
  }

  async syncNow(id: string): Promise<SyncProductSourceResult> {
    const row = await this.get(id);
    if (row.kind === "api") return { queued: false, reason: "Esta conexión recibe los productos por la API: no hay nada que leer" };
    if (!row.isActive) return { queued: false, reason: "La conexión está en pausa: actívala primero" };
    if (row.status === "running" && row.runStartedAt && Date.now() - row.runStartedAt.getTime() < STALE_RUN_MS) {
      return { queued: false, reason: "Ya hay una lectura en marcha" };
    }
    await this.prisma.productSource.update({ where: { id }, data: { nextSyncAt: new Date() } });
    await this.sync.enqueue(row.id, row.orgId);
    return { queued: true, reason: null };
  }

  /** Volver a intentar el registro de los webhooks en la tienda («Registrar de nuevo»). */
  async registerWebhooksAgain(id: string): Promise<ProductSourceDto> {
    const row = await this.prisma.productSource.findUnique({ where: { id }, include: WITH_COUNT });
    if (!row) throw new NotFoundException("Esa conexión no existe");
    return this.toDto(await this.registerWebhooks(row));
  }

  /** Quitar la conexión: sus productos se quedan (y dejan de actualizarse) o se van con ella. */
  async remove(id: string, mode: RemoveProductSourceMode): Promise<{ ok: true }> {
    const row = await this.get(id);
    await this.unregisterWebhooks(row);
    if (mode === "delete") await this.prisma.product.deleteMany({ where: { sourceId: id } });
    else await this.prisma.product.updateMany({ where: { sourceId: id }, data: { sourceId: null, externalId: null, syncedAt: null } });
    await this.prisma.productSource.delete({ where: { id } });
    return { ok: true };
  }

  // ── Conexión «api» (productos que empuja una clave de API) ──

  /** La conexión de tipo api de una clave: se crea la primera vez que la clave carga productos. */
  async ensureApiSource(keyName: string): Promise<ProductSource> {
    const existing = await this.prisma.productSource.findFirst({ where: { kind: "api", target: keyName } });
    if (existing) return existing;
    return this.prisma.productSource.create({
      data: {
        orgId: this.tenant.orgId(),
        kind: "api",
        name: `API · ${keyName}`,
        target: keyName,
        syncEvery: 0,
        status: "ok",
        webhookToken: newToken(),
      },
    });
  }

  // ── Webhook de entrada ───────────────────────────────────────

  /**
   * La tienda avisa de un cambio. El cuerpo no se usa (se relee el catálogo
   * entero con las credenciales guardadas), así que el token de la URL basta;
   * la firma, cuando viene, tiene que cuadrar.
   */
  async receiveHook(token: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<void> {
    if (!/^[a-f0-9]{32,96}$/i.test(token)) throw new NotFoundException();
    const source = await runUnscoped("webhook de catálogo", () => this.prisma.productSource.findUnique({ where: { webhookToken: token } }));
    if (!source) throw new NotFoundException("Esa conexión no existe");

    const header = (name: string): string | null => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    };
    if (source.kind === "woocommerce") {
      const sig = header("x-wc-webhook-signature");
      if (sig && !verifyWooSignature(token, sig, rawBody)) {
        throw new UnauthorizedException("La firma del webhook de WooCommerce no cuadra: el secreto del webhook tiene que ser el que muestra Driony");
      }
    }
    if (source.kind === "shopify") {
      const shop = header("x-shopify-shop-domain");
      if (shop && shop.toLowerCase() !== source.target) throw new UnauthorizedException("El aviso viene de otra tienda");
      const sig = header("x-shopify-hmac-sha256");
      const secret = this.safeCredentials(source).clientSecret;
      if (sig && secret && !verifyShopifyHmac(secret, sig, rawBody)) throw new UnauthorizedException("La firma del webhook de Shopify no cuadra");
    }

    await runInOrg(source.orgId, async () => {
      await this.prisma.productSource.update({ where: { id: source.id }, data: { lastWebhookAt: new Date() } });
      // Se espera 10 s antes de leer: una tienda manda un aviso por variante y así la ráfaga es una sola lectura.
      if (source.isActive && source.kind !== "api") await this.sync.enqueue(source.id, source.orgId, { delayMs: 10_000, tag: "hook" });
    });
  }

  webhookUrl(row: Pick<ProductSource, "webhookToken">): string | null {
    const base = publicApiBase();
    return base && row.webhookToken ? `${base}/api/v1/products/sources/hook/${row.webhookToken}` : null;
  }

  private async registerWebhooks(row: SourceRow): Promise<SourceRow> {
    if (row.kind !== "woocommerce" && row.kind !== "shopify") return row;
    const url = this.webhookUrl(row);
    const data: Prisma.ProductSourceUpdateInput = {};
    if (!url) {
      data.webhookRegisteredAt = null;
      data.webhookError = NO_PUBLIC_URL;
    } else {
      try {
        const cfg = await this.sync.config(row);
        if (row.kind === "woocommerce") await registerWooWebhooks(cfg, url, row.webhookToken!);
        else {
          const patch = await registerShopifyWebhooks(cfg, url);
          if (patch) data.credentials = encryptSecret(JSON.stringify({ ...cfg.credentials, ...patch }));
        }
        data.webhookRegisteredAt = new Date();
        data.webhookError = null;
      } catch (e) {
        const message = e instanceof ConnectorError ? e.message : `No se pudieron registrar los webhooks: ${(e as Error).message}`;
        this.logger.warn(`webhooks de «${row.name}»: ${message}`);
        data.webhookRegisteredAt = null;
        data.webhookError = message.slice(0, 400);
      }
    }
    return this.prisma.productSource.update({ where: { id: row.id }, data, include: WITH_COUNT });
  }

  /** Al quitar la conexión se intenta borrar nuestros webhooks de la tienda; si no se puede, no importa. */
  private async unregisterWebhooks(row: ProductSource): Promise<void> {
    if (!row.webhookRegisteredAt) return;
    const url = this.webhookUrl(row);
    if (!url) return;
    try {
      const cfg = await this.sync.config(row);
      if (row.kind === "woocommerce") await unregisterWooWebhooks(cfg, url);
      else if (row.kind === "shopify") await unregisterShopifyWebhooks(cfg, url);
    } catch (e) {
      this.logger.warn(`no se pudieron quitar los webhooks de «${row.name}»: ${(e as Error).message}`);
    }
  }

  // ── Internos ─────────────────────────────────────────────────

  private async get(id: string): Promise<ProductSource> {
    const row = await this.prisma.productSource.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Esa conexión no existe");
    return row;
  }

  private async prepare(input: ConnectProductSourceInput): Promise<{ connector: CatalogConnector; cfg: SourceConfig }> {
    const connector = this.sync.connector(input.kind);
    const target = this.normalize(connector, input.kind === "shopify" ? input.shop : input.url);
    const credentials: Record<string, string> = {};
    if (input.kind === "woocommerce") {
      credentials.consumerKey = input.consumerKey;
      credentials.consumerSecret = input.consumerSecret;
    } else if (input.kind === "shopify") {
      if (input.accessToken?.trim()) credentials.accessToken = input.accessToken.trim();
      else {
        if (input.clientId?.trim()) credentials.clientId = input.clientId.trim();
        if (input.clientSecret?.trim()) credentials.clientSecret = input.clientSecret.trim();
      }
      assertShopifyCredentials(credentials);
    }
    return {
      connector,
      cfg: { target, defaultCurrency: input.kind === "sheet" ? (input.defaultCurrency ?? null) : null, credentials, fields: await this.sync.knownFields() },
    };
  }

  private normalize(connector: CatalogConnector, raw: string): string {
    try {
      return connector.normalizeTarget(raw);
    } catch (e) {
      if (e instanceof ConnectorError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private async safeTest(connector: CatalogConnector, cfg: SourceConfig): Promise<TestResult> {
    try {
      return await connector.test(cfg);
    } catch (e) {
      if (e instanceof ConnectorError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private safeCredentials(row: ProductSource): Record<string, string> {
    try {
      return this.sync.credentials(row);
    } catch {
      return {};
    }
  }

  private toDto(row: SourceRow): ProductSourceDto {
    const store = row.kind === "woocommerce" || row.kind === "shopify";
    return {
      id: row.id,
      kind: row.kind as ProductSourceKind,
      name: row.name,
      target: row.target,
      credentialsHint: this.hint(row),
      defaultCurrency: row.defaultCurrency,
      syncEvery: row.syncEvery,
      isActive: row.isActive,
      status: row.status as ProductSourceStatus,
      lastError: row.lastError,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      nextSyncAt: row.nextSyncAt?.toISOString() ?? null,
      lastSummary: (row.lastSummary as ProductSyncSummary | null) ?? null,
      productCount: row._count.products,
      // Mercado Libre avisa por la URL de la app, no por una por conexión.
      webhookUrl: row.kind === "api" || row.kind === "mercadolibre" ? null : this.webhookUrl(row),
      webhookSecret: row.kind === "woocommerce" ? row.webhookToken : null,
      webhookRegisteredAt: store ? (row.webhookRegisteredAt?.toISOString() ?? null) : null,
      webhookError: store ? row.webhookError : null,
      lastWebhookAt: row.lastWebhookAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** «ck_12ab…9f2a»: para reconocer la credencial sin enseñarla. */
  private hint(row: ProductSource): string | null {
    const c = this.safeCredentials(row);
    if (row.kind === "woocommerce") return c.consumerKey ? maskSecret(c.consumerKey) : null;
    if (row.kind === "shopify") return c.accessToken ? maskSecret(c.accessToken) : c.clientId ? `App ${maskSecret(c.clientId)}` : null;
    if (row.kind === "mercadolibre") return c.nickname ? `Vendedor ${c.nickname}` : null;
    return null;
  }
}

function newToken(): string {
  return randomBytes(24).toString("hex");
}

function assertShopifyCredentials(c: Record<string, string>): void {
  if (!c.accessToken && !(c.clientId && c.clientSecret)) {
    throw new BadRequestException("Pega el token de acceso de la app (shpat_…), o el ID y el secreto de cliente de una app del Dev Dashboard instalada en la tienda");
  }
}

function defaultName(kind: ProductSourceKind, target: string): string {
  if (kind === "sheet") return "Hoja de productos";
  try {
    return new URL(target.includes("://") ? target : `https://${target}`).hostname.replace(/^www\./, "");
  } catch {
    return PRODUCT_SOURCE_LABEL[kind];
  }
}
