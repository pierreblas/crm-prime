import { z } from "zod";
import type { ProductDto } from "./product.schema.js";

// ── Lista de productos del panel: páginas, filtros y orden ────
// La URL de la pantalla es la fuente de verdad (?q=…&status=active&f.talla=M&page=2):
// se recarga o se comparte y queda igual. La web manda esa misma cadena a la
// API, y las acciones en bloque «sobre todos los que coinciden» también.

export const PRODUCT_SORTS = ["recent", "updated", "name", "price_asc", "price_desc"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const PRODUCT_SORT_LABELS: Record<ProductSort, string> = {
  recent: "Más recientes",
  updated: "Últimos modificados",
  name: "Nombre (A–Z)",
  price_asc: "Precio: menor a mayor",
  price_desc: "Precio: mayor a menor",
};

export const PRODUCT_STATUSES = ["all", "active", "inactive"] as const;
export type ProductStatusFilter = (typeof PRODUCT_STATUSES)[number];

/** 48 cuadra con 2, 3, 4 y 6 columnas. */
export const PRODUCT_PAGE_SIZES = [24, 48, 96] as const;
export const PRODUCT_PAGE_SIZE = 48;

/** Origen «sin tienda»: productos creados a mano o importados. */
export const MANUAL_SOURCE = "manual";

/** Los filtros por campo propio van como f.<clave>=valor. */
export const FIELD_FILTER_PREFIX = "f.";

export interface ProductListQuery {
  /** Búsqueda libre: nombre, SKU, descripción y valores de los campos. */
  q: string;
  status: ProductStatusFilter;
  /** Id de la tienda o conexión, MANUAL_SOURCE o null (cualquiera). */
  source: string | null;
  /** Rango de precio ("10..50", "10..", "..50"). */
  price: Range | null;
  /** Moneda del rango de precio; null = el precio base de cada producto. */
  currency: string | null;
  /** Solo los que tienen un descuento vigente. */
  discount: boolean;
  sort: ProductSort;
  page: number;
  pageSize: number;
  /**
   * Por clave de campo. Según el tipo del campo:
   * - lista (select/multiselect): una o varias opciones; vale cualquiera.
   * - sí/no: "si" o "no".
   * - número, fecha u hora: un rango "min..max" (un lado puede ir vacío) o un valor exacto.
   * - texto: lo que tiene que contener.
   */
  fields: Record<string, string[]>;
}

export interface Range {
  min: string | null;
  max: string | null;
}

/** "10..50" → {10, 50}; "10.." → desde 10; "..50" → hasta 50; "7" → exactamente 7. */
export function parseRange(raw: string | null | undefined): Range | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!v.includes("..")) return { min: v, max: v };
  const [a = "", b = ""] = v.split("..");
  const min = a.trim() || null;
  const max = b.trim() || null;
  return min || max ? { min, max } : null;
}

export function formatRange(min: string | null | undefined, max: string | null | undefined): string {
  const a = (min ?? "").trim();
  const b = (max ?? "").trim();
  if (!a && !b) return "";
  return `${a}..${b}`;
}

/** Un número de un rango, admitiendo coma decimal; null si no lo es. */
export function rangeNumber(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type ParamSource = URLSearchParams | Record<string, unknown>;

function getAll(src: ParamSource, key: string): string[] {
  if (src instanceof URLSearchParams) return src.getAll(key);
  const v = src[key];
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
}

function keysOf(src: ParamSource): string[] {
  return src instanceof URLSearchParams ? [...new Set(src.keys())] : Object.keys(src);
}

const intIn = (raw: string | undefined, min: number, max: number, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Lee la consulta de la lista desde la URL (o la query que recibe la API).
 * Nunca falla: un valor que no se entiende se ignora y queda el de por defecto.
 */
export function parseProductListQuery(src: ParamSource): ProductListQuery {
  const one = (k: string) => getAll(src, k)[0];
  const status = one("status");
  const sort = one("sort");
  const pageSize = intIn(one("size"), 12, 100, PRODUCT_PAGE_SIZE);
  const currency = (one("currency") ?? "").trim().toUpperCase();
  const fields: Record<string, string[]> = {};
  for (const k of keysOf(src)) {
    if (!k.startsWith(FIELD_FILTER_PREFIX)) continue;
    const key = k.slice(FIELD_FILTER_PREFIX.length).trim().slice(0, 60);
    const values = getAll(src, k)
      .map((v) => v.trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 50);
    if (key && values.length) fields[key] = values;
  }
  return {
    q: (one("q") ?? "").trim().slice(0, 120),
    status: (PRODUCT_STATUSES as readonly string[]).includes(status ?? "") ? (status as ProductStatusFilter) : "all",
    source: (one("source") ?? "").trim().slice(0, 40) || null,
    price: parseRange(one("price")),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    discount: one("discount") === "1",
    sort: (PRODUCT_SORTS as readonly string[]).includes(sort ?? "") ? (sort as ProductSort) : "recent",
    page: intIn(one("page"), 1, 100_000, 1),
    pageSize,
    fields,
  };
}

/** La consulta como parámetros de URL, sin los valores por defecto (URLs cortas). */
export function productListQueryToParams(q: ProductListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.status !== "all") p.set("status", q.status);
  if (q.source) p.set("source", q.source);
  if (q.price) {
    const r = formatRange(q.price.min, q.price.max);
    if (r) p.set("price", r);
    if (r && q.currency) p.set("currency", q.currency);
  }
  if (q.discount) p.set("discount", "1");
  for (const key of Object.keys(q.fields).sort()) {
    for (const v of q.fields[key]!) p.append(`${FIELD_FILTER_PREFIX}${key}`, v);
  }
  if (q.sort !== "recent") p.set("sort", q.sort);
  if (q.pageSize !== PRODUCT_PAGE_SIZE) p.set("size", String(q.pageSize));
  if (q.page > 1) p.set("page", String(q.page));
  return p;
}

/** Cuántos filtros del panel hay puestos (estado y búsqueda se ven aparte). */
export function countProductFilters(q: ProductListQuery): number {
  return (q.source ? 1 : 0) + (q.price ? 1 : 0) + (q.discount ? 1 : 0) + Object.keys(q.fields).length;
}

export interface ProductPage {
  data: ProductDto[];
  /** Los que cumplen todos los filtros. */
  total: number;
  /** La página servida (si la pedida ya no existe, la última). */
  page: number;
  pageSize: number;
  /** Con los filtros puestos salvo el estado: para las pestañas Todos/Activos/Inactivos. */
  counts: { all: number; active: number; inactive: number };
  /** De los que cumplen los filtros, cuántos vienen de una tienda conectada. */
  fromStores: number;
  /** Tamaño del catálogo entero, sin filtros. */
  catalogTotal: number;
  /** Monedas del catálogo, de la más usada a la menos. */
  currencies: string[];
}

// ── Acciones en bloque ──────────────────────────────────────

export const PRODUCT_BULK_ACTIONS = ["activate", "deactivate", "delete"] as const;
export type ProductBulkAction = (typeof PRODUCT_BULK_ACTIONS)[number];

export const productBulkSchema = z
  .object({
    action: z.enum(PRODUCT_BULK_ACTIONS),
    /** Los elegidos a mano. */
    ids: z.array(z.string().min(1).max(40)).min(1).max(1000).optional(),
    /** O todos los que coinciden con estos filtros: la misma cadena de la URL. */
    query: z.string().max(4000).optional(),
  })
  .refine((v) => (v.ids ? 1 : 0) + (v.query !== undefined ? 1 : 0) === 1, {
    message: "Envía los productos elegidos o los filtros, no los dos",
  });
export type ProductBulkInput = z.infer<typeof productBulkSchema>;

export interface ProductBulkResult {
  count: number;
}
