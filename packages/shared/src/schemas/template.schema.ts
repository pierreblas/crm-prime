import { z } from "zod";

// Plantillas de WhatsApp (message templates de Meta).
// Estructura y límites según la documentación de componentes de Meta:
// HEADER (texto, imagen, video, documento o ubicación) + BODY + FOOTER + BUTTONS.

export const templateStatuses = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "PENDING_DELETION",
] as const;
export type TemplateStatusValue = (typeof templateStatuses)[number];

export const templateCategories = [
  "MARKETING",
  "UTILITY",
  "AUTHENTICATION",
] as const;
export type TemplateCategory = (typeof templateCategories)[number];

export const headerFormats = [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "DOCUMENT",
  "LOCATION",
] as const;
export type HeaderFormat = (typeof headerFormats)[number];

/** Formatos de encabezado que llevan un archivo. */
export const mediaHeaderFormats = ["IMAGE", "VIDEO", "DOCUMENT"] as const;
export type MediaHeaderFormat = (typeof mediaHeaderFormats)[number];

// Variable de la plantilla: posicional ({{1}}, {{2}}…) o, en las creadas en
// Meta con variables con nombre, `name` ({{nombre}}); `index` es su orden.
export const templateVariableSchema = z.object({
  index: z.number().int().min(1),
  label: z.string(),
  name: z.string().optional(),
});
export type TemplateVariable = z.infer<typeof templateVariableSchema>;

// ── Encabezado ───────────────────────────────────────────────
export const templateHeaderSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("TEXT"),
    // Máximo 60 caracteres y como mucho UNA variable.
    text: z.string().min(1).max(60),
    example: z.string().max(60).optional(),
  }),
  z.object({
    format: z.literal("IMAGE"),
    // Ejemplo que Meta exige al crear la plantilla (referencia de storage).
    example: z.string().optional(),
  }),
  z.object({ format: z.literal("VIDEO"), example: z.string().optional() }),
  z.object({ format: z.literal("DOCUMENT"), example: z.string().optional() }),
  z.object({ format: z.literal("LOCATION") }),
]);
export type TemplateHeader = z.infer<typeof templateHeaderSchema>;

// ── Botones ──────────────────────────────────────────────────
export const templateButtonSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("QUICK_REPLY"),
    text: z.string().min(1).max(25),
  }),
  z.object({
    type: z.literal("URL"),
    text: z.string().min(1).max(25),
    // Puede terminar en {{1}}: sufijo dinámico que se completa al enviar.
    url: z.string().url().max(2000),
    example: z.string().max(2000).optional(),
  }),
  z.object({
    type: z.literal("PHONE_NUMBER"),
    text: z.string().min(1).max(25),
    phoneNumber: z.string().min(5).max(20),
  }),
  z.object({
    type: z.literal("COPY_CODE"),
    example: z.string().min(1).max(20),
  }),
]);
export type TemplateButton = z.infer<typeof templateButtonSchema>;

/** Límites de Meta: 10 botones, 2 de URL, 1 de teléfono y 1 de copiar código. */
export function validateButtons(buttons: TemplateButton[]): string | null {
  if (buttons.length > 10) return "Máximo 10 botones";
  const count = (type: TemplateButton["type"]) =>
    buttons.filter((b) => b.type === type).length;
  if (count("URL") > 2) return "Máximo 2 botones de URL";
  if (count("PHONE_NUMBER") > 1) return "Máximo 1 botón de teléfono";
  if (count("COPY_CODE") > 1) return "Máximo 1 botón de copiar código";
  return null;
}

// ── Plantilla ────────────────────────────────────────────────
export const templateDtoSchema = z.object({
  id: z.string(),
  waTemplateId: z.string().nullable(),
  name: z.string(),
  language: z.string(),
  category: z.enum(templateCategories),
  status: z.enum(templateStatuses),
  header: templateHeaderSchema.nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  buttons: z.array(templateButtonSchema),
  variables: z.array(templateVariableSchema),
  /** Motivo del rechazo que informa Meta. */
  rejectedReason: z.string().nullable(),
  /** true si vino de Meta y el CRM no puede editarla. */
  readOnly: z.boolean(),
  syncedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TemplateDto = z.infer<typeof templateDtoSchema>;

const templateBaseSchema = z.object({
  // Nombre estilo Meta: minúsculas, números y guiones bajos.
  name: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "Solo minúsculas, números y guiones bajos"),
  language: z.string().min(2).default("es"),
  category: z.enum(templateCategories).default("MARKETING"),
  header: templateHeaderSchema.nullable().default(null),
  body: z.string().min(1).max(1024),
  footer: z.string().max(60).nullable().default(null),
  buttons: z.array(templateButtonSchema).default([]),
  variables: z.array(templateVariableSchema).default([]),
});

export const createTemplateSchema = templateBaseSchema
  .extend({
    /** Si es true, se crea también en Meta y queda a la espera de aprobación. */
    submitToMeta: z.boolean().default(true),
  })
  .refine((v) => validateButtons(v.buttons) === null, {
    message: "Combinación de botones no permitida por Meta",
    path: ["buttons"],
  });
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

// Meta no deja cambiar el nombre ni el idioma de una plantilla existente.
export const updateTemplateSchema = templateBaseSchema
  .omit({ name: true, language: true })
  .partial()
  .refine((v) => !v.buttons || validateButtons(v.buttons) === null, {
    message: "Combinación de botones no permitida por Meta",
    path: ["buttons"],
  });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

// ── Sincronización con Meta ──────────────────────────────────
export const syncTemplatesResultSchema = z.object({
  imported: z.number(),
  updated: z.number(),
  total: z.number(),
});
export type SyncTemplatesResult = z.infer<typeof syncTemplatesResultSchema>;

// ── Valores al enviar ────────────────────────────────────────
// Cómo se llena cada hueco de la plantilla en un envío concreto.
export const variableSources = [
  "static",
  "contact_name",
  "contact_phone",
] as const;
export type VariableSource = (typeof variableSources)[number];

export const variableValueSchema = z.object({
  index: z.number().int().min(1),
  source: z.enum(variableSources),
  value: z.string().optional(), // si source = static
});
export type VariableValue = z.infer<typeof variableValueSchema>;

/** Relleno de la plantilla: encabezado, cuerpo y botones dinámicos. */
export const templateFillSchema = z.object({
  /** Variables del cuerpo ({{1}}, {{2}}…). */
  body: z.array(variableValueSchema).default([]),
  /** Variable del encabezado de texto (una sola). */
  headerText: variableValueSchema.optional(),
  /** Archivo del encabezado: referencia interna "storage://…" o URL pública. */
  headerMediaUrl: z.string().optional(),
  /** Ubicación del encabezado LOCATION. */
  headerLocation: z
    .object({
      latitude: z.string(),
      longitude: z.string(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  /** Sufijo dinámico del botón de URL, por índice de botón. */
  urlButtons: z
    .array(z.object({ index: z.number().int().min(0), value: z.string() }))
    .default([]),
});
export type TemplateFill = z.infer<typeof templateFillSchema>;
