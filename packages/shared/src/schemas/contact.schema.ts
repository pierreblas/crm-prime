import { z } from "zod";
import { isValidPhone, normalizePhone } from "../phone.js";

// Por qué vía entró el contacto al CRM (distinto de la fuente comercial).
export const contactOrigins = [
  "ad",
  "whatsapp",
  "webhook",
  "manual",
  "import",
  "call", // llamada telefónica entrante
] as const;
export type ContactOrigin = (typeof contactOrigins)[number];

export const contactOriginLabels: Record<ContactOrigin, string> = {
  ad: "Anuncio",
  whatsapp: "WhatsApp",
  webhook: "Webhook / API",
  manual: "Alta manual",
  import: "Importado",
  call: "Llamada",
};

// Teléfono normalizado a E.164 en la propia validación: da igual que llegue
// con espacios, con 00 o sin "+", siempre se guarda igual.
export const phoneField = z
  .string()
  .min(6)
  .max(24)
  .transform(normalizePhone)
  .refine(isValidPhone, "Teléfono inválido: usa formato internacional (+34600111222)");

// Contacto enriquecido para la sección de Contactos (directorio).
export const contactListItemSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  phone: z.string(),
  optIn: z.boolean(),
  lastMessageAt: z.string().nullable(),
  createdAt: z.string(),
  tags: z.array(z.object({ name: z.string(), color: z.string().nullable() })),
  source: z
    .object({ id: z.string(), name: z.string(), color: z.string().nullable() })
    .nullable(),
  // Procedencia técnica: qué API/pantalla creó el contacto.
  origin: z.enum(contactOrigins).catch("manual"),
  originDetail: z.string().nullable(),
  // Atribución de marketing, separada de los campos de negocio: los utm_*
  // capturados y el anuncio que abrió la conversación, si vino de uno.
  attribution: z.object({
    utms: z.record(z.string()),
    ad: z
      .object({
        sourceId: z.string().nullable(),
        headline: z.string().nullable(),
        body: z.string().nullable(),
        sourceUrl: z.string().nullable(),
        ctwaClid: z.string().nullable(),
      })
      .nullable(),
  }),
  // Valores de campos personalizados (key → valor).
  fields: z.record(z.string()).default({}),
  // País deducido del prefijo del teléfono, y la moneda con la que se le
  // cotiza: la fijada a mano (currencyOverride) o la de su país.
  country: z.object({ code: z.string(), name: z.string() }).nullable().default(null),
  currency: z.string().nullable().default(null),
  currencyOverride: z.string().nullable().default(null),
});
export type ContactListItem = z.infer<typeof contactListItemSchema>;

// Editar datos básicos de un contacto (+ campos personalizados).
export const updateContactSchema = z.object({
  name: z.string().max(160).nullable().optional(),
  optIn: z.boolean().optional(),
  fields: z.record(z.string()).optional(), // se fusionan en metadata
  // Moneda fija para este contacto; null vuelve a la de su país.
  currency: z
    .string()
    .length(3)
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
});
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

// Etiquetas de un contacto, como conjunto completo: lo que no venga se quita
// y lo que no exista se crea. Así la bandeja manda el estado final y no una
// lista de altas y bajas.
export const setContactTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(60)).max(30),
});
export type SetContactTagsInput = z.infer<typeof setContactTagsSchema>;
export const contactTagsDtoSchema = z.array(
  z.object({ id: z.string(), name: z.string(), color: z.string().nullable() }),
);
export type ContactTagsDto = z.infer<typeof contactTagsDtoSchema>;

// ── Campos personalizados (definiciones) ─────────────────────
export const customFieldTypes = ["text", "number", "date", "select"] as const;
export type CustomFieldType = (typeof customFieldTypes)[number];

export const customFieldDtoSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: z.enum(customFieldTypes),
  options: z.array(z.string()),
  order: z.number(),
});
export type CustomFieldDto = z.infer<typeof customFieldDtoSchema>;

export const createCustomFieldSchema = z.object({
  label: z.string().min(1).max(80),
  type: z.enum(customFieldTypes).default("text"),
  options: z.array(z.string()).default([]),
});
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;

export const updateCustomFieldSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  options: z.array(z.string()).optional(),
  order: z.number().int().optional(),
});
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;

// Crear un contacto manualmente.
export const createContactSchema = z.object({
  name: z.string().max(160).nullable().default(null),
  phone: phoneField,
  sourceId: z.string().nullable().default(null),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;
