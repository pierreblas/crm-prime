import { env } from "../../../common/utils/env";
import { readJson, readText, safeFetch } from "./http";
import { clip, fieldKey, sleep } from "./text";
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
 * Shopify por la GraphQL Admin API (la REST es «legacy» desde octubre de 2024).
 *
 * Credenciales, dos caminos:
 *  - un token de acceso de administrador (shpat_…) de una app creada en el
 *    panel de la tienda (ya no se pueden crear nuevas desde el 1 de enero de
 *    2026, pero las que existen siguen funcionando);
 *  - el ID y el secreto de cliente de una app del Dev Dashboard instalada en
 *    la tienda: con ellos Shopify da un token de 24 h (client credentials
 *    grant), que se guarda cifrado y se renueva solo.
 *
 * Cada variante (talla, color…) es un producto de Driony; un producto sin
 * variantes, uno solo. Solo se leen los productos activos; los archivados y
 * borradores dejan de venir y Driony los desactiva.
 */

const PAGE = 15; // con 10 variantes por producto el coste pedido queda bajo el máximo de 1000
const VARIANTS_INLINE = 10;
const VARIANTS_REST = 150;
const MAX_PAGES = 400; // 6000 productos

const VARIANT_FIELDS = `
  id title sku price compareAtPrice inventoryQuantity availableForSale
  selectedOptions { name value }
  media(first: 1) { nodes { preview { image { url } } } }
`;

const PRODUCTS_QUERY = `query CatalogPage($after: String) {
  products(first: ${PAGE}, after: $after, query: "status:active", sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle productType vendor onlineStoreUrl hasOnlyDefaultVariant
      description(truncateAt: 2000)
      featuredMedia { preview { image { url } } }
      variants(first: ${VARIANTS_INLINE}) { pageInfo { hasNextPage } nodes { ${VARIANT_FIELDS} } }
    }
  }
}`;

const REST_VARIANTS_QUERY = `query RestOfVariants($q: String!) {
  productVariants(first: ${VARIANTS_REST}, query: $q) { pageInfo { hasNextPage } nodes { ${VARIANT_FIELDS} } }
}`;

const TEST_QUERY = `{
  shop { name currencyCode }
  productsCount(query: "status:active") { count }
  products(first: 5, query: "status:active") { nodes { title } }
}`;

interface ShopifyVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  selectedOptions: { name: string; value: string }[];
  media?: { nodes: { preview: { image: { url: string } | null } | null }[] };
}

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  onlineStoreUrl: string | null;
  hasOnlyDefaultVariant: boolean;
  description: string;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { pageInfo: { hasNextPage: boolean }; nodes: ShopifyVariant[] };
}

interface ProductsPage {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProduct[] };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: { maximumAvailable?: number; currentlyAvailable?: number; restoreRate?: number };
    };
  };
}

/** El token con el que llamar: el pegado por el usuario, o uno de 24 h pedido con el ID y secreto de cliente. */
export async function shopifyToken(cfg: SourceConfig): Promise<{ token: string; patch?: Record<string, string> }> {
  const c = cfg.credentials;
  if (c.accessToken) return { token: c.accessToken };
  if (!c.clientId || !c.clientSecret) {
    throw new ConnectorError("Faltan las credenciales de Shopify: pega el token de acceso, o el ID y el secreto de cliente de tu app");
  }
  const expiresAt = Number(c.cachedTokenExpiresAt ?? 0);
  if (c.cachedToken && expiresAt > Date.now() + 2 * 60_000) return { token: c.cachedToken };

  const res = await safeFetch(`https://${cfg.target}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret }).toString(),
  });
  if (!res.ok) {
    const body = await readText(res, 100_000).catch(() => "");
    let error = "";
    try {
      const parsed = JSON.parse(body) as { error?: string; error_description?: string; errors?: unknown };
      error = parsed.error_description || parsed.error || (typeof parsed.errors === "string" ? parsed.errors : "") || "";
    } catch {
      /* sin cuerpo JSON */
    }
    if (res.status === 404) throw new ConnectorError(`No existe la tienda ${cfg.target}`);
    if (/shop_not_permitted/i.test(error)) {
      throw new ConnectorError("La app no está instalada en esta tienda o pertenece a otra organización. Instálala desde el Dev Dashboard, en la misma organización que la tienda.");
    }
    if (res.status === 401 || res.status === 400 || /invalid_client/i.test(error)) {
      throw new ConnectorError(`Shopify rechazó el ID o el secreto de cliente${error ? ` (${error})` : ""}`);
    }
    throw new ConnectorError(`Shopify respondió ${res.status}${error ? `: ${error}` : ""}`);
  }
  const data = await readJson<{ access_token?: string; expires_in?: number }>(res);
  if (!data.access_token) throw new ConnectorError("Shopify no devolvió un token de acceso");
  const until = Date.now() + (data.expires_in ?? 86_399) * 1000;
  return { token: data.access_token, patch: { cachedToken: data.access_token, cachedTokenExpiresAt: String(until) } };
}

/** Una consulta GraphQL a la tienda, con espera cuando Shopify limita (THROTTLED). */
export async function shopifyGraphql<T>(cfg: SourceConfig, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const version = env("SHOPIFY_API_VERSION") ?? "2026-04";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await safeFetch(`https://${cfg.target}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) throw new ConnectorError("Shopify rechazó el token de acceso. Si la app se desinstaló o el token cambió, vuelve a pegarlo.");
    if (res.status === 402) throw new ConnectorError("La tienda de Shopify está congelada o sin plan activo");
    if (res.status === 403) throw new ConnectorError("La app no tiene permiso para leer productos (read_products). Añádelo en sus permisos y vuelve a instalarla en la tienda.");
    if (res.status === 404) throw new ConnectorError(`No existe la tienda ${cfg.target}`);
    if (res.status === 429 || res.status === 503) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new ConnectorError(`Shopify respondió ${res.status}`);

    const body = await readJson<GraphQLResponse<T>>(res);
    const throttled = body.errors?.find((e) => e.extensions?.code === "THROTTLED");
    if (throttled) {
      const cost = body.extensions?.cost;
      const need = (cost?.requestedQueryCost ?? 500) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
      const seconds = Math.min(30, Math.max(1, Math.ceil(need / (cost?.throttleStatus?.restoreRate ?? 50))));
      await sleep(seconds * 1000);
      continue;
    }
    if (body.errors?.length) {
      const first = body.errors[0]!;
      if (first.extensions?.code === "ACCESS_DENIED") {
        throw new ConnectorError("La app no tiene permiso para leer productos (read_products). Añádelo en sus permisos y vuelve a instalarla en la tienda.");
      }
      throw new ConnectorError(`Shopify: ${first.message}`);
    }
    if (!body.data) throw new ConnectorError("Shopify no devolvió datos");
    return body.data;
  }
  throw new ConnectorError("Shopify limitó las peticiones demasiado tiempo; inténtalo más tarde");
}

export class ShopifyConnector implements CatalogConnector {
  readonly kind = "shopify" as const;

  normalizeTarget(raw: string): string {
    let host = raw.trim().toLowerCase();
    if (host.includes("://")) {
      try {
        host = new URL(host).hostname;
      } catch {
        throw new ConnectorError("El dominio de la tienda no es válido");
      }
    }
    host = host.split("/")[0]!.replace(/^www\./, "");
    if (!host.includes(".")) host = `${host}.myshopify.com`;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) {
      throw new ConnectorError("Usa el dominio .myshopify.com de la tienda (en Shopify: Configuración › Dominios), no tu dominio propio");
    }
    return host;
  }

  async test(cfg: SourceConfig): Promise<TestResult> {
    const { token, patch } = await shopifyToken(cfg);
    const data = await shopifyGraphql<{
      shop: { name: string; currencyCode: string };
      productsCount: { count: number } | null;
      products: { nodes: { title: string }[] };
    }>(cfg, token, TEST_QUERY);
    return {
      ok: true,
      name: data.shop?.name ?? null,
      currency: data.shop?.currencyCode ?? null,
      count: data.productsCount?.count ?? null,
      sample: (data.products?.nodes ?? []).map((n) => n.title).slice(0, 5),
      warnings: [],
      ...(patch ? { credentialsPatch: patch } : {}),
    };
  }

  async pull(cfg: SourceConfig): Promise<PullResult> {
    const warnings: string[] = [];
    const { token, patch } = await shopifyToken(cfg);
    const shop = await shopifyGraphql<{ shop: { name: string; currencyCode: string } }>(cfg, token, `{ shop { name currencyCode } }`);
    const currency = shop.shop?.currencyCode ?? cfg.defaultCurrency ?? "USD";
    const items: ExternalProduct[] = [];
    const labels = new Map<string, string>();
    let anyStock = false;
    let anyLink = false;
    let anyCategory = false;

    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data: ProductsPage = await shopifyGraphql<ProductsPage>(cfg, token, PRODUCTS_QUERY, { after });
      for (const p of data.products.nodes) {
        let variants = p.variants.nodes;
        if (p.variants.pageInfo.hasNextPage) {
          const rest = await shopifyGraphql<{ productVariants: { pageInfo: { hasNextPage: boolean }; nodes: ShopifyVariant[] } }>(cfg, token, REST_VARIANTS_QUERY, {
            q: `product_id:${numericId(p.id)}`,
          });
          variants = rest.productVariants.nodes;
          if (rest.productVariants.pageInfo.hasNextPage) warnings.push(`«${p.title}» tiene más de ${VARIANTS_REST} variantes: se leyeron las primeras`);
        }
        const base: Record<string, string> = {};
        if (p.onlineStoreUrl) {
          base[LINK_KEY] = p.onlineStoreUrl;
          anyLink = true;
        }
        if (p.productType?.trim()) {
          base[CATEGORY_KEY] = p.productType.trim();
          anyCategory = true;
        }
        const image = p.featuredMedia?.preview?.image?.url ?? null;
        if (p.hasOnlyDefaultVariant || variants.length <= 1) {
          const v = variants[0];
          const item = this.item(`p:${numericId(p.id)}`, p.title, v ?? null, p.description, image, currency, base, labels, false);
          if (item.attributes[STOCK_KEY] !== undefined) anyStock = true;
          items.push(item);
          continue;
        }
        for (const v of variants) {
          const item = this.item(`v:${numericId(v.id)}`, p.title, v, p.description, image, currency, base, labels, true);
          if (item.attributes[STOCK_KEY] !== undefined) anyStock = true;
          items.push(item);
        }
      }
      if (!data.products.pageInfo.hasNextPage || !data.products.pageInfo.endCursor) break;
      after = data.products.pageInfo.endCursor;
      if (page === MAX_PAGES - 1) warnings.push(`La tienda tiene más de ${MAX_PAGES * PAGE} productos: se leyeron los primeros`);
    }

    const fields: ConnectorField[] = [...labels].map(([key, label]) => ({ key, label, type: "text", showOnCard: true }));
    if (anyStock) fields.push(STOCK_FIELD);
    if (anyLink) fields.push(LINK_FIELD);
    if (anyCategory) fields.push(CATEGORY_FIELD);
    return { items, storeName: shop.shop?.name ?? null, currency, fields, warnings, ...(patch ? { credentialsPatch: patch } : {}) };
  }

  private item(
    externalId: string,
    title: string,
    v: ShopifyVariant | null,
    description: string,
    productImage: string | null,
    currency: string,
    base: Record<string, string>,
    labels: Map<string, string>,
    withOptions: boolean,
  ): ExternalProduct {
    const attributes = { ...base };
    if (withOptions && v) {
      for (const o of v.selectedOptions ?? []) {
        if (!o.name || !o.value) continue;
        const key = fieldKey(o.name);
        labels.set(key, o.name.trim());
        attributes[key] = o.value.trim().slice(0, 200);
      }
    }
    if (typeof v?.inventoryQuantity === "number") attributes[STOCK_KEY] = String(v.inventoryQuantity);
    const variantTitle = v && withOptions && v.title && v.title !== "Default Title" ? ` – ${v.title}` : "";
    return {
      externalId,
      name: clip(`${title.trim()}${variantTitle}`, 160)!,
      sku: v?.sku?.trim() || null,
      description: clip(description?.trim() || null, 2000),
      price: Number(v?.price ?? 0) || 0,
      currency,
      imageUrl: v?.media?.nodes?.[0]?.preview?.image?.url ?? productImage,
      isActive: true,
      attributes,
    };
  }
}

/** gid://shopify/Product/123 → 123 */
function numericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}
