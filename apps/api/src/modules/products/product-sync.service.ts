import { BadRequestException, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { ProductSyncSummary } from "@crm/shared";
import { Prisma, type ProductSource } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";
import { QUEUE_PRODUCT_SYNC } from "../../infra/queue/queue.constants";
import { env } from "../../common/utils/env";
import { decryptSecret, encryptSecret } from "../../common/utils/secret-box";
import { WebhookOutService } from "../webhooks-out/webhook-out.service";
import { ConnectorError, type CatalogConnector, type ConnectorField, type ExternalProduct, type KnownField, type PullResult, type SourceConfig } from "./connectors/types";
import { WooCommerceConnector } from "./connectors/woocommerce.connector";
import { ShopifyConnector } from "./connectors/shopify.connector";
import { SheetConnector } from "./connectors/sheet.connector";
import { MercadoLibreConnector } from "./connectors/mercadolibre.connector";
import { MercadoLibreClient } from "./connectors/mercadolibre.client";

const SWEEP_EVERY_MS = 5 * 60_000;
const FIRST_SWEEP_MS = 20_000;
/** Una lectura que lleva más de esto «en marcha» se da por muerta (el proceso cayó) y se puede repetir. */
const STALE_RUN_MS = 30 * 60_000;
const MAX_FIELDS = 50; // el mismo tope que product-fields.controller
const MAX_WARNINGS = 20;

export interface ProductSyncJob {
  sourceId: string;
  orgId: string;
}

export interface EnqueueOptions {
  /** Esperar antes de leer: los avisos de una tienda llegan en ráfaga (uno por variante) y así se juntan. */
  delayMs?: number;
  /** Distingue el motivo en el id del trabajo (hook, retry) para que no pise al programado. */
  tag?: string;
}

export interface RunResult {
  skipped: boolean;
  summary: ProductSyncSummary | null;
  error?: string;
}

type ProductRow = {
  id: string;
  externalId: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  price: Prisma.Decimal;
  currency: string;
  imageUrl: string | null;
  isActive: boolean;
  attributes: Prisma.JsonValue | null;
};

const PRODUCT_SELECT = { id: true, externalId: true, name: true, sku: true, description: true, price: true, currency: true, imageUrl: true, isActive: true, attributes: true } as const;

/**
 * Lee los catálogos conectados y los vuelca en los productos de la empresa.
 *
 * La tienda manda: nombre, SKU, precio, moneda, imagen, descripción y activo
 * se sobrescriben en cada lectura. Lo que es de Driony se conserva: los
 * campos propios que la tienda no trae y los precios en otras monedas. Un
 * producto que la tienda deja de traer no se borra: se desactiva (vuelve solo
 * si reaparece). Un producto creado a mano con el mismo SKU se adopta en vez
 * de duplicarse.
 *
 * Cada lectura corre como trabajo de cola, dentro de la empresa de la
 * conexión; una pasada cada cinco minutos encola las que tocan.
 */
@Injectable()
export class ProductSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ProductSync");
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private connectors: CatalogConnector[] = [new WooCommerceConnector(), new ShopifyConnector(), new SheetConnector(), new MercadoLibreConnector(new MercadoLibreClient())];

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_PRODUCT_SYNC) private readonly queue: Queue<ProductSyncJob>,
    @Optional() private readonly webhooks?: WebhookOutService,
  ) {}

  onModuleInit(): void {
    if (env("PRODUCT_SYNC_SWEEP") === "off") return;
    this.first = setTimeout(() => void this.sweep(), FIRST_SWEEP_MS);
    this.first.unref();
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  /** Para las pruebas: conectores falsos en vez de salir a internet. */
  useConnectors(list: CatalogConnector[]): void {
    this.connectors = list;
  }

  connector(kind: string): CatalogConnector {
    const c = this.connectors.find((x) => x.kind === kind);
    if (!c) throw new BadRequestException(`Tipo de catálogo desconocido: ${kind}`);
    return c;
  }

  /**
   * Encola la lectura de una conexión. El id lleva la conexión y el tramo de
   * tiempo (un minuto; con espera, el tramo de la espera): dos peticiones del
   * mismo tramo son un solo trabajo mientras este espera o corre.
   */
  async enqueue(sourceId: string, orgId: string, opts: EnqueueOptions = {}): Promise<void> {
    const delay = opts.delayMs ?? 0;
    const bucket = Math.floor(Date.now() / (delay > 0 ? delay : 60_000));
    const jobId = `sync-${sourceId}-${opts.tag ?? "run"}-${bucket}`;
    await this.queue.add("sync", { sourceId, orgId }, { jobId, ...(delay > 0 ? { delay } : {}) });
  }

  /** Las conexiones a las que les toca, de todas las empresas. */
  async sweep(): Promise<void> {
    try {
      const stale = new Date(Date.now() - STALE_RUN_MS);
      const due = await runUnscoped("catálogos: pasada programada", () =>
        this.prisma.productSource.findMany({
          where: {
            isActive: true,
            syncEvery: { gt: 0 },
            nextSyncAt: { lte: new Date() },
            OR: [{ status: { not: "running" } }, { runStartedAt: { lt: stale } }, { runStartedAt: null }],
          },
          select: { id: true, orgId: true },
          take: 50,
        }),
      );
      for (const s of due) {
        await this.enqueue(s.id, s.orgId).catch((e) => this.logger.warn(`no se pudo encolar ${s.id}: ${(e as Error).message}`));
      }
    } catch (e) {
      this.logger.warn(`pasada de catálogos: ${(e as Error).message}`);
    }
  }

  /** Lee y aplica una conexión. Debe correr dentro de su empresa. */
  async run(sourceId: string): Promise<RunResult> {
    const stale = new Date(Date.now() - STALE_RUN_MS);
    const locked = await this.prisma.productSource.updateMany({
      where: { id: sourceId, OR: [{ status: { not: "running" } }, { runStartedAt: { lt: stale } }, { runStartedAt: null }] },
      data: { status: "running", runStartedAt: new Date() },
    });
    if (locked.count === 0) return { skipped: true, summary: null };
    const source = await this.prisma.productSource.findUnique({ where: { id: sourceId } });
    if (!source) return { skipped: true, summary: null };

    const started = Date.now();
    try {
      const connector = this.connector(source.kind);
      const cfg = await this.config(source);
      const pulled = await connector.pull(cfg);
      const summary = await this.apply(source, pulled, cfg.fields, started);
      await this.prisma.productSource.update({
        where: { id: sourceId },
        data: {
          status: "ok",
          lastError: null,
          lastSummary: summary as unknown as Prisma.InputJsonValue,
          lastSyncAt: new Date(),
          nextSyncAt: nextRun(source.syncEvery),
          ...(pulled.currency ? { defaultCurrency: pulled.currency } : {}),
          ...(pulled.credentialsPatch ? { credentials: encryptSecret(JSON.stringify({ ...cfg.credentials, ...pulled.credentialsPatch })) } : {}),
        },
      });
      this.logger.log(`catálogo «${source.name}»: ${summary.created} nuevos, ${summary.updated} actualizados, ${summary.deactivated} desactivados`);
      this.announce(source, summary);
      return { skipped: false, summary };
    } catch (e) {
      const message = (e as Error).message.slice(0, 500);
      if (!(e instanceof ConnectorError)) this.logger.error(`catálogo «${source.name}» (${sourceId}): ${message}`);
      else this.logger.warn(`catálogo «${source.name}»: ${message}`);
      await this.prisma.productSource
        .update({
          where: { id: sourceId },
          data: {
            status: "error",
            lastError: message,
            // Con error se reintenta en la siguiente pasada normal, nunca antes de una hora.
            nextSyncAt: source.syncEvery > 0 ? new Date(Date.now() + Math.max(source.syncEvery, 60) * 60_000) : null,
          },
        })
        .catch(() => undefined);
      return { skipped: false, summary: null, error: message };
    }
  }

  /** Un sistema externo cargó productos por la API: queda en la conexión y se avisa igual que tras una lectura. */
  async recordPush(source: ProductSource, summary: ProductSyncSummary): Promise<void> {
    await this.prisma.productSource.update({
      where: { id: source.id },
      data: { status: "ok", lastError: null, lastSummary: summary as unknown as Prisma.InputJsonValue, lastSyncAt: new Date() },
    });
    this.announce(source, summary);
  }

  /** Webhook saliente `catalog.synced`: qué conexión y qué cambió. */
  private announce(source: ProductSource, summary: ProductSyncSummary): void {
    void this.webhooks?.emit("catalog.synced", {
      source: { id: source.id, kind: source.kind, name: source.name },
      summary,
    });
  }

  async config(source: ProductSource): Promise<SourceConfig> {
    const credentials = this.credentials(source);
    return {
      target: source.target,
      defaultCurrency: source.defaultCurrency,
      credentials,
      fields: await this.knownFields(),
      // Un token renovado se guarda en el acto: el refresh token de Mercado Libre es de un solo uso.
      saveCredentials: async (patch) => {
        Object.assign(credentials, patch);
        await this.prisma.productSource.update({ where: { id: source.id }, data: { credentials: encryptSecret(JSON.stringify(credentials)) } });
      },
    };
  }

  credentials(source: Pick<ProductSource, "credentials">): Record<string, string> {
    if (!source.credentials) return {};
    const plain = decryptSecret(source.credentials);
    if (plain === null) throw new ConnectorError("No se pudieron leer las credenciales guardadas: vuelve a introducirlas");
    try {
      return JSON.parse(plain) as Record<string, string>;
    } catch {
      throw new ConnectorError("Las credenciales guardadas están dañadas: vuelve a introducirlas");
    }
  }

  async knownFields(): Promise<KnownField[]> {
    const rows = await this.prisma.productField.findMany({ orderBy: { order: "asc" } });
    return rows.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, unit: f.unit, required: f.required }));
  }

  // ── Aplicar lo leído ─────────────────────────────────────────

  private async apply(source: ProductSource, pulled: PullResult, known: KnownField[], started: number): Promise<ProductSyncSummary> {
    const warnings = [...pulled.warnings];
    await this.ensureFields(source.orgId, pulled.fields, known, warnings);

    const existing = await this.prisma.product.findMany({ where: { sourceId: source.id }, select: PRODUCT_SELECT });
    const byExternal = new Map<string, ProductRow>();
    for (const p of existing) if (p.externalId) byExternal.set(p.externalId, p);
    const seen = new Set<string>();
    const usedIds = new Set<string>();
    const now = new Date();
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of pulled.items) {
      if (!item.externalId || usedIds.has(item.externalId)) continue;
      usedIds.add(item.externalId);

      let target: ProductRow | null = byExternal.get(item.externalId) ?? null;
      if (!target && item.sku) {
        // Un producto creado a mano con ese SKU pasa a ser el de la tienda.
        target = await this.prisma.product.findFirst({ where: { sku: item.sku, sourceId: null }, select: PRODUCT_SELECT });
      }
      const attributes = { ...asRecord(target?.attributes), ...item.attributes };
      const data = {
        name: item.name.slice(0, 160),
        sku: item.sku?.slice(0, 60) || null,
        description: item.description,
        price: item.price,
        currency: item.currency,
        imageUrl: item.imageUrl,
        isActive: item.isActive,
        attributes: attributes as Prisma.InputJsonValue,
        sourceId: source.id,
        externalId: item.externalId,
        syncedAt: now,
      };

      if (target) {
        seen.add(target.id);
        if (target.externalId === item.externalId && same(target, item, attributes)) {
          unchanged++;
          continue;
        }
        await this.write(() => this.prisma.product.update({ where: { id: target!.id }, data }), () => this.prisma.product.update({ where: { id: target!.id }, data: { ...data, sku: null } }), item, warnings);
        updated++;
        if (item.prices?.length) await this.upsertPrices(source.orgId, target.id, item.currency, item.prices);
      } else {
        const row = await this.write(
          () => this.prisma.product.create({ data: { ...data, orgId: source.orgId }, select: { id: true } }),
          () => this.prisma.product.create({ data: { ...data, sku: null, orgId: source.orgId }, select: { id: true } }),
          item,
          warnings,
        );
        seen.add(row.id);
        created++;
        if (item.prices?.length) await this.upsertPrices(source.orgId, row.id, item.currency, item.prices);
      }
    }

    const missing = existing.filter((p) => !seen.has(p.id) && p.isActive).map((p) => p.id);
    if (missing.length) {
      await this.prisma.product.updateMany({ where: { id: { in: missing } }, data: { isActive: false, syncedAt: now } });
    }
    return {
      total: pulled.items.length,
      created,
      updated,
      unchanged,
      deactivated: missing.length,
      durationMs: Date.now() - started,
      warnings: warnings.slice(0, MAX_WARNINGS),
    };
  }

  /** Escribe; si el SKU ya lo tiene otro producto de la empresa, se guarda sin SKU y se avisa. */
  private async write<T>(attempt: () => Promise<T>, withoutSku: () => Promise<T>, item: ExternalProduct, warnings: string[]): Promise<T> {
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && item.sku) {
        warnings.push(`«${item.name}»: el SKU ${item.sku} ya lo usa otro producto; se guardó sin SKU`);
        return withoutSku();
      }
      throw e;
    }
  }

  /** Crea los campos que la tienda necesita (opciones de variante, stock, enlace…) si no existen. */
  private async ensureFields(orgId: string, wanted: ConnectorField[], known: KnownField[], warnings: string[]): Promise<void> {
    let count = known.length;
    let capped = false;
    for (const f of wanted) {
      if (known.some((k) => k.key === f.key)) continue;
      if (count >= MAX_FIELDS) {
        capped = true;
        continue;
      }
      const row = await this.prisma.productField.create({
        data: {
          orgId,
          key: f.key,
          label: f.label,
          type: f.type,
          options: [],
          unit: null,
          help: f.help ?? null,
          required: false,
          showOnCard: f.showOnCard,
          aiVisible: true,
          order: count,
        },
      });
      known.push({ key: row.key, label: row.label, type: row.type, options: row.options, unit: row.unit, required: row.required });
      count++;
    }
    if (capped) warnings.push(`Ya hay ${MAX_FIELDS} campos de producto: algunos datos de la tienda no tienen dónde mostrarse`);
  }

  /** Precios en otras monedas (hojas): se crean o actualizan solo las que vienen. */
  private async upsertPrices(orgId: string, productId: string, base: string, prices: { currency: string; amount: number }[]): Promise<void> {
    for (const p of prices) {
      if (p.currency === base) continue;
      await this.prisma.productPrice.upsert({
        where: { productId_currency: { productId, currency: p.currency } },
        update: { amount: p.amount },
        create: { orgId, productId, currency: p.currency, amount: p.amount },
      });
    }
  }
}

function nextRun(syncEvery: number): Date | null {
  return syncEvery > 0 ? new Date(Date.now() + syncEvery * 60_000) : null;
}

function asRecord(raw: Prisma.JsonValue | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** ¿Lo que hay guardado ya es lo que trae la tienda? Entonces no se escribe. */
function same(row: ProductRow, item: ExternalProduct, attributes: Record<string, string>): boolean {
  return (
    row.name === item.name.slice(0, 160) &&
    (row.sku ?? null) === (item.sku?.slice(0, 60) || null) &&
    (row.description ?? null) === (item.description ?? null) &&
    Number(row.price) === item.price &&
    row.currency === item.currency &&
    (row.imageUrl ?? null) === (item.imageUrl ?? null) &&
    row.isActive === item.isActive &&
    JSON.stringify(asRecord(row.attributes)) === JSON.stringify(attributes) &&
    !item.prices?.length
  );
}
