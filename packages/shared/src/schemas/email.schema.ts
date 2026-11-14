import { z } from "zod";
import { isDialable } from "../phone.js";

/**
 * Correo: la empresa conecta su propio buzón por SMTP y escribe desde ahí a sus
 * contactos, a mano o desde un flujo. Driony no tiene servicio de envío propio:
 * el correo sale de la dirección real del negocio y las respuestas llegan a su
 * buzón de siempre.
 */

// ── La dirección de un contacto ───────────────────────────────
/**
 * El correo del contacto vive en sus campos (Contact.metadata) con esta clave:
 * es la misma que ya escriben los formularios de Meta, la API y los webhooks.
 */
export const CONTACT_EMAIL_KEY = "email";
/** Otras claves con las que suele llegar de fuera; se leen si `email` falta. */
const EMAIL_ALIASES = ["email", "correo", "correo_electronico", "e_mail", "mail", "work_email"] as const;

const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

export function isEmailAddress(value: string | null | undefined): boolean {
  return !!value && value.length <= 254 && EMAIL_RE.test(value.trim());
}

/** Dirección limpia y en minúsculas, o null si no es una dirección. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return isEmailAddress(v) ? v : null;
}

/** El correo de un contacto a partir de sus campos, o null si no tiene uno válido. */
export function contactEmailOf(fields: Record<string, unknown> | null | undefined): string | null {
  if (!fields) return null;
  for (const key of EMAIL_ALIASES) {
    const found = normalizeEmail(typeof fields[key] === "string" ? (fields[key] as string) : null);
    if (found) return found;
  }
  return null;
}

const emailField = z
  .string()
  .trim()
  .max(254)
  .transform((v) => v.toLowerCase())
  .refine(isEmailAddress, "Correo no válido");

// ── Buzones ───────────────────────────────────────────────────
export const emailProviders = ["gmail", "outlook", "smtp"] as const;
export type EmailProvider = (typeof emailProviders)[number];

/** Servidor de salida de cada proveedor y lo que hay que saber antes de conectarlo. */
export const EMAIL_PROVIDER_PRESETS: Record<EmailProvider, { label: string; host: string; port: number; help: string }> = {
  gmail: {
    label: "Gmail o Google Workspace",
    host: "smtp.gmail.com",
    port: 465,
    help: "Google pide la verificación en dos pasos activada y una contraseña de aplicación: tu contraseña normal no sirve.",
  },
  outlook: {
    label: "Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    help: "Solo funciona si el administrador de Microsoft 365 tiene activado el SMTP autenticado para este buzón.",
  },
  smtp: {
    label: "Otro proveedor (SMTP)",
    host: "",
    port: 587,
    help: "Usa los datos de salida (SMTP) que te da tu proveedor de correo o tu hosting.",
  },
};

/** Puertos de envío autenticado. El 25 es de servidor a servidor y no se admite. */
export const EMAIL_SMTP_PORTS = [465, 587, 2525] as const;

/** Tope de correos al día por buzón: protege la reputación de la dirección. */
export const EMAIL_DEFAULT_DAILY_LIMIT = 300;
export const EMAIL_MAX_DAILY_LIMIT = 2000;

export const emailAccountInputSchema = z.object({
  address: emailField,
  /** Nombre que ve quien recibe («Ana de Clínica Sol»). Vacío = el de la empresa. */
  fromName: z.string().trim().max(80).default(""),
  provider: z.enum(emailProviders).default("smtp"),
  smtpHost: z
    .string()
    .trim()
    .min(3, "Falta el servidor de salida")
    .max(200)
    .transform((v) => v.toLowerCase())
    // Solo la forma. Qué servidores se admiten lo decide la API: en la nube,
    // nombres públicos; en una instalación propia, también un relay interno.
    .refine((v) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(v), "Servidor no válido: escribe el nombre, sin http ni puerto"),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUser: z.string().trim().min(1, "Falta el usuario").max(200),
  smtpPass: z.string().min(1, "Falta la contraseña").max(500),
  /** Dueño del buzón: un usuario (personal) o null (compartido por la empresa). */
  userId: z.string().nullable().default(null),
  signature: z.string().max(2000).default(""),
  dailyLimit: z.number().int().min(1).max(EMAIL_MAX_DAILY_LIMIT).default(EMAIL_DEFAULT_DAILY_LIMIT),
});
export type EmailAccountInput = z.infer<typeof emailAccountInputSchema>;
/** Lo que manda el navegador (los valores por defecto aún sin poner). */
export type EmailAccountPayload = z.input<typeof emailAccountInputSchema>;

/** Al editar, la contraseña vacía o ausente conserva la guardada. */
export const updateEmailAccountSchema = emailAccountInputSchema
  .partial()
  .extend({ smtpPass: z.string().max(500).optional() });
export type UpdateEmailAccountInput = z.infer<typeof updateEmailAccountSchema>;
export type UpdateEmailAccountPayload = z.input<typeof updateEmailAccountSchema>;

export const emailAccountDtoSchema = z.object({
  id: z.string(),
  address: z.string(),
  fromName: z.string(),
  provider: z.enum(emailProviders),
  smtpHost: z.string(),
  smtpPort: z.number(),
  smtpUser: z.string(),
  /** Dueño (buzón personal) o null (compartido). */
  owner: z.object({ id: z.string(), name: z.string() }).nullable(),
  signature: z.string(),
  dailyLimit: z.number(),
  /** Correos que salieron hoy por este buzón (día UTC). */
  sentToday: z.number(),
  status: z.enum(["ok", "error"]),
  lastError: z.string().nullable(),
  lastSentAt: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});
export type EmailAccountDto = z.infer<typeof emailAccountDtoSchema>;

// ── Adjuntos ──────────────────────────────────────────────────
export const EMAIL_MAX_ATTACHMENTS = 5;
/** Suma de adjuntos por correo. Casi todos los servidores cortan entre 20 y 25 MB. */
export const EMAIL_MAX_ATTACH_BYTES = 15 * 1024 * 1024;

export const emailAttachmentSchema = z.object({
  /** Referencia interna del archivo subido («storage://…»). */
  ref: z.string().regex(/^storage:\/\/[A-Za-z0-9._-]{8,120}$/, "Adjunto no válido"),
  name: z.string().trim().min(1).max(160),
  mimeType: z.string().max(120),
  size: z.number().int().min(0),
});
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

const attachmentsField = z
  .array(emailAttachmentSchema)
  .max(EMAIL_MAX_ATTACHMENTS, `Como máximo ${EMAIL_MAX_ATTACHMENTS} adjuntos`)
  .refine((list) => list.reduce((sum, a) => sum + a.size, 0) <= EMAIL_MAX_ATTACH_BYTES, "Los adjuntos pasan de 15 MB en total")
  .default([]);

// ── Plantillas ────────────────────────────────────────────────
export const emailTemplateInputSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre").max(80),
  subject: z.string().trim().min(1, "Falta el asunto").max(200),
  body: z.string().trim().min(1, "Falta el mensaje").max(20000),
  attachments: attachmentsField,
});
export type EmailTemplateInput = z.infer<typeof emailTemplateInputSchema>;
export type EmailTemplatePayload = z.input<typeof emailTemplateInputSchema>;
export const updateEmailTemplateSchema = emailTemplateInputSchema.partial();
export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

export const emailTemplateDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  attachments: z.array(emailAttachmentSchema),
  updatedAt: z.string(),
});
export type EmailTemplateDto = z.infer<typeof emailTemplateDtoSchema>;

// ── Enviar ────────────────────────────────────────────────────
export const sendEmailSchema = z.object({
  contactId: z.string().min(1),
  accountId: z.string().min(1),
  /** A dónde va. Si falta, al correo guardado del contacto. */
  to: emailField.optional(),
  /** Guardar `to` como el correo del contacto. */
  saveToContact: z.boolean().default(false),
  subject: z.string().trim().min(1, "Falta el asunto").max(200),
  body: z.string().trim().min(1, "Falta el mensaje").max(20000),
  /** Plantilla de la que salió, si salió de una (solo para el historial). */
  templateId: z.string().optional(),
  attachments: attachmentsField,
});
export type SendEmailInput = z.infer<typeof sendEmailSchema>;
export type SendEmailPayload = z.input<typeof sendEmailSchema>;

export const emailStatuses = ["queued", "sent", "failed"] as const;
export type EmailStatus = (typeof emailStatuses)[number];

export const emailDtoSchema = z.object({
  id: z.string(),
  subject: z.string(),
  body: z.string(),
  from: z.string(),
  to: z.string(),
  status: z.enum(emailStatuses),
  error: z.string().nullable(),
  /** Lo envió una automatización (flujo), no una persona. */
  automated: z.boolean(),
  /** Quién lo envió, o de dónde salió si fue automático. */
  sentBy: z.string().nullable(),
  attachments: z.array(z.object({ name: z.string(), size: z.number() })),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export type EmailDto = z.infer<typeof emailDtoSchema>;

export const emailUnsubscribeDtoSchema = z.object({ id: z.string(), address: z.string(), createdAt: z.string() });
export type EmailUnsubscribeDto = z.infer<typeof emailUnsubscribeDtoSchema>;

/** Lo que necesita la pantalla de redactar para un contacto. */
export interface EmailComposeContext {
  /** Su correo guardado, o null si no tiene. */
  to: string | null;
  /** Valores de las variables para este contacto y quien escribe. */
  vars: Record<string, string>;
  /** Buzones desde los que esta persona puede escribir. */
  accounts: EmailAccountDto[];
  /** Pidió no recibir correos automáticos (a mano se le puede escribir igual). */
  unsubscribed: boolean;
}

/** Buzón que usa un bloque «Enviar correo»: uno concreto, el del responsable del chat o el de la empresa. */
export const EMAIL_ACCOUNT_ASSIGNEE = "assignee";
export const EMAIL_ACCOUNT_DEFAULT = "default";

// ── Variables y cuerpo ────────────────────────────────────────
/** Variables que siempre existen. Además vale la clave de cualquier campo del contacto. */
export const EMAIL_VARIABLES = [
  { key: "nombre", label: "Nombre completo" },
  { key: "primer_nombre", label: "Primer nombre" },
  { key: "telefono", label: "Teléfono" },
  { key: "correo", label: "Correo" },
  { key: "empresa", label: "Tu empresa" },
  { key: "agente", label: "Quien envía" },
] as const;

export interface EmailVarsInput {
  contact: { name: string | null; phone: string; fields: Record<string, string> };
  orgName: string;
  /** Nombre de quien firma el envío (el usuario, o el nombre del buzón). */
  senderName: string | null;
  /** Variables del flujo que lanza el correo: mandan sobre las demás. */
  extra?: Record<string, string>;
}

/** Los valores con los que se rellena un correo para un contacto. */
export function buildEmailVars(input: EmailVarsInput): Record<string, string> {
  const name = (input.contact.name ?? "").trim();
  return {
    ...input.contact.fields,
    nombre: name,
    primer_nombre: name.split(/\s+/)[0] ?? "",
    // Un identificador de Messenger, Instagram o TikTok no es un teléfono que enseñar.
    telefono: isDialable(input.contact.phone) ? input.contact.phone : "",
    correo: contactEmailOf(input.contact.fields) ?? "",
    empresa: input.orgName,
    agente: (input.senderName ?? "").trim(),
    ...(input.extra ?? {}),
  };
}

const VAR_RE = /\{\{\s*(\w+)\s*\}\}/g;

/** Sustituye `{{variable}}`. Una variable desconocida o vacía queda en blanco. */
export function renderEmailText(text: string, vars: Record<string, string>): string {
  return text.replace(VAR_RE, (_, key: string) => vars[key] ?? "");
}

/** Variables que usa un texto y se quedarían en blanco con estos valores. */
export function emptyEmailVars(text: string, vars: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) {
    if (!(vars[m[1]!] ?? "").trim()) out.add(m[1]!);
  }
  return [...out];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Enlaces http(s) del texto, ya escapado, convertidos en `<a>`. */
function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => `<a href="${url}" style="color:#1a56db">${url}</a>`);
}

/**
 * El cuerpo que escribe la persona (texto con saltos de línea) como HTML
 * sencillo: párrafos, saltos y enlaces. Todo lo demás se escapa: nada de lo que
 * venga en una variable puede meter marcado en el correo.
 */
export function emailTextToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2430">${paragraphs.join("")}</div>`;
}

/** El cuerpo con la firma del buzón debajo, si la hay. */
export function withEmailSignature(body: string, signature: string | null | undefined): string {
  const sig = (signature ?? "").trim();
  return sig ? `${body.trimEnd()}\n\n${sig}` : body;
}
