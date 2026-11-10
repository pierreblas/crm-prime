import { MERCADO_LIBRE_SITES } from "@crm/shared";
import { MercadoLibreApiError, MercadoLibreClient } from "./mercadolibre.client";
import { clip, fieldKey, stripHtml } from "./text";
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
 * Las publicaciones de una cuenta de vendedor de Mercado Libre como catálogo.
 *
 * El `target` de la conexión es el id de usuario del vendedor; las
 * credenciales guardan sus tokens (el refresh token es de un solo uso, así
 * que al renovarlo se guarda en el acto con `saveCredentials`). Se leen las
 * publicaciones activas y las pausadas (estas quedan inactivas en Driony);
 * las cerradas dejan de venir y Driony las desactiva. Cada variación (talla,
 * color…) es un producto de Driony, con sus combinaciones en campos, el
 * stock, el enlace a la publicación, la categoría y la marca.
 *
 * Lectura: `/users/{id}/items/search` da los ids (por páginas de 100 hasta
 * 1000; con más, en modo scan), `/items?ids=` trae hasta 20 por llamada,
 * `/items/{id}/description` la descripción y `/categories/{id}` el nombre de
 * la categoría (público).
 */

const PAGE = 100;
const OFFSET_LIMIT = 1000; // más allá, Mercado Libre exige search_type=scan
const MULTIGET = 20;
const MAX_ITEMS = 5000;
const DESCRIPTION_PARALLEL = 4;
const TOKEN_MARGIN_MS = 10 * 60_000;

const BRAND_KEY = fieldKey("Marca");
const BRAND_FIELD: ConnectorField = { key: BRAND_KEY, label: "Marca", type: "text", showOnCard: false, help: "Marca según la publicación." };
const CONDITION_KEY = fieldKey("Condición");
const CONDITION_FIELD: ConnectorField = { key: CONDITION_KEY, label: "Condición", type: "text", showOnCard: false, help: "Nuevo, usado o reacondicionado, según la publicación." };
const CONDITION_LABEL: Record<string, string> = { new: "Nuevo", used: "Usado", not_specified: "Sin especificar" };

export interface MlAttribute {
  id?: string;
  name?: string;
  value_name?: string | null;
}

export interface MlVariation {
  id: number | string;
  price?: number | null;
  available_quantity?: number | null;
  attribute_combinations?: MlAttribute[];
  picture_ids?: string[];
  seller_custom_field?: string | null;
  attributes?: MlAttribute[];
}

export interface MlItem {
  id: string;
  title?: string;
  price?: number | null;
  currency_id?: string;
  available_quantity?: number | null;
  status?: string;
  permalink?: string | null;
  thumbnail?: string | null;
  pictures?: { id?: string; url?: string; secure_url?: string }[];
  seller_custom_field?: string | null;
  attributes?: MlAttribute[];
  variations?: MlVariation[];
  category_id?: string | null;
  condition?: string | null;
}

interface SearchPage {
  results?: string[];
  paging?: { total?: number; offset?: number; limit?: number };
  scroll_id?: string;
}

type Multiget = { code: number; body?: MlItem & { message?: string } }[];

export class MercadoLibreConnector implements CatalogConnector {
  readonly kind = "mercadolibre" as const;

  constructor(private readonly client: MercadoLibreClient = new MercadoLibreClient()) {}

  /** El id de usuario del vendedor, tal cual lo da Mercado Libre. */
  normalizeTarget(raw: string): string {
    const id = raw.trim();
    if (!/^\d{1,20}$/.test(id)) throw new ConnectorError("La cuenta de Mercado Libre no es válida: vuelve a conectarla desde Productos › Tiendas");
    return id;
  }

  async test(cfg: SourceConfig): Promise<TestResult> {
    const session = await this.session(cfg);
    const page = await session.get<SearchPage>(`/users/${cfg.target}/items/search?status=active&limit=5&offset=0`);
    const ids = (page.results ?? []).slice(0, 5);
    const sample = ids.length ? (await session.get<Multiget>(`/items?ids=${ids.join(",")}`)).filter((r) => r.code === 200 && r.body?.title).map((r) => r.body!.title!) : [];
    return {
      ok: true,
      name: cfg.credentials.nickname || null,
      currency: cfg.defaultCurrency ?? siteCurrency(cfg.credentials.siteId),
      count: page.paging?.total ?? null,
      sample,
      warnings: [],
      ...(session.patch ? { credentialsPatch: session.patch } : {}),
    };
  }

  async pull(cfg: SourceConfig): Promise<PullResult> {
    const session = await this.session(cfg);
    const warnings: string[] = [];
    const ids = [...(await this.listIds(session, cfg.target, "active")), ...(await this.listIds(session, cfg.target, "paused"))];
    if (ids.length > MAX_ITEMS) {
      warnings.push(`La cuenta tiene ${ids.length} publicaciones; se leen las primeras ${MAX_ITEMS}`);
      ids.length = MAX_ITEMS;
    }

    const items: MlItem[] = [];
    for (let i = 0; i < ids.length; i += MULTIGET) {
      const chunk = ids.slice(i, i + MULTIGET);
      const res = await session.get<Multiget>(`/items?ids=${chunk.join(",")}`);
      for (const r of res) {
        if (r.code === 200 && r.body?.id) items.push(r.body);
        else warnings.push(`Una publicación no se pudo leer (${r.code}${r.body?.message ? `: ${r.body.message}` : ""})`);
      }
    }

    // Descripciones: una llamada por publicación, de pocas en pocas.
    const descriptions = new Map<string, string | null>();
    let descriptionErrors = 0;
    await inBatches(items, DESCRIPTION_PARALLEL, async (item) => {
      try {
        const d = await session.get<{ plain_text?: string; text?: string }>(`/items/${item.id}/description`);
        descriptions.set(item.id, clip((d.plain_text?.trim() || stripHtml(d.text) || "").trim() || null, 2000));
      } catch (e) {
        descriptions.set(item.id, null);
        if (!(e instanceof MercadoLibreApiError && e.status === 404)) descriptionErrors++;
      }
    });
    if (descriptionErrors) warnings.push(`${descriptionErrors} descripción(es) no se pudieron leer; se conservan las anteriores en la siguiente lectura`);

    // Nombres de categoría (endpoint público, uno por categoría distinta).
    const categories = new Map<string, string | null>();
    for (const id of new Set(items.map((i) => i.category_id).filter((c): c is string => !!c))) {
      try {
        categories.set(id, (await this.client.get<{ name?: string }>(`/categories/${id}`, null)).name ?? null);
      } catch {
        categories.set(id, null);
      }
    }

    const fields = new Map<string, ConnectorField>([
      [STOCK_KEY, STOCK_FIELD],
      [LINK_KEY, LINK_FIELD],
      [CATEGORY_KEY, CATEGORY_FIELD],
    ]);
    const currency = cfg.defaultCurrency ?? siteCurrency(cfg.credentials.siteId) ?? "USD";
    const out: ExternalProduct[] = [];
    for (const item of items) {
      out.push(...mapMercadoLibreItem(item, descriptions.get(item.id) ?? null, item.category_id ? (categories.get(item.category_id) ?? null) : null, fields, currency));
    }
    return {
      items: out,
      storeName: cfg.credentials.nickname || null,
      currency: out[0]?.currency ?? currency,
      fields: [...fields.values()],
      warnings,
      ...(session.patch ? { credentialsPatch: session.patch } : {}),
    };
  }

  /** Todos los ids de publicaciones con ese estado: por offset hasta 1000, en modo scan si hay más. */
  private async listIds(session: Session, userId: string, status: "active" | "paused"): Promise<string[]> {
    const first = await session.get<SearchPage>(`/users/${userId}/items/search?status=${status}&limit=${PAGE}&offset=0`);
    const total = first.paging?.total ?? first.results?.length ?? 0;
    const ids = [...(first.results ?? [])];
    if (total <= OFFSET_LIMIT) {
      for (let offset = PAGE; offset < Math.min(total, MAX_ITEMS); offset += PAGE) {
        const page = await session.get<SearchPage>(`/users/${userId}/items/search?status=${status}&limit=${PAGE}&offset=${offset}`);
        if (!page.results?.length) break;
        ids.push(...page.results);
      }
      return ids;
    }
    ids.length = 0;
    let scroll: string | undefined;
    for (let guard = 0; guard < MAX_ITEMS / PAGE + 1; guard++) {
      const page = await session.get<SearchPage>(
        `/users/${userId}/items/search?status=${status}&search_type=scan&limit=${PAGE}${scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : ""}`,
      );
      if (!page.results?.length) break;
      ids.push(...page.results);
      scroll = page.scroll_id ?? scroll;
      if (!scroll || ids.length >= MAX_ITEMS) break;
    }
    return ids;
  }

  /**
   * El token con el que leer. Si está por caducar se renueva y se guarda en el
   * acto (el refresh token viejo ya no sirve); ante un 401 inesperado se
   * renueva una sola vez y se repite la llamada.
   */
  private async session(cfg: SourceConfig): Promise<Session> {
    const c = cfg.credentials;
    if (!c.refreshToken) throw new ConnectorError("La cuenta de Mercado Libre no tiene autorización guardada: vuelve a conectarla desde Productos › Tiendas");
    let token = c.accessToken ?? "";
    let patch: Record<string, string> | undefined;
    let refreshed = false;
    const renew = async () => {
      const t = await this.client.refresh(patch?.refreshToken ?? c.refreshToken!);
      token = t.accessToken;
      patch = { accessToken: t.accessToken, refreshToken: t.refreshToken, tokenExpiresAt: String(t.expiresAt) };
      refreshed = true;
      await cfg.saveCredentials?.(patch);
    };
    if (!token || Number(c.tokenExpiresAt ?? 0) <= Date.now() + TOKEN_MARGIN_MS) await renew();
    const client = this.client;
    return {
      get patch() {
        return patch;
      },
      async get<T>(path: string): Promise<T> {
        try {
          return await client.get<T>(path, token);
        } catch (e) {
          if (e instanceof MercadoLibreApiError && e.status === 401 && !refreshed) {
            await renew();
            return client.get<T>(path, token);
          }
          throw e;
        }
      },
    };
  }
}

interface Session {
  readonly patch: Record<string, string> | undefined;
  get<T>(path: string): Promise<T>;
}

/** Una publicación de Mercado Libre en el molde de Driony: un producto, o uno por variación. */
export function mapMercadoLibreItem(
  item: MlItem,
  description: string | null,
  categoryName: string | null,
  fields: Map<string, ConnectorField>,
  fallbackCurrency: string,
): ExternalProduct[] {
  const title = clip(item.title?.trim() || `Publicación ${item.id}`, 160)!;
  const active = item.status === "active";
  const currency = item.currency_id || fallbackCurrency;
  const baseImage = pictureUrl(item.pictures?.[0]) ?? item.thumbnail ?? null;
  const itemSku = skuOf(item.attributes, item.seller_custom_field);

  const base: Record<string, string> = {};
  if (item.permalink) base[LINK_KEY] = item.permalink;
  if (categoryName) base[CATEGORY_KEY] = categoryName;
  const brand = valueOf(item.attributes, "BRAND");
  if (brand) {
    base[BRAND_KEY] = brand;
    fields.set(BRAND_KEY, BRAND_FIELD);
  }
  if (item.condition && item.condition !== "new") {
    base[CONDITION_KEY] = CONDITION_LABEL[item.condition] ?? "Reacondicionado";
    fields.set(CONDITION_KEY, CONDITION_FIELD);
  }

  const variations = item.variations ?? [];
  if (!variations.length) {
    return [
      {
        externalId: item.id,
        name: title,
        sku: itemSku,
        description,
        price: toPrice(item.price),
        currency,
        imageUrl: baseImage,
        isActive: active,
        attributes: { ...base, [STOCK_KEY]: String(item.available_quantity ?? 0) },
      },
    ];
  }
  return variations.map((v) => {
    const combos = (v.attribute_combinations ?? []).filter((c) => c.name && c.value_name);
    const attributes: Record<string, string> = { ...base };
    for (const c of combos) {
      const key = fieldKey(c.name!);
      attributes[key] = c.value_name!;
      if (!fields.has(key)) fields.set(key, { key, label: c.name!, type: "text", showOnCard: true });
    }
    attributes[STOCK_KEY] = String(v.available_quantity ?? 0);
    const picture = v.picture_ids?.[0] ? item.pictures?.find((p) => p.id === v.picture_ids![0]) : undefined;
    const options = combos.map((c) => c.value_name!);
    return {
      externalId: `${item.id}:${v.id}`,
      name: clip(options.length ? `${title} – ${options.join(" / ")}` : `${title} #${v.id}`, 160)!,
      sku: skuOf(v.attributes, v.seller_custom_field) ?? (variations.length === 1 ? itemSku : null),
      description,
      price: toPrice(v.price ?? item.price),
      currency,
      imageUrl: pictureUrl(picture) ?? baseImage,
      isActive: active,
      attributes,
    };
  });
}

function skuOf(attributes: MlAttribute[] | undefined, legacy: string | null | undefined): string | null {
  return valueOf(attributes, "SELLER_SKU") ?? (legacy?.trim() || null);
}

function valueOf(attributes: MlAttribute[] | undefined, id: string): string | null {
  const v = attributes?.find((a) => a.id === id)?.value_name?.trim();
  return v || null;
}

function pictureUrl(p: { url?: string; secure_url?: string } | undefined): string | null {
  return p?.secure_url || p?.url || null;
}

function toPrice(raw: number | null | undefined): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function siteCurrency(siteId: string | undefined): string | null {
  return MERCADO_LIBRE_SITES.find((s) => s.id === siteId)?.currency ?? null;
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
