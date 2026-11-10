import { z } from "zod";
import { pageQuerySchema } from "./public-api.schema.js";

// ── API pública: catálogo ────────────────────────────────────
// Para que un ERP, un n8n o un sistema propio empuje los productos a Driony.
// El SKU es la llave que entiende el sistema de fuera: con él se actualiza en
// vez de duplicar. Los campos propios van por su clave o por su nombre visible.

const priceField = z.number().min(0, "El precio no puede ser negativo");
const currencyField = z
  .string()
  .trim()
  .length(3, "Usa el código ISO de 3 letras (USD, PEN, MXN…)")
  .transform((v) => v.toUpperCase());

export const publicProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  price: z.number(),
  currency: z.string(),
  /** Precios en otras monedas; `price`/`currency` es el base. */
  prices: z.array(z.object({ currency: z.string(), amount: z.number() })),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  /** Campos propios del catálogo, por su clave (Productos › Campos). */
  fields: z.record(z.string()),
  /** De qué conexión viene (nombre de la tienda o de la clave de API), o null si es manual. */
  source: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicProduct = z.infer<typeof publicProductSchema>;

export const listProductsQuerySchema = pageQuerySchema.extend({
  search: z.string().max(120).optional(),
  /** Solo un SKU exacto. */
  sku: z.string().max(60).optional(),
  /** "true" | "false": solo activos o solo inactivos. */
  active: z.enum(["true", "false"]).optional(),
  /** ISO 8601: solo productos modificados a partir de esta fecha. */
  updatedSince: z.string().datetime().optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

const productBody = {
  name: z.string().trim().min(1, "Falta el nombre").max(160),
  sku: z.string().trim().max(60).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  price: priceField.optional(),
  currency: currencyField.optional(),
  /** Reemplaza el juego de precios adicionales. Omitir para no tocarlos. */
  prices: z
    .array(z.object({ currency: currencyField, amount: priceField }))
    .max(20)
    .optional(),
  imageUrl: z.string().url("La imagen debe ser una URL http(s)").nullable().optional(),
  isActive: z.boolean().optional(),
  /** Se fusionan con los existentes; un valor vacío borra ese campo. */
  fields: z.record(z.string().max(2000)).optional(),
};

export const createPublicProductSchema = z.object(productBody);
export type CreatePublicProductInput = z.infer<typeof createPublicProductSchema>;

export const updatePublicProductSchema = z.object({ ...productBody, name: productBody.name.optional() });
export type UpdatePublicProductInput = z.infer<typeof updatePublicProductSchema>;

/**
 * Carga en bloque: crea o actualiza por SKU (obligatorio aquí). Con
 * `deactivateMissing`, los productos que esta misma clave de API cargó antes y
 * no vienen en el envío quedan inactivos: así un ERP manda el catálogo
 * completo y Driony queda igual que él.
 */
export const bulkPublicProductsSchema = z.object({
  products: z
    .array(z.object({ ...productBody, sku: z.string().trim().min(1, "Falta el SKU").max(60) }))
    .min(1, "Envía al menos un producto")
    .max(500, "Máximo 500 productos por envío"),
  deactivateMissing: z.boolean().default(false),
});
export type BulkPublicProductsInput = z.infer<typeof bulkPublicProductsSchema>;

export const bulkPublicProductsResultSchema = z.object({
  created: z.number(),
  updated: z.number(),
  deactivated: z.number(),
  errors: z.array(z.object({ sku: z.string(), message: z.string() })),
});
export type BulkPublicProductsResult = z.infer<typeof bulkPublicProductsResultSchema>;
