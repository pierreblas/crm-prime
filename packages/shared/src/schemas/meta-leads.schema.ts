import { z } from "zod";
import { phoneField } from "./contact.schema.js";

// Formularios de Meta (Lead Ads): páginas conectadas y leads recibidos.
// El token de cada página NUNCA sale de la API: el navegador solo ve ids y
// nombres.

/**
 * Permisos que se piden al conectar con Facebook: ver las páginas, administrar
 * sus webhooks, descargar los leads y (pages_manage_ads) leer los formularios y
 * sus preguntas antes de que llegue ningún lead.
 */
export const META_LEADS_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_manage_ads",
  "leads_retrieval",
  "ads_management",
].join(",");

/** Fuente automática de los leads de formularios cuando la página no elige otra. */
export const META_FORM_SOURCE_NAME = "Formulario de Facebook";

/**
 * A dónde va la respuesta de una pregunta del formulario:
 *  - "std:name" | "std:phone" | "std:email": nombre, teléfono o correo del contacto
 *    (varias preguntas al nombre se juntan: «Nombres» + «Apellidos»);
 *  - "field:<clave>": ese campo personalizado;
 *  - "skip": no se guarda.
 */
export const metaFieldTargetSchema = z
  .string()
  .regex(/^(std:(name|phone|email)|skip|field:[a-z][a-z0-9_]{0,39})$/, "Destino de campo no válido");

/**
 * Regla de un formulario de la página:
 *  - enabled: si sus leads entran (apagado, se ignoran);
 *  - stage: "page" = la etapa de la página; "none" = sin oportunidad; o el id
 *    de una etapa concreta (de cualquier embudo);
 *  - source: "page" = la fuente de la página; "auto" = «Formulario de
 *    Facebook»; o el id de una fuente;
 *  - tagIds: etiquetas que se suman a las de la página;
 *  - fieldMap: a dónde va cada pregunta, por su clave en Meta. Las que no
 *    están se reparten solas por su nombre (mapMetaLeadFields).
 */
export const metaFormRuleSchema = z.object({
  formId: z.string().min(1).max(64),
  formName: z.string().max(200).default(""),
  enabled: z.boolean().default(true),
  stage: z.string().min(1).max(64).default("page"),
  source: z.string().min(1).max(64).default("page"),
  tagIds: z.array(z.string().max(64)).max(50).default([]),
  fieldMap: z.record(z.string().max(200), metaFieldTargetSchema).default({}),
});
export type MetaFormRule = z.infer<typeof metaFormRuleSchema>;

/** La regla de un formulario sin tocar: entra, y todo como la página. */
export function defaultMetaFormRule(formId: string, formName: string): MetaFormRule {
  return metaFormRuleSchema.parse({ formId, formName });
}

/** Lee las reglas guardadas (JSON libre) sin fiarse del formato: lo irreconocible se salta. */
export function parseMetaFormRules(raw: unknown): MetaFormRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = metaFormRuleSchema.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

export const metaPageDtoSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  /** Cuándo se suscribió a los avisos de leads. Null = sin suscribir. */
  subscribedAt: z.string().nullable(),
  /** Fuente de sus leads. Null = la automática «Formulario de Facebook». */
  sourceId: z.string().nullable(),
  tagIds: z.array(z.string()),
  createDeal: z.boolean(),
  /** Etapa donde entra la oportunidad de sus leads. Null = primera del embudo predeterminado. */
  dealStageId: z.string().nullable(),
  /** Qué hacer con cada formulario (los que no están aquí siguen a la página). */
  formRules: z.array(metaFormRuleSchema),
  welcomeTemplateId: z.string().nullable(),
  leadCount: z.number(),
  pendingCount: z.number(),
  createdAt: z.string(),
});
export type MetaPageDto = z.infer<typeof metaPageDtoSchema>;

/** Un formulario de la página, con su regla y cuántos leads trajo. */
export const metaLeadFormSchema = metaFormRuleSchema.extend({
  /** Estado en Meta (ACTIVE, ARCHIVED…), si Meta deja listarlos. */
  status: z.string().nullable(),
  leadCount: z.number(),
  lastLeadAt: z.string().nullable(),
});
export type MetaLeadFormDto = z.infer<typeof metaLeadFormSchema>;

export const metaLeadFormsResultSchema = z.object({
  forms: z.array(metaLeadFormSchema),
  /**
   * false = Meta no dejó listar los formularios de la página (falta un
   * permiso): solo salen los que ya trajeron algún lead.
   */
  fromMeta: z.boolean(),
});
export type MetaLeadFormsResult = z.infer<typeof metaLeadFormsResultSchema>;

/** Una pregunta del formulario, para elegir a dónde va su respuesta. */
export const metaFormQuestionSchema = z.object({
  /** Nombre de la respuesta en los leads de Meta (la clave de `fieldMap`). */
  key: z.string(),
  label: z.string(),
  /** La última respuesta recibida, de ejemplo. */
  sample: z.string().nullable(),
});
export type MetaFormQuestion = z.infer<typeof metaFormQuestionSchema>;

export const metaFormQuestionsResultSchema = z.object({
  questions: z.array(metaFormQuestionSchema),
  /** false = Meta no dejó leer el formulario: salen las preguntas de los leads recibidos. */
  fromMeta: z.boolean(),
});
export type MetaFormQuestionsResult = z.infer<typeof metaFormQuestionsResultSchema>;

/** Página que devuelve Facebook al iniciar sesión, antes de conectarla. */
export const availableMetaPageSchema = z.object({
  pageId: z.string(),
  name: z.string(),
  connected: z.boolean(),
});
export type AvailableMetaPage = z.infer<typeof availableMetaPageSchema>;

export const metaPagesAvailableResultSchema = z.object({
  /** Identificador temporal de la sesión de conexión (caduca en minutos). */
  sessionId: z.string(),
  pages: z.array(availableMetaPageSchema),
});
export type MetaPagesAvailableResult = z.infer<
  typeof metaPagesAvailableResultSchema
>;

export const metaPagesAvailableSchema = z
  .object({
    /** Token de usuario que devuelve el login de Facebook (SDK de JavaScript, respuesta por defecto). */
    accessToken: z.string().min(1).optional(),
    /** Código del login (response_type "code"); se mantiene por compatibilidad. */
    code: z.string().min(1).optional(),
  })
  .refine((v) => !!v.accessToken || !!v.code, { message: "Falta el token o el código de Facebook" });
export type MetaPagesAvailableInput = z.infer<typeof metaPagesAvailableSchema>;

export const connectMetaPagesSchema = z.object({
  sessionId: z.string().min(1),
  pageIds: z.array(z.string()).min(1),
});
export type ConnectMetaPagesInput = z.infer<typeof connectMetaPagesSchema>;

export const updateMetaPageSchema = z.object({
  sourceId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
  createDeal: z.boolean().optional(),
  dealStageId: z.string().nullable().optional(),
  /** La lista entera de reglas por formulario (reemplaza la anterior). */
  formRules: z.array(metaFormRuleSchema).max(300).optional(),
  welcomeTemplateId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateMetaPageInput = z.infer<typeof updateMetaPageSchema>;

// ── Leads recibidos ──────────────────────────────────────────
export const metaLeadStatuses = ["PROCESSED", "NO_PHONE", "ERROR"] as const;
export type MetaLeadStatusValue = (typeof metaLeadStatuses)[number];

export const metaLeadFieldSchema = z.object({
  name: z.string(),
  value: z.string(),
});
export type MetaLeadField = z.infer<typeof metaLeadFieldSchema>;

export const metaLeadDtoSchema = z.object({
  id: z.string(),
  leadgenId: z.string(),
  pageId: z.string(),
  pageName: z.string(),
  formName: z.string().nullable(),
  /** Anuncio y campaña del lead, si Meta los da con el token de la página. */
  adName: z.string().nullable().default(null),
  campaignName: z.string().nullable().default(null),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(metaLeadStatuses),
  error: z.string().nullable(),
  contactId: z.string().nullable(),
  /** Todas las respuestas del formulario, para poder revisarlas. */
  fields: z.array(metaLeadFieldSchema),
  createdAt: z.string(),
});
export type MetaLeadDto = z.infer<typeof metaLeadDtoSchema>;

/** Convierte en contacto un lead que llegó sin teléfono. */
export const convertMetaLeadSchema = z.object({
  phone: phoneField,
});
export type ConvertMetaLeadInput = z.infer<typeof convertMetaLeadSchema>;

// ── Mapeo de los campos del formulario ───────────────────────
// Nombres estándar de Meta; lo que no encaje se guarda como campo suelto.
const PHONE_KEYS = ["phone_number", "work_phone_number", "telefono", "teléfono", "celular"];
const EMAIL_KEYS = ["email", "work_email", "correo", "correo_electronico"];
const FULL_NAME_KEYS = ["full_name", "nombre_completo", "nombre"];
const FIRST_NAME_KEYS = ["first_name", "nombres"];
const LAST_NAME_KEYS = ["last_name", "apellidos", "apellido"];

const normalize = (s: string) =>
  s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** A dónde iría solo una pregunta por su nombre: nombre, teléfono, correo o (null) un campo. */
export function metaFieldAutoTarget(name: string): "std:name" | "std:phone" | "std:email" | null {
  const key = normalize(name);
  if (PHONE_KEYS.includes(key)) return "std:phone";
  if (EMAIL_KEYS.includes(key)) return "std:email";
  if ([...FULL_NAME_KEYS, ...FIRST_NAME_KEYS, ...LAST_NAME_KEYS].includes(key)) return "std:name";
  return null;
}

/**
 * Traduce las respuestas del formulario (`field_data` de Meta) a los datos que
 * usa el CRM. Primero lo elegido en `fieldMap` (por formulario, en Ajustes);
 * el resto, por el nombre de la pregunta. Lo que no es teléfono, nombre ni
 * correo se conserva aparte para guardarlo como información extra del contacto.
 */
export function mapMetaLeadFields(
  fields: MetaLeadField[],
  fieldMap: Record<string, string> = {},
): {
  name: string | null;
  phone: string | null;
  email: string | null;
  extra: Record<string, string>;
} {
  let phone: string | null = null;
  let email: string | null = null;
  let fullName: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  const nameParts: string[] = [];
  const extra: Record<string, string> = {};

  for (const field of fields) {
    const to = fieldMap[field.name];
    const value = field.value.trim();
    if (!to || !value) continue;
    if (to === "std:phone") phone ??= value;
    else if (to === "std:email") email ??= value;
    else if (to === "std:name") nameParts.push(value);
    else if (to.startsWith("field:")) extra[to.slice("field:".length)] = value;
  }

  for (const field of fields) {
    if (fieldMap[field.name]) continue;
    const key = normalize(field.name);
    const value = field.value.trim();
    if (!value) continue;

    if (!phone && PHONE_KEYS.includes(key)) phone = value;
    else if (!email && EMAIL_KEYS.includes(key)) email = value;
    else if (!fullName && FULL_NAME_KEYS.includes(key)) fullName = value;
    else if (!firstName && FIRST_NAME_KEYS.includes(key)) firstName = value;
    else if (!lastName && LAST_NAME_KEYS.includes(key)) lastName = value;
    else extra[field.name] = value;
  }

  const name =
    nameParts.join(" ") ||
    (fullName ?? [firstName, lastName].filter(Boolean).join(" ").trim());

  return { name: name || null, phone, email, extra };
}
