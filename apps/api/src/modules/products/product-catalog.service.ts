import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  MANUAL_SOURCE,
  parseProductListQuery,
  parseRange,
  rangeNumber,
  resolveFieldKeys,
  type ListProductsQuery,
  type ProductBulkInput,
  type ProductBulkResult,
  type ProductDto,
  type ProductListQuery,
  type ProductPage,
  type ProductSort,
  type ProductStatusFilter,
  type Range,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { pricedDto } from "./product-discount";
import { TenantService } from "../../infra/tenant/tenant.service";
import { fold } from "../../common/utils/fold";
import { escapeLike, foldSql } from "../../common/utils/fold-sql";

/**
 * La lista del catálogo con filtros, en SQL: los valores de los campos propios
 * viven como texto en `attributes` (jsonb), y filtrarlos por rango de números o
 * fechas, por opciones o sin tildes no se puede expresar con el cliente de
 * Prisma. Al ser SQL a mano, la capa 1 (filtro por empresa de la extensión) no
 * llega: por eso cada consulta lleva `p."orgId"` explícito, y RLS queda detrás.
 */

export interface FieldDef {
  key: string;
  type: string;
}

export interface ProductFilter {
  /**
   * words: cada palabra tiene que aparecer en nombre, SKU, descripción o algún
   * campo, sin tildes (panel). simple: nombre o SKU contiene el texto (la API
   * pública, que siempre buscó así).
   */
  search?: { text: string; mode: "words" | "simple" };
  source?: string | null;
  price?: Range | null;
  /** Moneda del rango de precio: el base si es esa, o el precio adicional en esa moneda. */
  currency?: string | null;
  /** Solo con descuento vigente en el precio base. */
  discount?: boolean;
  fields?: Record<string, string[]>;
  sku?: string;
  updatedSince?: Date;
  /** Paginación por cursor de la API pública (orden por id descendente). */
  beforeId?: string;
}

// `attributes` puede quedar como JSON null en filas antiguas: jsonb_each_text fallaría.
const ATTRS = Prisma.sql`(CASE WHEN jsonb_typeof(p.attributes) = 'object' THEN p.attributes ELSE '{}'::jsonb END)`;
const NUM_RE = "^\\s*-?[0-9]+([.,][0-9]+)?\\s*$";
const DATE_RE = "^[0-9]{4}-[0-9]{2}-[0-9]{2}";
const TIME_RE = "^[0-9]{1,2}:[0-9]{2}";
// Lo que cuenta como «sí» en un campo sí/no (la importación guarda «Sí», una API puede mandar true o 1).
const TRUE_WORDS = ["si", "true", "1", "activo", "yes", "y", "x", "verdadero"];
const FALSE_WORDS = ["no", "false", "0", "-1", "inactivo", "n", "falso"];

const NOTHING = Prisma.sql`FALSE`;

const ORDER: Record<ProductSort, Prisma.Sql> = {
  recent: Prisma.sql`p."createdAt" DESC, p.id DESC`,
  updated: Prisma.sql`p."updatedAt" DESC, p.id DESC`,
  name: Prisma.sql`${foldSql(Prisma.sql`p.name`)} ASC, p.id ASC`,
  price_asc: Prisma.sql`p.price ASC, p.id ASC`,
  price_desc: Prisma.sql`p.price DESC, p.id DESC`,
};

function anyOf(parts: (Prisma.Sql | null)[]): Prisma.Sql | null {
  const list = parts.filter((p): p is Prisma.Sql => p !== null);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0]!;
  return Prisma.sql`(${Prisma.join(list, " OR ")})`;
}

/**
 * Un rango sobre una expresión. Un valor que no se entiende (una fecha mal
 * escrita) no deja pasar nada: devolver todo haría creer que el filtro funcionó.
 */
function rangeSql(expr: Prisma.Sql, raw: string, toSql: (v: string) => Prisma.Sql | null): Prisma.Sql | null {
  const r = parseRange(raw);
  if (!r) return null;
  const parts: Prisma.Sql[] = [];
  if (r.min !== null && r.min === r.max) {
    const v = toSql(r.min);
    if (!v) return NOTHING;
    parts.push(Prisma.sql`${expr} = ${v}`);
  } else {
    if (r.min !== null) {
      const v = toSql(r.min);
      if (!v) return NOTHING;
      parts.push(Prisma.sql`${expr} >= ${v}`);
    }
    if (r.max !== null) {
      const v = toSql(r.max);
      if (!v) return NOTHING;
      parts.push(Prisma.sql`${expr} <= ${v}`);
    }
  }
  return parts.length ? Prisma.sql`(${Prisma.join(parts, " AND ")})` : null;
}

const numberParam = (v: string) => {
  const n = rangeNumber(v);
  return n === null ? null : Prisma.sql`${String(n)}::numeric`;
};
const dateParam = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? Prisma.sql`${v}` : null);
const timeParam = (v: string) => {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Prisma.sql`${`${m[1]!.padStart(2, "0")}:${m[2]}`}` : null;
};

/** El filtro de un campo propio, según su tipo (sin definición, se trata como texto). */
export function fieldCondition(
  key: string,
  values: string[],
  type: string | undefined,
  textMatch: "contains" | "equals",
): Prisma.Sql | null {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (!vals.length) return null;
  const raw = Prisma.sql`(${ATTRS} ->> ${key})`;
  const folded = foldSql(Prisma.sql`trim(${raw})`);
  switch (type) {
    case "select":
      return Prisma.sql`${folded} = ANY(${vals.map(fold)})`;
    case "multiselect":
      // Se guardan como «Rojo, Azul»: vale si tiene cualquiera de las elegidas.
      return Prisma.sql`EXISTS (SELECT 1 FROM regexp_split_to_table(coalesce(${raw}, ''), '[,;|]') AS part(v) WHERE ${foldSql(Prisma.sql`trim(part.v)`)} = ANY(${vals.map(fold)}))`;
    case "boolean": {
      const wantsYes = vals.some((v) => TRUE_WORDS.includes(fold(v)));
      const wantsNo = vals.some((v) => FALSE_WORDS.includes(fold(v)));
      if (wantsYes === wantsNo) return wantsYes ? null : NOTHING;
      const yes = Prisma.sql`${folded} = ANY(${TRUE_WORDS})`;
      // «No» incluye los que no tienen el campo puesto.
      return wantsYes ? yes : Prisma.sql`NOT (${yes})`;
    }
    case "number": {
      const num = Prisma.sql`(CASE WHEN ${raw} ~ ${NUM_RE} THEN replace(trim(${raw}), ',', '.')::numeric END)`;
      return anyOf(vals.map((v) => rangeSql(num, v, numberParam)));
    }
    case "date": {
      const d = Prisma.sql`(CASE WHEN ${raw} ~ ${DATE_RE} THEN left(${raw}, 10) END)`;
      return anyOf(vals.map((v) => rangeSql(d, v, dateParam)));
    }
    case "time": {
      const t = Prisma.sql`(CASE WHEN trim(${raw}) ~ ${TIME_RE} THEN lpad(split_part(trim(${raw}), ':', 1), 2, '0') || ':' || left(split_part(trim(${raw}), ':', 2), 2) END)`;
      return anyOf(vals.map((v) => rangeSql(t, v, timeParam)));
    }
    default:
      if (textMatch === "equals") return Prisma.sql`${folded} = ANY(${vals.map(fold)})`;
      return anyOf(vals.map((v) => Prisma.sql`coalesce(${raw}, '') ~* ${accentInsensitiveRegex(fold(v))}`));
  }
}

export function statusSql(status: ProductStatusFilter | undefined): Prisma.Sql | null {
  if (status === "active") return Prisma.sql`p."isActive"`;
  if (status === "inactive") return Prisma.sql`NOT p."isActive"`;
  return null;
}

/** Palabras de la búsqueda, sin tildes ni mayúsculas. */
function words(text: string): string[] {
  return [...new Set(fold(text).split(" ").filter(Boolean))].slice(0, 8);
}

// Cada letra que puede llevar tilde busca también sus variantes: «camion» → c[aá…]m[ií…][oó…]n.
// Así se compara contra el texto tal cual, sin quitarle las tildes fila a fila con
// translate (con 20 000 productos: ~100 ms frente a ~600 ms, mismos resultados).
const ACCENT_CLASS: Record<string, string> = {
  a: "[aáàâäã]",
  e: "[eéèêë]",
  i: "[iíìîï]",
  o: "[oóòôöõ]",
  u: "[uúùûü]",
  n: "[nñ]",
  c: "[cç]",
};

/** Una palabra ya plegada (sin tildes, minúsculas) como expresión regular que acepta tildes. */
export function accentInsensitiveRegex(word: string): string {
  return [...word].map((ch) => ACCENT_CLASS[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
}

/** Las condiciones (unidas con AND) de un filtro, sin el estado. Siempre acotadas a la empresa. */
export function productConditions(
  orgId: string,
  f: ProductFilter,
  defs: FieldDef[],
  textMatch: "contains" | "equals",
): Prisma.Sql[] {
  const c: Prisma.Sql[] = [Prisma.sql`p."orgId" = ${orgId}`];

  const text = f.search?.text.trim();
  if (text && f.search) {
    if (f.search.mode === "simple") {
      const like = `%${escapeLike(text)}%`;
      c.push(Prisma.sql`(p.name ILIKE ${like} OR coalesce(p.sku, '') ILIKE ${like})`);
    } else {
      const ws = words(text);
      if (ws.length) {
        const attrs = Prisma.sql`(SELECT string_agg(a.value, ' ') FROM jsonb_each_text(${ATTRS}) a)`;
        const haystack = Prisma.sql`(p.name || ' ' || coalesce(p.sku, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(${attrs}, ''))`;
        // ~* : sin distinguir mayúsculas; las clases de cada letra, sin distinguir tildes.
        c.push(Prisma.sql`${haystack} ~* ALL(${ws.map(accentInsensitiveRegex)})`);
      }
    }
  }

  if (f.source === MANUAL_SOURCE) c.push(Prisma.sql`p."sourceId" IS NULL`);
  else if (f.source) c.push(Prisma.sql`p."sourceId" = ${f.source}`);

  // Vigente: hay precio de antes mayor que el de hoy y la fecha (si tiene) no pasó.
  if (f.discount) {
    c.push(Prisma.sql`(p."regularPrice" IS NOT NULL AND p."regularPrice" > p.price AND (p."saleEndsAt" IS NULL OR p."saleEndsAt" > now()))`);
  }

  if (f.price) {
    const min = rangeNumber(f.price.min);
    const max = rangeNumber(f.price.max);
    const between = (col: Prisma.Sql) => {
      const parts: Prisma.Sql[] = [];
      if (min !== null) parts.push(Prisma.sql`${col} >= ${String(min)}::numeric`);
      if (max !== null) parts.push(Prisma.sql`${col} <= ${String(max)}::numeric`);
      return parts.length ? Prisma.sql`(${Prisma.join(parts, " AND ")})` : null;
    };
    const base = between(Prisma.sql`p.price`);
    if (base) {
      if (f.currency) {
        c.push(
          Prisma.sql`((p.currency = ${f.currency} AND ${base}) OR EXISTS (SELECT 1 FROM product_prices pp WHERE pp."productId" = p.id AND pp.currency = ${f.currency} AND ${between(Prisma.sql`pp.amount`)!}))`,
        );
      } else {
        c.push(base);
      }
    }
  }

  if (f.sku) c.push(Prisma.sql`p.sku = ${f.sku}`);
  // Las fechas se guardan en UTC en columnas sin zona.
  if (f.updatedSince) c.push(Prisma.sql`p."updatedAt" >= (${f.updatedSince.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
  if (f.beforeId) c.push(Prisma.sql`p.id < ${f.beforeId}`);

  const types = new Map(defs.map((d) => [d.key, d.type]));
  for (const [key, values] of Object.entries(f.fields ?? {})) {
    const cond = fieldCondition(key, values, types.get(key), textMatch);
    if (cond) c.push(cond);
  }
  return c;
}

const WITH = {
  prices: { orderBy: { currency: "asc" as const } },
  source: { select: { id: true, kind: true, name: true } },
} as const;

/** Valores de campos personalizados sin vacíos, solo texto. */
export function cleanAttributes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
      else if (typeof v === "number") out[k] = String(v);
    }
  }
  return out;
}

export function toProductDto(p: Prisma.ProductGetPayload<{ include: typeof WITH }>): ProductDto {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    currency: p.currency,
    // Precio de hoy, el de antes, porcentaje y fecha (un descuento vencido sale como precio normal).
    ...pricedDto(p),
    attributes: cleanAttributes(p.attributes),
    imageUrl: p.imageUrl,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    source: p.source ?? null,
  };
}

@Injectable()
export class ProductCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  /** Una página del panel, con los recuentos para las pestañas y los filtros. */
  async page(q: ProductListQuery): Promise<ProductPage> {
    const orgId = this.tenant.orgId();
    const defs = await this.defs();
    const where = Prisma.join(productConditions(orgId, this.panelFilter(q), defs, "contains"), " AND ");
    const status = statusSql(q.status) ?? Prisma.sql`TRUE`;

    const [countRows, catalogTotal, currencies] = await Promise.all([
      this.prisma.$queryRaw<Array<{ all: number; active: number; stores: number }>>`
        SELECT count(*)::int AS "all",
               count(*) FILTER (WHERE p."isActive")::int AS "active",
               count(*) FILTER (WHERE p."sourceId" IS NOT NULL AND ${status})::int AS "stores"
        FROM products p
        WHERE ${where}`,
      this.prisma.product.count(),
      this.currencies(orgId),
    ]);
    const all = countRows[0]?.all ?? 0;
    const active = countRows[0]?.active ?? 0;
    const total = q.status === "active" ? active : q.status === "inactive" ? all - active : all;
    // Si la página pedida ya no existe (se borraron productos), se sirve la última.
    const page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)));

    const ids =
      total === 0
        ? []
        : (
            await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT p.id FROM products p
              WHERE ${where} AND ${status}
              ORDER BY ${ORDER[q.sort]}
              LIMIT ${q.pageSize} OFFSET ${(page - 1) * q.pageSize}`
          ).map((r) => r.id);

    return {
      data: await this.byIds(ids),
      total,
      page,
      pageSize: q.pageSize,
      counts: { all, active, inactive: all - active },
      fromStores: countRows[0]?.stores ?? 0,
      catalogTotal,
      currencies,
    };
  }

  /**
   * Activar, desactivar o borrar: los elegidos a mano o todos los que
   * coinciden con los filtros de la pantalla.
   */
  async bulk(input: ProductBulkInput): Promise<ProductBulkResult> {
    const ids = input.ids
      ? (await this.prisma.product.findMany({ where: { id: { in: input.ids } }, select: { id: true } })).map((r) => r.id)
      : await this.matchingIds(parseProductListQuery(new URLSearchParams(input.query ?? "")));
    let count = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      count +=
        input.action === "delete"
          ? (await this.prisma.product.deleteMany({ where: { id: { in: chunk } } })).count
          : (await this.prisma.product.updateMany({ where: { id: { in: chunk } }, data: { isActive: input.action === "activate" } })).count;
    }
    return { count };
  }

  /**
   * Ids de una página de la API pública: por cursor, del más nuevo al más
   * viejo, como siempre. Los campos llegan por clave o por nombre visible.
   */
  async publicIds(q: ListProductsQuery, take: number): Promise<string[]> {
    const orgId = this.tenant.orgId();
    const defs = q.fields ? await this.defs() : [];
    const filter: ProductFilter = {
      search: q.search ? { text: q.search, mode: "simple" } : undefined,
      sku: q.sku,
      updatedSince: q.updatedSince ? new Date(q.updatedSince) : undefined,
      beforeId: q.cursor,
      fields: q.fields ? resolveKeys(q.fields, defs) : undefined,
    };
    const conds = productConditions(orgId, filter, defs, "equals");
    const status = statusSql(q.active === undefined ? "all" : q.active === "true" ? "active" : "inactive");
    if (status) conds.push(status);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p.id FROM products p
      WHERE ${Prisma.join(conds, " AND ")}
      ORDER BY p.id DESC
      LIMIT ${take}`;
    return rows.map((r) => r.id);
  }

  async byIds(ids: string[]): Promise<ProductDto[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({ where: { id: { in: ids } }, include: WITH });
    const pos = new Map(ids.map((id, i) => [id, i]));
    return rows.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!).map(toProductDto);
  }

  async dtoById(id: string): Promise<ProductDto> {
    return toProductDto(await this.prisma.product.findUniqueOrThrow({ where: { id }, include: WITH }));
  }

  // ── Internos ─────────────────────────────────────────────────

  private defs() {
    return this.prisma.productField.findMany({ select: { key: true, type: true, label: true } });
  }

  private panelFilter(q: ProductListQuery): ProductFilter {
    return {
      search: q.q ? { text: q.q, mode: "words" } : undefined,
      source: q.source,
      price: q.price,
      currency: q.currency,
      discount: q.discount,
      fields: q.fields,
    };
  }

  private async matchingIds(q: ProductListQuery): Promise<string[]> {
    const orgId = this.tenant.orgId();
    const defs = await this.defs();
    const conds = productConditions(orgId, this.panelFilter(q), defs, "contains");
    const status = statusSql(q.status);
    if (status) conds.push(status);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p.id FROM products p WHERE ${Prisma.join(conds, " AND ")}`;
    return rows.map((r) => r.id);
  }

  /** Monedas del catálogo (base y adicionales), de la más usada a la menos. */
  private async currencies(orgId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ currency: string }>>`
      SELECT c.currency FROM (
        SELECT currency FROM products WHERE "orgId" = ${orgId}
        UNION ALL
        SELECT currency FROM product_prices WHERE "orgId" = ${orgId}
      ) c
      GROUP BY c.currency
      ORDER BY count(*) DESC, c.currency ASC`;
    return rows.map((r) => r.currency);
  }
}

/** «Talla» o «talla» → la clave del campo; una clave sin campo se queda como llega (normalizada). */
function resolveKeys(fields: Record<string, string[]>, defs: { key: string; label: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [raw, values] of Object.entries(fields)) {
    const key = Object.keys(resolveFieldKeys({ [raw]: "" }, defs))[0] ?? raw;
    out[key] = [...(out[key] ?? []), ...values];
  }
  return out;
}
