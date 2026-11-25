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

// ── Formato del cuerpo ────────────────────────────────────────
/**
 * Un correo se escribe como texto (Driony le da un HTML sencillo: párrafos y
 * enlaces) o como HTML propio: un diseño hecho en otra herramienta, que sale
 * tal cual se pegó.
 */
export const emailFormats = ["text", "html"] as const;
export type EmailFormat = (typeof emailFormats)[number];

export const EMAIL_MAX_TEXT_CHARS = 20_000;
/** Gmail recorta los correos de más de unos 102 KB: el tope queda justo debajo. */
export const EMAIL_MAX_HTML_CHARS = 100_000;

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ".");

/** Por qué no vale un cuerpo en ese formato, o null si vale. */
export function emailBodyProblem(format: EmailFormat, body: string): string | null {
  if (format === "html") {
    if (body.length > EMAIL_MAX_HTML_CHARS) {
      return `El HTML pasa de ${thousands(EMAIL_MAX_HTML_CHARS)} caracteres: Gmail recorta los correos tan largos`;
    }
    return emailHtmlHasContent(body) ? null : "El HTML no tiene nada que mostrar";
  }
  return body.length > EMAIL_MAX_TEXT_CHARS ? `El mensaje pasa de ${thousands(EMAIL_MAX_TEXT_CHARS)} caracteres` : null;
}

const formatField = z.enum(emailFormats).default("text");
// El tope de verdad depende del formato y lo pone `checkBody`.
const bodyField = z
  .string()
  .trim()
  .min(1, "Falta el mensaje")
  .max(EMAIL_MAX_HTML_CHARS, `El mensaje pasa de ${thousands(EMAIL_MAX_HTML_CHARS)} caracteres: Gmail recorta los correos tan largos`);

/** Con el formato y el cuerpo delante, comprueba que casan. Si falta uno (al editar), lo mira el servicio. */
const checkBody = (v: { format?: EmailFormat; body?: string }, ctx: z.RefinementCtx) => {
  // Por encima del tope absoluto ya lo dijo el propio campo.
  if (v.format === undefined || v.body === undefined || v.body.length > EMAIL_MAX_HTML_CHARS) return;
  const problem = emailBodyProblem(v.format, v.body);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: problem });
};

// ── Plantillas ────────────────────────────────────────────────
const emailTemplateFields = z.object({
  name: z.string().trim().min(1, "Ponle un nombre").max(80),
  subject: z.string().trim().min(1, "Falta el asunto").max(200),
  body: bodyField,
  format: formatField,
  attachments: attachmentsField,
});
export const emailTemplateInputSchema = emailTemplateFields.superRefine(checkBody);
export type EmailTemplateInput = z.infer<typeof emailTemplateInputSchema>;
export type EmailTemplatePayload = z.input<typeof emailTemplateInputSchema>;
export const updateEmailTemplateSchema = emailTemplateFields.partial().superRefine(checkBody);
export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

export const emailTemplateDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  /** Texto con {{variables}}, o el HTML tal cual se escribió si `format` es «html». */
  body: z.string(),
  format: z.enum(emailFormats),
  attachments: z.array(emailAttachmentSchema),
  updatedAt: z.string(),
});
export type EmailTemplateDto = z.infer<typeof emailTemplateDtoSchema>;

// ── Enviar ────────────────────────────────────────────────────
export const sendEmailSchema = z
  .object({
    contactId: z.string().min(1),
    accountId: z.string().min(1),
    /** A dónde va. Si falta, al correo guardado del contacto. */
    to: emailField.optional(),
    /** Guardar `to` como el correo del contacto. */
    saveToContact: z.boolean().default(false),
    subject: z.string().trim().min(1, "Falta el asunto").max(200),
    body: bodyField,
    format: formatField,
    /** Plantilla de la que salió, si salió de una (solo para el historial). */
    templateId: z.string().optional(),
    attachments: attachmentsField,
  })
  .superRefine(checkBody);
export type SendEmailInput = z.infer<typeof sendEmailSchema>;
export type SendEmailPayload = z.input<typeof sendEmailSchema>;

export const emailStatuses = ["queued", "sent", "failed"] as const;
export type EmailStatus = (typeof emailStatuses)[number];

export const emailDtoSchema = z.object({
  id: z.string(),
  subject: z.string(),
  /** Siempre texto: de un correo HTML, lo que se lee en él. Su marcado no sale por aquí. */
  body: z.string(),
  format: z.enum(emailFormats),
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

// ── Cuerpo en HTML ────────────────────────────────────────────
// El HTML que escribe la empresa sale tal cual: no se reescribe ni se «limpia»,
// porque un filtro rompería lo que los diseños de correo necesitan (estilos,
// tablas, comentarios condicionales de Outlook). Por eso, dentro de Driony, ese
// HTML solo se enseña en un marco aislado (`emailPreviewDoc`, con `sandbox`) y
// nunca se inserta en la página. Estas funciones recorren el texto de una
// pasada: no hay expresiones que se atasquen con un HTML mal cerrado.

/**
 * Sustituye `{{variable}}` en un cuerpo HTML. El valor entra escapado: lo que
 * traiga un contacto en su nombre o en un campo se ve como texto, nunca como
 * marcado del correo.
 */
export function renderEmailHtml(html: string, vars: Record<string, string>): string {
  return html.replace(VAR_RE, (_, key: string) => escapeHtml(vars[key] ?? ""));
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
  iexcl: "¡", iquest: "¿", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", bull: "•", middot: "·", euro: "€", deg: "°",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const hex = ref[1] === "x" || ref[1] === "X";
      const code = hex ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[ref] ?? NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** El valor de un atributo dentro de una etiqueta ya recortada (`a href="…"`). */
function attrOf(tag: string, name: "href" | "src" | "alt"): string {
  const m = ATTR_RE[name].exec(tag);
  return decodeEntities(m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}
const attrRe = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
const ATTR_RE = { href: attrRe("href"), src: attrRe("src"), alt: attrRe("alt") };

/** Etiquetas cuyo contenido no es texto del correo. */
const HIDDEN_TAGS = new Set(["head", "style", "script", "title", "noscript", "template", "svg"]);
/** Las que separan párrafos. */
const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "blockquote", "section", "article", "header", "footer", "pre", "hr"]);

const bareUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();

/**
 * Lo que se lee en un correo HTML, como texto: va de parte alternativa en el
 * envío (quien no ve HTML lee esto) y es lo que se guarda en el historial. Los
 * enlaces quedan como «texto (dirección)» y las imágenes, con su descripción.
 */
export function emailHtmlToText(html: string): string {
  const lower = html.toLowerCase();
  const n = html.length;
  let out = "";
  let href = ""; // el enlace abierto y dónde empezó su texto
  let hrefAt = 0;
  const text = (raw: string) => {
    out += decodeEntities(raw.replace(/\s+/g, " "));
  };
  let i = 0;
  let gt = -2; // el próximo «>»: se busca una vez y vale hasta pasarlo
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      text(html.slice(i));
      break;
    }
    if (lt > i) text(html.slice(i, lt));
    if (lower.startsWith("<!--", lt)) {
      const end = lower.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (gt !== -1 && gt <= lt) gt = html.indexOf(">", lt + 1);
    if (gt < 0) {
      text(html.slice(lt)); // un «<» suelto: es texto
      break;
    }
    const first = html[lt + 1];
    if (first === "!" || first === "?") {
      i = gt + 1; // <!DOCTYPE …>, <?xml …>
      continue;
    }
    const m = /^(\/?)([a-z][a-z0-9]*)/i.exec(html.slice(lt + 1, lt + 34));
    if (!m) {
      text("<"); // «3 < 5»
      i = lt + 1;
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const tag = html.slice(lt + 1, gt);
    i = gt + 1;
    if (!closing && HIDDEN_TAGS.has(name)) {
      const end = lower.indexOf(`</${name}`, i);
      const endGt = end < 0 ? -1 : html.indexOf(">", end);
      i = endGt < 0 ? n : endGt + 1;
    } else if (name === "a") {
      if (closing) {
        const label = out.slice(hrefAt).trim();
        if (href && bareUrl(label) !== bareUrl(href) && !label.includes(href)) out += ` (${href})`;
        href = "";
      } else {
        const url = attrOf(tag, "href");
        href = /^https?:\/\//i.test(url) ? url : /^mailto:/i.test(url) ? (url.slice(7).split("?")[0] ?? "") : "";
        hrefAt = out.length;
      }
    } else if (name === "img" && !closing) {
      const alt = attrOf(tag, "alt");
      if (alt) out += ` ${alt} `;
    } else if (name === "li") {
      // Cada elemento en su línea; el salto lo pone el que abre.
      if (!closing) out += "\n- ";
    } else if (BLOCK_TAGS.has(name)) {
      out += "\n\n";
    } else if (name === "br" || (closing && (name === "tr" || name === "td" || name === "th"))) {
      // Cada celda en su línea: en un correo las tablas son las columnas del diseño.
      out += "\n";
    }
  }
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Un HTML con algo que ver: texto o, al menos, una imagen. */
export function emailHtmlHasContent(html: string): boolean {
  return /<img\b/i.test(html) || emailHtmlToText(html).length > 0;
}

/**
 * Añade un bloque al final de un cuerpo HTML: antes de `</body>` si es un
 * documento completo, o detrás si es solo un fragmento.
 */
export function appendEmailHtml(html: string, block: string): string {
  if (!block) return html;
  const at = html.toLowerCase().lastIndexOf("</body");
  return at < 0 ? html + block : html.slice(0, at) + block + html.slice(at);
}

/** Dónde acaba la etiqueta de apertura `<name …>`, o -1 si no está. */
function openTagEnd(html: string, lower: string, name: string): number {
  let from = 0;
  for (;;) {
    const at = lower.indexOf(`<${name}`, from);
    if (at < 0) return -1;
    from = at + name.length + 1;
    // «<head» no es «<header».
    if (/[a-z0-9]/.test(lower[from] ?? "")) continue;
    const gt = html.indexOf(">", from);
    return gt < 0 ? -1 : gt + 1;
  }
}

/**
 * Cosas de un HTML que no van a funcionar en un programa de correo, dichas
 * para quien lo pega. No bloquean el envío.
 */
export function emailHtmlWarnings(html: string): string[] {
  const out: string[] = [];
  const lower = html.toLowerCase();
  if (openTagEnd(html, lower, "script") >= 0) {
    out.push("Tiene <script>: ningún programa de correo ejecuta código, y puede mandar tu correo a spam.");
  }
  if (["form", "iframe", "video", "audio", "object", "embed"].some((t) => openTagEnd(html, lower, t) >= 0)) {
    out.push("Formularios, vídeos e iframes no funcionan en casi ningún programa de correo: usa un enlace o un botón.");
  }
  let unreachable = 0;
  for (let from = 0; ; ) {
    const at = lower.indexOf("<img", from);
    if (at < 0) break;
    const gt = html.indexOf(">", at);
    if (gt < 0) break;
    from = gt + 1;
    if (/[a-z0-9]/.test(lower[at + 4] ?? "")) continue;
    const src = attrOf(html.slice(at + 1, gt), "src");
    // Una variable puede traer la dirección: no se sabe hasta enviar.
    if (!/^https?:\/\//i.test(src) && !src.includes("{{")) unreachable++;
  }
  if (unreachable) {
    out.push(
      `${unreachable === 1 ? "Una imagen no se verá" : `${unreachable} imágenes no se verán`}: su dirección tiene que empezar por https:// (una imagen pegada o guardada en tu computadora no llega).`,
    );
  }
  return out;
}

const PREVIEW_HEAD =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; media-src https:; style-src 'unsafe-inline' https:; font-src https: data:">` +
  `<base target="_blank">`;

/**
 * El documento para enseñar un correo HTML dentro de Driony. Va siempre en un
 * `<iframe sandbox>` sin permiso de scripts ni de origen: aunque el HTML traiga
 * código, no se ejecuta ni alcanza la sesión. La política de contenido que se
 * le añade es una segunda barrera (ni scripts, ni marcos, ni formularios).
 */
export function emailPreviewDoc(html: string): string {
  const lower = html.toLowerCase();
  const head = openTagEnd(html, lower, "head");
  if (head >= 0) return html.slice(0, head) + PREVIEW_HEAD + html.slice(head);
  const root = openTagEnd(html, lower, "html");
  if (root >= 0) return `${html.slice(0, root)}<head>${PREVIEW_HEAD}</head>${html.slice(root)}`;
  return `<!doctype html><html><head><meta charset="utf-8">${PREVIEW_HEAD}</head><body style="margin:0;padding:16px">${html}</body></html>`;
}
