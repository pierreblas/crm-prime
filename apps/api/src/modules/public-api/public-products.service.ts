import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  resolveFieldKeys,
  type BulkPublicProductsInput,
  type BulkPublicProductsResult,
  type CreatePublicProductInput,
  type ListProductsQuery,
  type ProductSyncSummary,
  type PublicProduct,
  type UpdatePublicProductInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { ProductSourceService } from "../products/product-source.service";
import { ProductSyncService } from "../products/product-sync.service";

interface Page<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const WITH = { prices: { orderBy: { currency: "asc" as const } }, source: { select: { name: true } } } as const;
type Row = Prisma.ProductGetPayload<{ include: typeof WITH }>;

/**
 * Catálogo por la API pública. Lo que un ERP o un n8n empuja queda ligado a
 * una conexión de tipo «api» con el nombre de la clave, igual que una tienda:
 * así se ve en Productos › Tiendas de dónde vino cada producto y la carga en
 * bloque puede desactivar lo que ya no manda.
 */
@Injectable()
export class PublicProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly sources: ProductSourceService,
    private readonly sync: ProductSyncService,
  ) {}

  async list(q: ListProductsQuery): Promise<Page<PublicProduct>> {
    const where: Prisma.ProductWhereInput = {};
    if (q.search) {
      where.OR = [{ name: { contains: q.search, mode: "insensitive" } }, { sku: { contains: q.search, mode: "insensitive" } }];
    }
    if (q.sku) where.sku = q.sku;
    if (q.active !== undefined) where.isActive = q.active === "true";
    if (q.updatedSince) where.updatedAt = { gte: new Date(q.updatedSince) };

    const rows = await this.prisma.product.findMany({
      where,
      orderBy: { id: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: WITH,
    });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data: page.map((p) => this.toPublic(p)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async get(id: string): Promise<PublicProduct> {
    const row = await this.prisma.product.findUnique({ where: { id }, include: WITH });
    if (!row) throw new NotFoundException("Producto no encontrado");
    return this.toPublic(row);
  }

  async create(input: CreatePublicProductInput, keyName: string): Promise<PublicProduct> {
    const sku = input.sku?.trim() || null;
    if (sku && (await this.prisma.product.findFirst({ where: { sku }, select: { id: true } }))) {
      throw new ConflictException(`Ya existe un producto con el SKU ${sku}; usa PATCH o la carga en bloque para actualizarlo`);
    }
    const source = await this.sources.ensureApiSource(keyName);
    const row = await this.prisma.product.create({
      data: {
        orgId: this.tenant.orgId(),
        name: input.name,
        sku,
        description: input.description ?? null,
        price: input.price ?? 0,
        currency: input.currency ?? "USD",
        imageUrl: input.imageUrl ?? null,
        isActive: input.isActive ?? true,
        attributes: (await this.resolveFields(input.fields ?? {}, {})) as Prisma.InputJsonValue,
        sourceId: source.id,
        externalId: sku ? `sku:${sku}` : null,
        syncedAt: new Date(),
      },
    });
    if (input.prices) await this.setPrices(row.id, row.currency, input.prices);
    return this.get(row.id);
  }

  async update(id: string, input: UpdatePublicProductInput): Promise<PublicProduct> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Producto no encontrado");
    const sku = input.sku === undefined ? undefined : input.sku?.trim() || null;
    if (sku && sku !== existing.sku) {
      const dup = await this.prisma.product.findFirst({ where: { sku }, select: { id: true } });
      if (dup && dup.id !== id) throw new ConflictException(`Ya existe otro producto con el SKU ${sku}`);
    }
    const row = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(sku !== undefined ? { sku } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.fields
          ? { attributes: (await this.resolveFields(input.fields, asRecord(existing.attributes))) as Prisma.InputJsonValue }
          : {}),
      },
    });
    if (input.prices) await this.setPrices(row.id, row.currency, input.prices);
    return this.get(id);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException("Producto no encontrado");
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Carga en bloque por SKU. Lo que ya existe se actualiza (venga de donde
   * venga); lo nuevo nace ligado a la conexión de la clave. Con
   * `deactivateMissing`, lo que esta clave cargó antes y no viene ahora queda
   * inactivo.
   */
  async bulk(input: BulkPublicProductsInput, keyName: string): Promise<BulkPublicProductsResult> {
    const started = Date.now();
    const source = await this.sources.ensureApiSource(keyName);
    const defs = await this.prisma.productField.findMany({ select: { key: true, label: true } });
    const result: BulkPublicProductsResult = { created: 0, updated: 0, deactivated: 0, errors: [] };
    const seen = new Set<string>();
    const now = new Date();

    for (const item of input.products) {
      const sku = item.sku.trim();
      if (seen.has(sku)) {
        result.errors.push({ sku, message: "SKU repetido en el envío: se usó la primera aparición" });
        continue;
      }
      seen.add(sku);
      try {
        const existing = await this.prisma.product.findFirst({ where: { sku } });
        const fields = resolveFieldKeys(item.fields ?? {}, defs);
        if (existing) {
          const attributes = clean({ ...asRecord(existing.attributes), ...fields });
          await this.prisma.product.update({
            where: { id: existing.id },
            data: {
              name: item.name,
              ...(item.description !== undefined ? { description: item.description } : {}),
              ...(item.price !== undefined ? { price: item.price } : {}),
              ...(item.currency !== undefined ? { currency: item.currency } : {}),
              ...(item.imageUrl !== undefined ? { imageUrl: item.imageUrl } : {}),
              ...(item.isActive !== undefined ? { isActive: item.isActive } : {}),
              attributes: attributes as Prisma.InputJsonValue,
              // Un producto manual pasa a ser de esta clave; uno de una tienda sigue siendo de su tienda.
              ...(existing.sourceId ? {} : { sourceId: source.id, externalId: `sku:${sku}` }),
              syncedAt: now,
            },
          });
          if (item.prices) await this.setPrices(existing.id, item.currency ?? existing.currency, item.prices);
          result.updated++;
        } else {
          const created = await this.prisma.product.create({
            data: {
              orgId: this.tenant.orgId(),
              name: item.name,
              sku,
              description: item.description ?? null,
              price: item.price ?? 0,
              currency: item.currency ?? "USD",
              imageUrl: item.imageUrl ?? null,
              isActive: item.isActive ?? true,
              attributes: clean(fields) as Prisma.InputJsonValue,
              sourceId: source.id,
              externalId: `sku:${sku}`,
              syncedAt: now,
            },
          });
          if (item.prices) await this.setPrices(created.id, created.currency, item.prices);
          result.created++;
        }
      } catch (e) {
        result.errors.push({ sku, message: (e as Error).message.slice(0, 200) });
      }
    }

    if (input.deactivateMissing) {
      const missing = await this.prisma.product.updateMany({
        where: { sourceId: source.id, isActive: true, OR: [{ sku: null }, { sku: { notIn: [...seen] } }] },
        data: { isActive: false, syncedAt: now },
      });
      result.deactivated = missing.count;
    }

    const summary: ProductSyncSummary = {
      total: input.products.length,
      created: result.created,
      updated: result.updated,
      unchanged: 0,
      deactivated: result.deactivated,
      durationMs: Date.now() - started,
      warnings: result.errors.slice(0, 20).map((e) => `${e.sku}: ${e.message}`),
    };
    await this.sync.recordPush(source, summary);
    return result;
  }

  // ── Internos ─────────────────────────────────────────────────

  /** Acepta la clave del campo o su nombre visible («Talla» → talla); un valor vacío borra el campo. */
  private async resolveFields(fields: Record<string, string>, current: Record<string, string>): Promise<Record<string, string>> {
    if (!Object.keys(fields).length) return current;
    const defs = await this.prisma.productField.findMany({ select: { key: true, label: true } });
    return clean({ ...current, ...resolveFieldKeys(fields, defs) });
  }

  private async setPrices(productId: string, base: string, prices: { currency: string; amount: number }[]): Promise<void> {
    const rows = prices.filter((p) => p.currency !== base);
    const seen = new Set<string>();
    for (const p of rows) {
      if (seen.has(p.currency)) throw new BadRequestException(`Moneda repetida en los precios: ${p.currency}`);
      seen.add(p.currency);
    }
    await this.prisma.productPrice.deleteMany({ where: { productId } });
    if (!rows.length) return;
    await this.prisma.productPrice.createMany({
      data: rows.map((p) => ({ orgId: this.tenant.orgId(), productId, currency: p.currency, amount: p.amount })),
    });
  }

  private toPublic(p: Row): PublicProduct {
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      description: p.description,
      price: Number(p.price),
      currency: p.currency,
      prices: p.prices.map((x) => ({ currency: x.currency, amount: Number(x.amount) })),
      imageUrl: p.imageUrl,
      isActive: p.isActive,
      fields: asRecord(p.attributes),
      source: p.source?.name ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}

function asRecord(raw: Prisma.JsonValue | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Sin vacíos: enviar "" borra el campo. */
function clean(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v.trim()) out[k] = v.trim();
  return out;
}
