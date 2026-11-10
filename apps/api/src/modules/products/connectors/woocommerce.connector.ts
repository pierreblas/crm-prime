import { readJson, readText, safeFetch } from "./http";
import { clip, fieldKey, hostOf, stripHtml, toNumber } from "./text";
import {
  CATEGORY_FIELD,
  CATEGORY_KEY,
  ConnectorError,
  LINK_FIELD,
  LINK_KEY,
  STOCK_FIELD,
  STOCK_KEY,
  type CatalogConnector,
  type ConnectorField,
  type ExternalProduct,
  type PullResult,
  type SourceConfig,
  type TestResult,
} from "./types";

/**
 * WooCommerce por su REST API v3 (`/wp-json/wc/v3/`), con la clave de cliente
 * y la clave secreta que la tienda genera en WooCommerce › Ajustes › Avanzado
 * › REST API (permiso de lectura basta para leer; lectura/escritura para que
 * Driony registre solo sus webhooks). Van por HTTPS en la cabecera Basic; si
 * el hosting la quita (pasa), se repite con los parámetros de la URL.
 *
 * Un producto variable se convierte en un producto de Driony por variación
 * (talla, color…), con sus opciones como campos; los atributos fijos
 * («Material: algodón») también, porque el agente de IA responde con ellos.
 */

const PER_PAGE = 100;
const MAX_PAGES = 60; // 6000 productos
const MAX_VARIATION_PAGES = 5;
const MAX_ATTRIBUTES = 10;

interface WooAttribute {
  name: string;
  options?: string[];
  option?: string;
  variation?: boolean;
  visible?: boolean;
}

interface WooProduct {
  id: number;
  name: string;
  permalink?: string;
  type?: string;
  status?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  description?: string;
  short_description?: string;
  purchasable?: boolean;
  images?: { src?: string }[];
  categories?: { name?: string }[];
  attributes?: WooAttribute[];
  variations?: number[];
  stock_status?: string;
  stock_quantity?: number | null;
  manage_stock?: boolean | string;
}

interface WooVariation {
  id: number;
  sku?: string;
  price?: string;
  status?: string;
  purchasable?: boolean;
  description?: string;
  image?: { src?: string } | null;
  attributes?: WooAttribute[];
  stock_status?: string;
  stock_quantity?: number | null;
  manage_stock?: boolean | string;
}

export interface WooRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string>;
  body?: unknown;
}

/**
 * Una llamada a la API de WooCommerce de la tienda. Primero con la cabecera
 * Basic; si el hosting la quita (401), con las claves en la URL por HTTPS.
 */
export async function wooRequest<T>(cfg: SourceConfig, path: string, opts: WooRequestOptions = {}): Promise<{ data: T; headers: Headers }> {
  const key = cfg.credentials.consumerKey;
  const secret = cfg.credentials.consumerSecret;
  if (!key || !secret) throw new ConnectorError("Faltan las claves de la API de WooCommerce");
  const url = new URL(`${cfg.target}/wp-json/wc/v3/${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const init: RequestInit = {
    method: opts.method ?? "GET",
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) };

  let res = await safeFetch(url.toString(), { ...init, headers: { ...headers, Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` } });
  if (res.status === 401 && url.protocol === "https:") {
    url.searchParams.set("consumer_key", key);
    url.searchParams.set("consumer_secret", secret);
    res = await safeFetch(url.toString(), { ...init, headers });
  }
  if (!res.ok) throw new ConnectorError(await explainWooError(res, cfg.target));
  return { data: await readJson<T>(res), headers: res.headers };
}

async function explainWooError(res: Response, target: string): Promise<string> {
  const body = await readText(res, 200_000).catch(() => "");
  let code = "";
  let message = "";
  try {
    const parsed = JSON.parse(body) as { code?: string; message?: string };
    code = parsed.code ?? "";
    message = stripHtml(parsed.message) ?? "";
  } catch {
    /* no era JSON */
  }
  if (res.status === 401 || res.status === 403) {
    return `WooCommerce rechazó las claves${message ? ` (${message})` : ""}. Comprueba que las copiaste enteras y que la clave tiene permiso de lectura.`;
  }
  if (res.status === 404) {
    return code === "rest_no_route" || !code
      ? `En ${hostOf(target)} no responde la API de WooCommerce. ¿Es una tienda WooCommerce? Si lo es, en WordPress › Ajustes › Enlaces permanentes elige cualquier opción menos «Simple».`
      : message || `${hostOf(target)} respondió 404`;
  }
  return `${hostOf(target)} respondió ${res.status}${message ? `: ${message}` : ""}`;
}

export class WooCommerceConnector implements CatalogConnector {
  readonly kind = "woocommerce" as const;

  normalizeTarget(raw: string): string {
    let value = raw.trim();
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ConnectorError("La dirección de la tienda no es válida");
    }
    url.hash = "";
    url.search = "";
    // WooCommerce puede vivir en una carpeta (mitienda.com/tienda); lo que sobra es /wp-json… y la barra final.
    url.pathname = url.pathname.replace(/\/wp-json.*$/i, "").replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  }

  async test(cfg: SourceConfig): Promise<TestResult> {
    const [currency, first, name] = await Promise.all([
      this.currency(cfg),
      wooRequest<WooProduct[]>(cfg, "products", { params: { per_page: "5", status: "publish" } }),
      this.storeName(cfg),
    ]);
    const total = Number(first.headers.get("x-wp-total"));
    return {
      ok: true,
      name,
      currency,
      count: Number.isFinite(total) ? total : null,
      sample: first.data.map((p) => p.name).filter(Boolean).slice(0, 5),
      warnings: [],
    };
  }

  async pull(cfg: SourceConfig): Promise<PullResult> {
    const warnings: string[] = [];
    const currency = (await this.currency(cfg)) ?? cfg.defaultCurrency ?? "USD";
    const storeName = await this.storeName(cfg);
    const items: ExternalProduct[] = [];
    // Nombre de cada opción/atributo → su etiqueta original, para crear los campos.
    const labels = new Map<string, string>();
    let anyStock = false;
    let anyLink = false;
    let anyCategory = false;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, headers } = await wooRequest<WooProduct[]>(cfg, "products", {
        params: { per_page: String(PER_PAGE), page: String(page), status: "publish", orderby: "id", order: "asc" },
      });
      for (const p of data) {
        const base = this.baseAttributes(p, labels);
        if (p.permalink) anyLink = true;
        if (p.categories?.length) anyCategory = true;
        if (p.type === "variable" && p.variations?.length) {
          const variations = await this.variations(cfg, p.id);
          if (variations.length) {
            for (const v of variations) {
              const item = this.variant(p, v, currency, base, labels);
              if (item.attributes[STOCK_KEY] !== undefined) anyStock = true;
              items.push(item);
            }
            continue;
          }
        }
        const item = this.simple(p, currency, base);
        if (item.attributes[STOCK_KEY] !== undefined) anyStock = true;
        items.push(item);
      }
      const pages = Number(headers.get("x-wp-totalpages"));
      if (data.length < PER_PAGE || (Number.isFinite(pages) && page >= pages)) break;
      if (page === MAX_PAGES) warnings.push(`La tienda tiene más de ${MAX_PAGES * PER_PAGE} productos: se leyeron los primeros`);
    }

    const fields: ConnectorField[] = [...labels].map(([key, label]) => ({ key, label, type: "text", showOnCard: true }));
    if (anyStock) fields.push(STOCK_FIELD);
    if (anyLink) fields.push(LINK_FIELD);
    if (anyCategory) fields.push(CATEGORY_FIELD);
    return { items, storeName, currency, fields, warnings };
  }

  // ── Conversión ───────────────────────────────────────────────

  /** Categoría, enlace y atributos fijos del producto: los heredan sus variaciones. */
  private baseAttributes(p: WooProduct, labels: Map<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    const categories = (p.categories ?? []).map((c) => c.name?.trim()).filter(Boolean) as string[];
    if (categories.length) out[CATEGORY_KEY] = categories.join(", ");
    if (p.permalink) out[LINK_KEY] = p.permalink;
    let n = 0;
    for (const a of p.attributes ?? []) {
      if (!a.name || a.variation || a.visible === false || !a.options?.length) continue;
      if (n++ >= MAX_ATTRIBUTES) break;
      const key = fieldKey(a.name);
      labels.set(key, a.name.trim());
      out[key] = a.options.map((o) => String(o).trim()).filter(Boolean).join(", ").slice(0, 500);
    }
    return out;
  }

  private simple(p: WooProduct, currency: string, base: Record<string, string>): ExternalProduct {
    const attributes = { ...base };
    const stock = stockOf(p.manage_stock, p.stock_quantity, p.stock_status, null);
    if (stock !== undefined) attributes[STOCK_KEY] = stock;
    return {
      externalId: String(p.id),
      name: clip(p.name?.trim() || `Producto ${p.id}`, 160)!,
      sku: p.sku?.trim() || null,
      description: clip(stripHtml(p.short_description) ?? stripHtml(p.description), 2000),
      price: toNumber(p.price ?? p.regular_price),
      currency,
      imageUrl: p.images?.[0]?.src ?? null,
      isActive: p.status === "publish" && p.purchasable !== false,
      attributes,
    };
  }

  private variant(p: WooProduct, v: WooVariation, currency: string, base: Record<string, string>, labels: Map<string, string>): ExternalProduct {
    const attributes = { ...base };
    const options: string[] = [];
    for (const a of v.attributes ?? []) {
      if (!a.name) continue;
      const key = fieldKey(a.name);
      labels.set(key, a.name.trim());
      const value = String(a.option ?? "").trim();
      if (value) {
        attributes[key] = value;
        options.push(value);
      }
    }
    const stock = stockOf(v.manage_stock, v.stock_quantity, v.stock_status, p);
    if (stock !== undefined) attributes[STOCK_KEY] = stock;
    const parentName = p.name?.trim() || `Producto ${p.id}`;
    return {
      externalId: `${p.id}:${v.id}`,
      name: clip(options.length ? `${parentName} – ${options.join(" / ")}` : `${parentName} #${v.id}`, 160)!,
      sku: v.sku?.trim() || (p.sku?.trim() ? `${p.sku.trim()}-${v.id}` : null),
      description: clip(stripHtml(v.description) ?? stripHtml(p.short_description) ?? stripHtml(p.description), 2000),
      price: toNumber(v.price ?? p.price ?? p.regular_price),
      currency,
      imageUrl: v.image?.src ?? p.images?.[0]?.src ?? null,
      isActive: v.purchasable !== false,
      attributes,
    };
  }

  private async variations(cfg: SourceConfig, productId: number): Promise<WooVariation[]> {
    const out: WooVariation[] = [];
    for (let page = 1; page <= MAX_VARIATION_PAGES; page++) {
      const { data, headers } = await wooRequest<WooVariation[]>(cfg, `products/${productId}/variations`, {
        params: { per_page: String(PER_PAGE), page: String(page), status: "publish" },
      });
      out.push(...data);
      const pages = Number(headers.get("x-wp-totalpages"));
      if (data.length < PER_PAGE || (Number.isFinite(pages) && page >= pages)) break;
    }
    return out;
  }

  // ── Datos de la tienda ───────────────────────────────────────

  private async currency(cfg: SourceConfig): Promise<string | null> {
    const { data } = await wooRequest<{ code?: string }>(cfg, "data/currencies/current");
    return data.code ? data.code.toUpperCase() : null;
  }

  /** El índice de WordPress (`/wp-json/`) es público y trae el nombre del sitio. */
  private async storeName(cfg: SourceConfig): Promise<string | null> {
    try {
      const res = await safeFetch(`${cfg.target}/wp-json/`, { headers: { Accept: "application/json" } }, { timeoutMs: 10_000 });
      if (!res.ok) return null;
      const body = await readJson<{ name?: string }>(res);
      return body.name?.trim() || null;
    } catch {
      return null;
    }
  }
}

/**
 * Unidades disponibles como texto, o undefined si la tienda no lleva stock.
 * Una variación con `manage_stock: "parent"` usa el del producto padre.
 */
function stockOf(manage: boolean | string | undefined, quantity: number | null | undefined, status: string | undefined, parent: WooProduct | null): string | undefined {
  if (manage === true) return String(quantity ?? 0);
  if (manage === "parent" && parent?.manage_stock === true) return String(parent.stock_quantity ?? 0);
  if ((status ?? parent?.stock_status) === "outofstock") return "0";
  return undefined;
}
