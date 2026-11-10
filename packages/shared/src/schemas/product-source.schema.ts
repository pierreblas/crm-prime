import { z } from "zod";

// ── Catálogos conectados ─────────────────────────────────────
// Un catálogo conectado es una tienda o una hoja de la que Driony lee los
// productos cada cierto tiempo: WooCommerce, Shopify o una hoja de Google
// (cualquier CSV por enlace). La tienda manda sobre nombre, precio, imagen y
// descripción; lo que es solo de Driony (campos propios, precios en otras
// monedas) se conserva.

// «mercadolibre»: la cuenta de vendedor, autorizada con OAuth (la app es de la plataforma).
// «api»: productos que empuja un sistema externo con una clave de API (no se lee nada; se recibe).
export const productSourceKinds = ["woocommerce", "shopify", "mercadolibre", "sheet", "api"] as const;
export type ProductSourceKind = (typeof productSourceKinds)[number];

export const PRODUCT_SOURCE_LABEL: Record<ProductSourceKind, string> = {
  woocommerce: "WooCommerce",
  shopify: "Shopify",
  mercadolibre: "Mercado Libre",
  sheet: "Google Sheets / CSV",
  api: "API",
};

/** Cada cuánto se vuelve a leer el catálogo, en minutos. 0 = solo a mano. */
export const PRODUCT_SYNC_INTERVALS = [
  { minutes: 60, label: "Cada hora" },
  { minutes: 360, label: "Cada 6 horas" },
  { minutes: 1440, label: "Una vez al día" },
  { minutes: 0, label: "Solo cuando yo lo pida" },
] as const;

export const productSourceStatuses = ["idle", "running", "ok", "error"] as const;
export type ProductSourceStatus = (typeof productSourceStatuses)[number];

export const productSyncSummarySchema = z.object({
  /** Productos que trajo la tienda (variantes incluidas). */
  total: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  /** Estaban en Driony por esta conexión y la tienda ya no los trae. */
  deactivated: z.number(),
  durationMs: z.number(),
  warnings: z.array(z.string()).default([]),
});
export type ProductSyncSummary = z.infer<typeof productSyncSummarySchema>;

export const productSourceDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(productSourceKinds),
  name: z.string(),
  /** Lo que se conectó, ya normalizado: la URL de la tienda, el dominio .myshopify.com o el enlace de la hoja. */
  target: z.string(),
  /** Pista de la credencial guardada ("ck_12ab…9f2a"), nunca la credencial. */
  credentialsHint: z.string().nullable(),
  /** Hojas: moneda de las filas que no la indican. Tiendas: la de la tienda. */
  defaultCurrency: z.string().nullable(),
  syncEvery: z.number(),
  isActive: z.boolean(),
  status: z.enum(productSourceStatuses),
  lastError: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  nextSyncAt: z.string().nullable(),
  lastSummary: productSyncSummarySchema.nullable(),
  productCount: z.number(),
  /** Webhook de entrada: la URL a la que la tienda avisa de cambios (null si el servidor no tiene URL pública). */
  webhookUrl: z.string().nullable(),
  /** El secreto que firma los avisos de WooCommerce (es el mismo token de la URL). */
  webhookSecret: z.string().nullable(),
  /** Cuándo se registraron los webhooks en la tienda; null = hay que crearlos a mano. */
  webhookRegisteredAt: z.string().nullable(),
  /** Por qué no se pudieron registrar solos, si pasó. */
  webhookError: z.string().nullable(),
  /** Último aviso recibido por el webhook. */
  lastWebhookAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ProductSourceDto = z.infer<typeof productSourceDtoSchema>;

const syncEveryField = z.number().int().min(0).max(7 * 24 * 60).default(60);
const nameField = z.string().trim().min(1, "Ponle un nombre").max(80, "El nombre no puede pasar de 80 caracteres");
const targetField = z.string().trim().min(1, "Falta la dirección").max(500);
const secretField = z.string().trim().max(500);
const currencyField = z
  .string()
  .trim()
  .length(3, "Usa el código ISO de 3 letras (USD, PEN, MXN…)")
  .transform((v) => v.toUpperCase());

export const connectWooCommerceSchema = z.object({
  kind: z.literal("woocommerce"),
  name: nameField.optional(),
  /** La dirección de la tienda (https://mitienda.com). */
  url: targetField,
  consumerKey: secretField.min(1, "Falta la clave de cliente (ck_…)"),
  consumerSecret: secretField.min(1, "Falta la clave secreta (cs_…)"),
  syncEvery: syncEveryField,
});

export const connectShopifySchema = z.object({
  kind: z.literal("shopify"),
  name: nameField.optional(),
  /** El dominio mitienda.myshopify.com (con o sin https://). */
  shop: targetField,
  /** Token de acceso de una app creada en el panel (shpat_…), si la tienes. */
  accessToken: secretField.optional(),
  /** O el ID y el secreto de cliente de una app del Dev Dashboard instalada en la tienda. */
  clientId: secretField.optional(),
  clientSecret: secretField.optional(),
  syncEvery: syncEveryField,
});

export const connectSheetSchema = z.object({
  kind: z.literal("sheet"),
  name: nameField.optional(),
  /** El enlace de la hoja de Google (compartida con cualquiera que tenga el enlace) o de cualquier CSV público. */
  url: targetField,
  defaultCurrency: currencyField.optional(),
  syncEvery: syncEveryField,
});

export const connectProductSourceSchema = z.discriminatedUnion("kind", [
  connectWooCommerceSchema,
  connectShopifySchema,
  connectSheetSchema,
]);
export type ConnectProductSourceInput = z.infer<typeof connectProductSourceSchema>;

/** Probar antes de conectar: la misma entrada, sin guardar nada. */
export const testProductSourceResultSchema = z.object({
  ok: z.literal(true),
  /** Nombre de la tienda, si lo dice; las hojas no lo dicen. */
  name: z.string().nullable(),
  currency: z.string().nullable(),
  /** Cuántos productos hay (o cuántas filas), si se pudo saber sin leerlo todo. */
  count: z.number().nullable(),
  /** Los primeros nombres, para que se reconozca la tienda. */
  sample: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type TestProductSourceResult = z.infer<typeof testProductSourceResultSchema>;

export const updateProductSourceSchema = z.object({
  name: nameField.optional(),
  syncEvery: syncEveryField.optional(),
  isActive: z.boolean().optional(),
  defaultCurrency: currencyField.nullable().optional(),
  // Nuevas credenciales: sustituyen a las guardadas y se vuelven a probar.
  url: targetField.optional(),
  shop: targetField.optional(),
  consumerKey: secretField.optional(),
  consumerSecret: secretField.optional(),
  accessToken: secretField.optional(),
  clientId: secretField.optional(),
  clientSecret: secretField.optional(),
});
export type UpdateProductSourceInput = z.infer<typeof updateProductSourceSchema>;

export const syncProductSourceResultSchema = z.object({
  queued: z.boolean(),
  reason: z.string().nullable(),
});
export type SyncProductSourceResult = z.infer<typeof syncProductSourceResultSchema>;

/** Al quitar la conexión: los productos se quedan (sin actualizarse) o se borran con ella. */
export const removeProductSourceModes = ["keep", "delete"] as const;
export type RemoveProductSourceMode = (typeof removeProductSourceModes)[number];

// ── Mercado Libre ────────────────────────────────────────────
// La autorización se pide en el sitio del país del vendedor; la API es una sola.
export const MERCADO_LIBRE_SITES = [
  { id: "MPE", country: "Perú", authHost: "auth.mercadolibre.com.pe", currency: "PEN" },
  { id: "MLA", country: "Argentina", authHost: "auth.mercadolibre.com.ar", currency: "ARS" },
  { id: "MLB", country: "Brasil", authHost: "auth.mercadolivre.com.br", currency: "BRL" },
  { id: "MLM", country: "México", authHost: "auth.mercadolibre.com.mx", currency: "MXN" },
  { id: "MLC", country: "Chile", authHost: "auth.mercadolibre.cl", currency: "CLP" },
  { id: "MCO", country: "Colombia", authHost: "auth.mercadolibre.com.co", currency: "COP" },
  { id: "MLU", country: "Uruguay", authHost: "auth.mercadolibre.com.uy", currency: "UYU" },
  { id: "MEC", country: "Ecuador", authHost: "auth.mercadolibre.com.ec", currency: "USD" },
  { id: "MBO", country: "Bolivia", authHost: "auth.mercadolibre.com.bo", currency: "BOB" },
  { id: "MPY", country: "Paraguay", authHost: "auth.mercadolibre.com.py", currency: "PYG" },
  { id: "MLV", country: "Venezuela", authHost: "auth.mercadolibre.com.ve", currency: "VES" },
  { id: "MPA", country: "Panamá", authHost: "auth.mercadolibre.com.pa", currency: "USD" },
  { id: "MRD", country: "República Dominicana", authHost: "auth.mercadolibre.com.do", currency: "DOP" },
  { id: "MCR", country: "Costa Rica", authHost: "auth.mercadolibre.co.cr", currency: "CRC" },
  { id: "MGT", country: "Guatemala", authHost: "auth.mercadolibre.com.gt", currency: "GTQ" },
  { id: "MHN", country: "Honduras", authHost: "auth.mercadolibre.com.hn", currency: "HNL" },
  { id: "MNI", country: "Nicaragua", authHost: "auth.mercadolibre.com.ni", currency: "NIO" },
  { id: "MSV", country: "El Salvador", authHost: "auth.mercadolibre.com.sv", currency: "USD" },
] as const;
export type MercadoLibreSiteId = (typeof MERCADO_LIBRE_SITES)[number]["id"];
export const mercadoLibreSiteIds = MERCADO_LIBRE_SITES.map((s) => s.id) as unknown as [MercadoLibreSiteId, ...MercadoLibreSiteId[]];

/** Empezar la autorización: el país de la cuenta y cada cuánto leer. Lo demás lo dice Mercado Libre al volver. */
export const startMercadoLibreConnectSchema = z.object({
  site: z.enum(mercadoLibreSiteIds),
  syncEvery: syncEveryField,
});
export type StartMercadoLibreConnectInput = z.infer<typeof startMercadoLibreConnectSchema>;

export const mercadoLibreConnectStartSchema = z.object({ url: z.string() });
export type MercadoLibreConnectStart = z.infer<typeof mercadoLibreConnectStartSchema>;

/** Si el servidor tiene la app de Mercado Libre y las URLs que hay que registrar en ella. */
export const mercadoLibreConfigSchema = z.object({
  configured: z.boolean(),
  callbackUrl: z.string().nullable(),
  notificationsUrl: z.string().nullable(),
});
export type MercadoLibreConfig = z.infer<typeof mercadoLibreConfigSchema>;
