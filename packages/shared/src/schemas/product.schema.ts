import { z } from "zod";

export const productDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  price: z.number(),
  currency: z.string(),
  // Precios en otras monedas (el de arriba es el precio base).
  prices: z.array(z.object({ currency: z.string(), amount: z.number() })).default([]),
  // Campos personalizados de producto (key → valor).
  attributes: z.record(z.string()).default({}),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type ProductDto = z.infer<typeof productDtoSchema>;

// Mensajes en español: el formulario los muestra tal cual al usuario.
const nameField = z
  .string()
  .min(1, "Escribe un nombre")
  .max(160, "El nombre no puede pasar de 160 caracteres");
const skuField = z
  .string()
  .max(60, "El SKU no puede pasar de 60 caracteres")
  .nullable();
const descriptionField = z
  .string()
  .max(2000, "La descripción no puede pasar de 2000 caracteres")
  .nullable();
const priceField = z.number().min(0, "El precio no puede ser negativo");
const currencyField = z
  .string()
  .length(3, "Usa el código ISO de 3 letras (USD, EUR, PEN, MXN…)")
  .transform((v) => v.toUpperCase());
// Precios adicionales: una entrada por moneda, distinta de la base.
const pricesField = z
  .array(z.object({ currency: currencyField, amount: priceField }))
  .max(20)
  .refine(
    (list) => new Set(list.map((p) => p.currency)).size === list.length,
    "Hay una moneda repetida en los precios",
  );
// Valores de campos personalizados: key → texto. Vacío = sin valor.
const attributesField = z.record(z.string().max(2000)).refine((o) => Object.keys(o).length <= 50, "Demasiados campos");
const imageUrlField = z
  .string()
  .url("La URL de la imagen debe empezar por http:// o https://")
  .nullable();

export const createProductSchema = z.object({
  name: nameField,
  sku: skuField.default(null),
  description: descriptionField.default(null),
  price: priceField.default(0),
  currency: currencyField.default("USD"),
  prices: pricesField.default([]),
  attributes: attributesField.default({}),
  imageUrl: imageUrlField.default(null),
  isActive: z.boolean().default(true),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: nameField.optional(),
  sku: skuField.optional(),
  description: descriptionField.optional(),
  price: priceField.optional(),
  currency: currencyField.optional(),
  // Si viene, sustituye la lista entera de precios adicionales.
  prices: pricesField.optional(),
  // Si viene, sustituye todos los valores de campos personalizados.
  attributes: attributesField.optional(),
  imageUrl: imageUrlField.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ── Importación desde CSV ────────────────────────────────────

/** Campos que acepta el importador y cómo pueden venir titulados. */
export const PRODUCT_IMPORT_FIELDS = [
  { key: "name", label: "Nombre", required: true, aliases: ["nombre", "producto", "name", "title", "titulo", "título"] },
  { key: "sku", label: "SKU", required: false, aliases: ["sku", "codigo", "código", "code", "referencia", "ref"] },
  { key: "price", label: "Precio", required: true, aliases: ["precio", "price", "valor", "importe", "monto"] },
  { key: "currency", label: "Moneda", required: false, aliases: ["moneda", "currency", "divisa"] },
  { key: "description", label: "Descripción", required: false, aliases: ["descripcion", "descripción", "description", "detalle", "detalles"] },
  { key: "imageUrl", label: "Imagen (URL)", required: false, aliases: ["imagen", "image", "imageurl", "image_url", "foto", "url imagen", "url de imagen"] },
  { key: "isActive", label: "Activo", required: false, aliases: ["activo", "active", "isactive", "estado", "habilitado", "disponible"] },
] as const;

export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number]["key"];

const normalizeHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Empareja las columnas del archivo con los campos del producto. Devuelve, por
 * campo, el nombre de la columna encontrada (o null si no hay ninguna).
 */
export function guessColumnMapping(
  headers: string[],
): Record<ProductImportField, string | null> {
  const mapping = {} as Record<ProductImportField, string | null>;
  const used = new Set<string>();
  for (const field of PRODUCT_IMPORT_FIELDS) {
    const match = headers.find(
      (h) =>
        !used.has(h) &&
        (field.aliases as readonly string[]).includes(normalizeHeader(h)),
    );
    mapping[field.key] = match ?? null;
    if (match) used.add(match);
  }
  return mapping;
}

/**
 * Interpreta un precio escrito por personas: "1.234,56", "1,234.56", "S/ 20",
 * "20.5". Se queda con el último separador como decimal.
 */
export function parseImportPrice(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > -1 && lastDot > -1) {
    // El separador decimal es el que aparece más a la derecha.
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Una sola coma: decimal si deja 1-2 dígitos detrás; si no, es de miles.
    normalized =
      cleaned.length - lastComma - 1 <= 2
        ? cleaned.replace(",", ".")
        : cleaned.replace(/,/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const TRUTHY = ["si", "sí", "true", "1", "activo", "yes", "y", "x", "verdadero"];
const FALSY = ["no", "false", "0", "inactivo", "n", "falso"];

export function parseImportBoolean(raw: string, fallback = true): boolean {
  const v = normalizeHeader(raw);
  if (!v) return fallback;
  if (TRUTHY.includes(v)) return true;
  if (FALSY.includes(v)) return false;
  return fallback;
}

/**
 * Columnas de precio por moneda: "precio_MXN", "price EUR", "precio (PEN)"…
 * Devuelve la moneda que indican, o null si la columna no es de ese tipo.
 */
export function priceColumnCurrency(header: string): string | null {
  const m = normalizeHeader(header).match(/^(?:precio|price|valor)[\s_(-]+([a-z]{3})\)?$/);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Columnas del archivo que parecen precios en otra moneda (precio_MXN…),
 * sin contar las ya usadas para otra cosa. El usuario puede corregirlas.
 */
export function guessPriceColumns(headers: string[], taken: (string | null)[]): Record<string, string> {
  const used = new Set(taken.filter(Boolean) as string[]);
  const out: Record<string, string> = {};
  for (const h of headers) {
    if (used.has(h)) continue;
    const cur = priceColumnCurrency(h);
    if (cur) out[h] = cur;
  }
  return out;
}

/** Opciones de la conversión de una fila del archivo. */
export interface ProductImportOptions {
  /** Moneda de las filas que no la indican (o si no hay columna de moneda). Por defecto USD. */
  defaultCurrency?: string;
  /** Columna → moneda de los precios adicionales. Si no se da, se detectan por el título (precio_MXN…). */
  priceColumns?: Record<string, string>;
}

export const productImportRowSchema = z.object({
  name: nameField,
  sku: skuField.default(null),
  description: descriptionField.default(null),
  price: priceField,
  currency: currencyField.default("USD"),
  prices: pricesField.default([]),
  attributes: attributesField.default({}),
  imageUrl: imageUrlField.default(null),
  isActive: z.boolean().default(true),
});
export type ProductImportRow = z.infer<typeof productImportRowSchema>;

/**
 * Convierte una fila del archivo en un producto listo para guardar, o explica
 * en español qué le falta. Lo usan la vista previa y la API, así que lo que se
 * ve antes de importar es lo que se guarda.
 */
// ── Campos personalizados del catálogo ───────────────────────
// Libres: sirven igual para productos (talla, color), servicios (duración,
// modalidad) o talleres (fecha, cupos, lugar). Los valores se guardan como
// texto en Product.attributes; el tipo decide cómo se editan y se validan.
export const productFieldTypes = [
  "text",
  "longtext",
  "number",
  "date",
  "time",
  "boolean",
  "select",
  "multiselect",
  "url",
] as const;
export type ProductFieldType = (typeof productFieldTypes)[number];

/** Tipos cuyo valor es una opción de una lista. */
export const isListFieldType = (t: string) => t === "select" || t === "multiselect";

export const productFieldDtoSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: z.enum(productFieldTypes),
  options: z.array(z.string()),
  /** Unidad que acompaña a un número: "horas", "cupos", "kg". */
  unit: z.string().nullable(),
  /** Ayuda para quien rellena el campo; el agente de IA también la lee. */
  help: z.string().nullable(),
  required: z.boolean(),
  showOnCard: z.boolean(),
  aiVisible: z.boolean(),
  order: z.number(),
});
export type ProductFieldDto = z.infer<typeof productFieldDtoSchema>;

const fieldOptions = z
  .array(z.string().trim().min(1).max(80))
  .max(100, "Máximo 100 opciones")
  .transform((l) => [...new Set(l)]);
const fieldText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const createProductFieldSchema = z.object({
  label: z.string().trim().min(1, "Ponle un nombre").max(80),
  type: z.enum(productFieldTypes).default("text"),
  options: fieldOptions.default([]),
  unit: fieldText(20),
  help: fieldText(200),
  required: z.boolean().default(false),
  showOnCard: z.boolean().default(true),
  aiVisible: z.boolean().default(true),
});
export type CreateProductFieldInput = z.input<typeof createProductFieldSchema>;

export const updateProductFieldSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  type: z.enum(productFieldTypes).optional(),
  options: fieldOptions.optional(),
  unit: fieldText(20).optional(),
  help: fieldText(200).optional(),
  required: z.boolean().optional(),
  showOnCard: z.boolean().optional(),
  aiVisible: z.boolean().optional(),
});
export type UpdateProductFieldInput = z.input<typeof updateProductFieldSchema>;

export const reorderProductFieldsSchema = z.object({ ids: z.array(z.string()).min(1).max(200) });

type FieldShape = { label: string; type: string; options: string[]; unit?: string | null; required?: boolean };

/** Separador de valores en los campos de varias opciones. */
export const MULTI_SEPARATOR = ", ";
export const splitMulti = (v: string) =>
  v
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Cómo se muestra un valor guardado: con su unidad, fechas legibles… */
export function formatFieldValue(field: { type: string; unit?: string | null }, value: string): string {
  if (!value) return "";
  if (field.type === "number" && field.unit) return `${value} ${field.unit}`;
  if (field.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return value;
}

/** Un campo personalizado con la columna del archivo que lo trae. */
export interface ProductFieldColumn {
  key: string;
  label: string;
  type: string;
  options: string[];
  unit?: string | null;
  required?: boolean;
  column: string | null;
}

/**
 * Empareja los campos personalizados de producto con columnas del archivo por
 * su nombre ("Talla", "color"…), sin usar las que ya son campos fijos.
 */
export function guessProductFieldColumns(
  headers: string[],
  fields: (FieldShape & { key: string })[],
  taken: (string | null)[],
): ProductFieldColumn[] {
  const used = new Set(taken.filter(Boolean) as string[]);
  return fields.map((f) => {
    const wanted = [normalizeHeader(f.label), normalizeHeader(f.key), normalizeHeader(f.key.replace(/_/g, " "))];
    const column = headers.find((h) => !used.has(h) && wanted.includes(normalizeHeader(h))) ?? null;
    if (column) used.add(column);
    return { ...f, column };
  });
}

/** Valor de un campo personalizado leído de un CSV, validado según su tipo. */
export function parseFieldValue(
  raw: string,
  field: FieldShape,
): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim();
  const bad = (why: string) => ({ ok: false as const, error: `${field.label}: "${v}" ${why}` });
  if (!v) return field.required ? { ok: false, error: `Falta «${field.label}»` } : { ok: true, value: "" };
  switch (field.type) {
    case "number": {
      // "3 horas" o "20 cupos": se queda el número.
      const n = parseImportPrice(v.replace(/[^\d.,-]+$/g, "").trim());
      return n === null ? bad("no es un número") : { ok: true, value: String(n) };
    }
    case "boolean": {
      const t = normalizeHeader(v);
      if (TRUTHY.includes(t)) return { ok: true, value: "Sí" };
      if (FALSY.includes(t)) return { ok: true, value: "No" };
      return bad("no es sí o no");
    }
    case "date": {
      const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
      if (!y || !m || !d || Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) {
        return bad("no es una fecha (usa 31/12/2026)");
      }
      return { ok: true, value: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` };
    }
    case "time": {
      const t = v.match(/^(\d{1,2})[:.h](\d{2})/i);
      if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return bad("no es una hora (usa 18:30)");
      return { ok: true, value: `${t[1]!.padStart(2, "0")}:${t[2]}` };
    }
    case "url":
      return /\s/.test(v) ? bad("no es un enlace") : { ok: true, value: /^https?:\/\//i.test(v) ? v : `https://${v}` };
    case "select":
    case "multiselect": {
      const parts = field.type === "select" ? [v] : splitMulti(v);
      const hits: string[] = [];
      for (const part of parts) {
        const hit = field.options.find((o) => normalizeHeader(o) === normalizeHeader(part));
        if (!hit && field.options.length) {
          return { ok: false, error: `${field.label}: "${part}" no es una de las opciones (${field.options.join(", ")})` };
        }
        hits.push(hit ?? part);
      }
      return { ok: true, value: [...new Set(hits)].join(MULTI_SEPARATOR) };
    }
    case "longtext":
      return { ok: true, value: v.slice(0, 2000) };
    default:
      return { ok: true, value: v.slice(0, 500) };
  }
}

export function toProductImportRow(
  record: Record<string, string>,
  mapping: Record<ProductImportField, string | null>,
  fieldColumns: ProductFieldColumn[] = [],
  opts: ProductImportOptions = {},
): { ok: true; value: ProductImportRow } | { ok: false; error: string } {
  const get = (field: ProductImportField): string => {
    const column = mapping[field];
    return column ? (record[column] ?? "").trim() : "";
  };

  const name = get("name");
  if (!name) return { ok: false, error: "Falta el nombre" };

  const rawPrice = get("price");
  const price = rawPrice ? parseImportPrice(rawPrice) : 0;
  if (price === null) return { ok: false, error: `Precio no válido: "${rawPrice}"` };
  if (price < 0) return { ok: false, error: "El precio no puede ser negativo" };

  const rawCurrency = get("currency");
  const currency = (rawCurrency || opts.defaultCurrency || "USD").trim().toUpperCase();
  if (currency.length !== 3) {
    return { ok: false, error: `Moneda no válida: "${rawCurrency}" (usa USD, PEN, EUR…)` };
  }

  // Precios en otras monedas: las columnas elegidas, o las que se llaman precio_XXX (vacías se ignoran).
  const prices: { currency: string; amount: number }[] = [];
  const priceColumns = opts.priceColumns ?? guessPriceColumns(Object.keys(record), Object.values(mapping));
  for (const [column, cur] of Object.entries(priceColumns)) {
    const value = record[column];
    if (!cur || cur === currency || !value?.trim()) continue;
    const amount = parseImportPrice(value);
    if (amount === null || amount < 0) {
      return { ok: false, error: `Precio en ${cur} no válido: "${value}"` };
    }
    if (!prices.some((p) => p.currency === cur)) prices.push({ currency: cur, amount });
  }

  // Campos personalizados de producto.
  const attributes: Record<string, string> = {};
  for (const f of fieldColumns) {
    // Sin columna no se exige: al actualizar se conserva el valor que ya tenía.
    if (!f.column) continue;
    const parsedField = parseFieldValue(record[f.column] ?? "", f);
    if (!parsedField.ok) return { ok: false, error: parsedField.error };
    if (parsedField.value) attributes[f.key] = parsedField.value;
  }

  const rawImage = get("imageUrl");
  const imageUrl = rawImage
    ? /^https?:\/\//i.test(rawImage)
      ? rawImage
      : `https://${rawImage}`
    : null;

  const parsed = productImportRowSchema.safeParse({
    name,
    sku: get("sku") || null,
    description: get("description") || null,
    price,
    currency,
    prices,
    attributes,
    imageUrl,
    isActive: parseImportBoolean(get("isActive")),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Fila no válida" };
  }
  return { ok: true, value: parsed.data };
}

export const importProductsSchema = z.object({
  rows: z.array(productImportRowSchema).min(1).max(2000),
  /** Si el SKU ya existe: actualizar el producto en vez de saltarlo. */
  updateExisting: z.boolean().default(true),
});
export type ImportProductsInput = z.infer<typeof importProductsSchema>;

export const importProductsResultSchema = z.object({
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ row: z.number(), message: z.string() })),
});
export type ImportProductsResult = z.infer<typeof importProductsResultSchema>;
