import { z } from "zod";
import { phoneField } from "./contact.schema.js";

// Formularios de Meta (Lead Ads): páginas conectadas y leads recibidos.
// El token de cada página NUNCA sale de la API: el navegador solo ve ids y
// nombres.

export const metaPageDtoSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  /** Cuándo se suscribió a los avisos de leads. Null = sin suscribir. */
  subscribedAt: z.string().nullable(),
  sourceId: z.string().nullable(),
  tagIds: z.array(z.string()),
  createDeal: z.boolean(),
  welcomeTemplateId: z.string().nullable(),
  leadCount: z.number(),
  pendingCount: z.number(),
  createdAt: z.string(),
});
export type MetaPageDto = z.infer<typeof metaPageDtoSchema>;

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

/**
 * Traduce las respuestas del formulario (`field_data` de Meta) a los datos que
 * usa el CRM. Lo que no es teléfono, nombre ni correo se conserva aparte para
 * guardarlo como información extra del contacto.
 */
export function mapMetaLeadFields(fields: MetaLeadField[]): {
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
  const extra: Record<string, string> = {};

  for (const field of fields) {
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
    fullName ?? [firstName, lastName].filter(Boolean).join(" ").trim();

  return { name: name || null, phone, email, extra };
}
