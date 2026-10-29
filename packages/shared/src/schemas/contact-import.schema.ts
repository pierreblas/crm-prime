import { z } from "zod";
import { customFieldTypes, phoneField } from "./contact.schema.js";
import { normalizePhone, isValidPhone } from "../phone.js";

// ── Claves de los campos personalizados ──────────────────────
/**
 * La clave es el identificador estable de un campo: la que se usa en la API,
 * en los webhooks y al importar. Se genera del nombre al crearlo y NO cambia
 * aunque luego se renombre el campo, así que las integraciones no se rompen.
 * Formato: minúsculas, números y guion bajo, empezando por letra.
 */
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const fieldKeySchema = z
  .string()
  .regex(FIELD_KEY_RE, "La clave solo puede llevar minúsculas, números y _ (y empezar por letra)");

export function fieldKeyFromLabel(label: string): string {
  const base = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  if (!base) return "campo";
  return /^[a-z]/.test(base) ? base : `c_${base}`.slice(0, 40);
}

/**
 * Traduce lo que llega de fuera (API, webhook, formularios de Meta, archivos)
 * a las claves de los campos definidos. Acepta la clave exacta o el nombre
 * visible escrito de cualquier forma («Ciudad», «ciudad», «CIUDAD»). Lo que no
 * coincide con ningún campo se guarda con una clave limpia y se puede
 * convertir en campo después desde Ajustes.
 */
export function resolveFieldKeys(
  input: Record<string, string>,
  defs: ReadonlyArray<{ key: string; label: string }>,
): Record<string, string> {
  const byKey = new Map(defs.map((d) => [d.key, d.key]));
  for (const d of defs) {
    const fromLabel = fieldKeyFromLabel(d.label);
    if (!byKey.has(fromLabel)) byKey.set(fromLabel, d.key);
  }
  const out: Record<string, string> = {};
  for (const [raw, value] of Object.entries(input)) {
    if (byKey.has(raw)) {
      out[byKey.get(raw)!] = value;
      continue;
    }
    const slug = fieldKeyFromLabel(raw);
    out[byKey.get(slug) ?? slug] = value;
  }
  return out;
}

/** Una clave que llega en los contactos pero no tiene campo definido. */
export const unmappedFieldSchema = z.object({
  key: z.string(),
  contacts: z.number(),
  sample: z.string().nullable(),
});
export type UnmappedField = z.infer<typeof unmappedFieldSchema>;

// ── Importar contactos ───────────────────────────────────────
export const contactImportRowSchema = z.object({
  /** Línea del archivo (para los errores). */
  line: z.number().int().min(1),
  phone: phoneField,
  name: z.string().trim().max(160).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  source: z.string().trim().max(80).nullable().default(null),
  /** Clave del campo → valor. */
  fields: z.record(z.string().max(2000)).default({}),
});
export type ContactImportRow = z.infer<typeof contactImportRowSchema>;

export const importContactsSchema = z.object({
  rows: z.array(contactImportRowSchema).min(1).max(5000),
  /** Campos que se crean con esta importación (una columna del archivo cada uno). */
  newFields: z
    .array(z.object({ key: fieldKeySchema, label: z.string().trim().min(1).max(80), type: z.enum(customFieldTypes).default("text") }))
    .max(30)
    .default([]),
  /** Si el teléfono ya existe: completar ese contacto en vez de saltarlo. */
  updateExisting: z.boolean().default(true),
  /** Consentimiento para mensajes de WhatsApp de los contactos NUEVOS. */
  optIn: z.boolean().default(true),
  fileName: z.string().max(200).nullable().default(null),
});
export type ImportContactsInput = z.infer<typeof importContactsSchema>;

export const importContactsResultSchema = z.object({
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  fieldsCreated: z.number(),
  errors: z.array(z.object({ row: z.number(), message: z.string() })),
});
export type ImportContactsResult = z.infer<typeof importContactsResultSchema>;

/** Columnas fijas que se reconocen por su título. */
export const CONTACT_IMPORT_COLUMNS = [
  { key: "phone", label: "Teléfono", required: true, aliases: ["telefono", "phone", "celular", "movil", "whatsapp", "numero", "tel", "mobile", "cel", "phone number", "numero de telefono"] },
  { key: "name", label: "Nombre", required: false, aliases: ["nombre", "name", "nombre completo", "cliente", "full name", "contacto", "nombres"] },
  { key: "tags", label: "Etiquetas", required: false, aliases: ["etiquetas", "etiqueta", "tags", "tag", "labels"] },
  { key: "source", label: "Fuente", required: false, aliases: ["fuente", "source", "origen", "canal"] },
] as const;
export type ContactImportColumn = (typeof CONTACT_IMPORT_COLUMNS)[number]["key"];

const normHeader = (h: string) =>
  h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

export function guessContactColumns(headers: string[]): Record<ContactImportColumn, string | null> {
  const out = {} as Record<ContactImportColumn, string | null>;
  const used = new Set<string>();
  for (const col of CONTACT_IMPORT_COLUMNS) {
    const hit = headers.find((h) => !used.has(h) && (col.aliases as readonly string[]).includes(normHeader(h)));
    out[col.key] = hit ?? null;
    if (hit) used.add(hit);
  }
  return out;
}

/**
 * Teléfono de un archivo. Si no trae prefijo internacional («+» o «00») se le
 * pone el del país elegido, salvo que ya empiece por él y sea largo.
 */
export function importPhone(raw: string, defaultDial: string | null): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^\s*(\+|00)/.test(t) || !defaultDial) return normalizePhone(t);
  const digits = t.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.startsWith(defaultDial) && digits.length >= defaultDial.length + 8) return `+${digits}`;
  return `+${defaultDial}${digits}`;
}

/** Una fila del archivo convertida a contacto, o el motivo por el que no vale. */
export function toContactImportRow(
  record: Record<string, string>,
  line: number,
  columns: Record<ContactImportColumn, string | null>,
  fieldColumns: ReadonlyArray<{ column: string; key: string }>,
  opts: { defaultDial: string | null },
): { ok: true; value: ContactImportRow } | { ok: false; error: string } {
  const cell = (c: string | null) => (c ? (record[c] ?? "").trim() : "");
  const rawPhone = cell(columns.phone);
  if (!rawPhone) return { ok: false, error: "Sin teléfono" };
  const phone = importPhone(rawPhone, opts.defaultDial);
  if (!isValidPhone(phone)) return { ok: false, error: `Teléfono no válido: «${rawPhone}»` };
  const fields: Record<string, string> = {};
  for (const fc of fieldColumns) {
    const v = cell(fc.column);
    if (v) fields[fc.key] = v.slice(0, 2000);
  }
  return {
    ok: true,
    value: {
      line,
      phone,
      name: cell(columns.name).slice(0, 160) || null,
      tags: [...new Set(cell(columns.tags).split(/[,;|]/).map((t) => t.trim().slice(0, 60)).filter(Boolean))].slice(0, 20),
      source: cell(columns.source).slice(0, 80) || null,
      fields,
    },
  };
}
