import { env } from "../../common/utils/env";

/**
 * La plantilla de los correos del sistema (los que manda Driony, no una
 * empresa): cabecera noir con el logo, filete lima, tarjeta blanca y pie con el
 * motivo del correo.
 *
 * HTML de correo, no de web: tablas, estilos en línea y nada que dependa de CSS
 * moderno, porque Outlook pinta con el motor de Word y Gmail quita casi todo lo
 * que va en `<style>`. Lo único que va en `<style>` es para el teléfono (Gmail
 * y Apple Mail lo respetan); sin eso el correo se lee igual.
 *
 * El logo es un PNG servido por la web (`/email/driony-logo.png`): Gmail y
 * Outlook no muestran SVG. Con las imágenes bloqueadas queda el texto
 * alternativo «Driony» en lima sobre noir.
 */

export type SystemEmailLocale = "es" | "en";

interface Action {
  url: string;
  label: string;
}

export interface SystemEmailContent {
  locale: SystemEmailLocale;
  subject: string;
  /** El texto que la bandeja enseña junto al asunto. */
  preheader: string;
  /** De qué empresa va el correo, encima del título. */
  context?: string;
  title: string;
  paragraphs: string[];
  /** El botón principal (lima), con la dirección debajo por si el botón no se ve. */
  action?: Action & { facts?: string };
  /** Un recuadro de aviso, con su propio botón si hace falta. */
  callout?: { title: string; text: string; action?: Action };
  /** Una línea en gris al final de la tarjeta. */
  note?: string;
  /** Por qué le llega este correo (pie). */
  reason: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const C = {
  page: "#eceef1",
  noir: "#0a0b10",
  lime: "#e2f80d",
  card: "#ffffff",
  ink: "#0a0b10",
  body: "#2a313c",
  muted: "#5b6573",
  rule: "#e3e6ea",
  well: "#f3f4f6",
  warnBg: "#fff7e6",
  warnRule: "#f0d49a",
} as const;

const SANS = "'Hanken Grotesk','Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SF Mono',Menlo,Consolas,'Courier New',monospace";

const COPY = {
  es: {
    fallback: "¿El botón no funciona? Copia esta dirección en tu navegador:",
    tagline: "CRM de WhatsApp con agentes de IA",
  },
  en: {
    fallback: "Button not working? Paste this address into your browser:",
    tagline: "WhatsApp CRM with AI agents",
  },
} as const;

/**
 * La web de Driony (o la de quien opere la instalación): de aquí sale el logo
 * y los enlaces del pie. En la nube, el dominio raíz; en una instalación
 * propia, la dirección de su web.
 */
export function webBaseUrl(): string {
  const base = env("SAAS_BASE_DOMAIN");
  if (base) return `${base.startsWith("localhost") ? "http" : "https"}://${base}`;
  const origin = env("WEB_PUBLIC_URL") ?? env("WEB_ORIGIN")?.split(",")[0]?.trim() ?? "http://localhost:3000";
  return (origin || "http://localhost:3000").replace(/\/+$/, "");
}

/** El panel de una empresa: su subdominio en la nube, o la web en una instalación propia. */
export function orgWebUrl(slug: string): string {
  const base = env("SAAS_BASE_DOMAIN");
  if (base && slug) return `${base.startsWith("localhost") ? "http" : "https"}://${slug}.${base}`;
  return webBaseUrl();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderSystemEmail(c: SystemEmailContent): RenderedEmail {
  return { subject: c.subject, text: textOf(c), html: htmlOf(c) };
}

// ── Texto plano ─────────────────────────────────────────────
// Va siempre junto al HTML: hay quien lee sin HTML, y los filtros de spam
// desconfían de un correo que solo trae HTML.
function textOf(c: SystemEmailContent): string {
  const parts: string[] = [];
  if (c.context) parts.push(c.context);
  parts.push(...c.paragraphs);
  if (c.action) {
    parts.push(c.action.url);
    if (c.action.facts) parts.push(c.action.facts);
  }
  if (c.callout) {
    parts.push(`${c.callout.title}\n${c.callout.text}${c.callout.action ? `\n${c.callout.action.url}` : ""}`);
  }
  if (c.note) parts.push(c.note);
  parts.push(`—\n${c.reason}\nDriony · ${COPY[c.locale].tagline}`);
  return parts.join("\n\n");
}

// ── HTML ────────────────────────────────────────────────────
function htmlOf(c: SystemEmailContent): string {
  const copy = COPY[c.locale];
  const site = webBaseUrl();
  const e = escapeHtml;

  const p = (t: string) =>
    `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.body}">${e(t)}</p>`;

  // Botón «a prueba de clientes»: la celda lleva el color (Outlook ignora el
  // padding de los enlaces) y el enlace, el relleno para el resto.
  const button = (a: Action, bg: string, fg: string, border: string) => `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" class="btn">
  <tr>
    <td align="center" bgcolor="${bg}" style="background:${bg};border:1px solid ${border}">
      <a href="${e(a.url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:15px;line-height:18px;font-weight:700;color:${fg};text-decoration:none">${e(a.label)}</a>
    </td>
  </tr>
</table>`;

  const context = c.context
    ? `<p style="margin:0 0 10px;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted}">${e(c.context)}</p>`
    : "";

  const action = c.action
    ? `
<div style="margin:26px 0 0">${button(c.action, C.lime, C.noir, "#c9dd0a")}</div>
${c.action.facts ? `<p style="margin:12px 0 0;font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${C.muted}">${e(c.action.facts)}</p>` : ""}
<p style="margin:26px 0 8px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted}">${e(copy.fallback)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td bgcolor="${C.well}" style="background:${C.well};border:1px solid ${C.rule};padding:10px 12px;font-family:${MONO};font-size:12px;line-height:18px;color:${C.body};word-break:break-all">
      <a href="${e(c.action.url)}" target="_blank" style="color:${C.body};text-decoration:underline;word-break:break-all">${e(c.action.url)}</a>
    </td>
  </tr>
</table>`
    : "";

  const callout = c.callout
    ? `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 0">
  <tr>
    <td bgcolor="${C.warnBg}" style="background:${C.warnBg};border:1px solid ${C.warnRule};padding:18px 20px">
      <p style="margin:0 0 6px;font-family:${SANS};font-size:15px;line-height:22px;font-weight:700;color:${C.ink}">${e(c.callout.title)}</p>
      <p style="margin:0;font-family:${SANS};font-size:14px;line-height:22px;color:${C.body}">${e(c.callout.text)}</p>
      ${c.callout.action ? `<div style="margin:16px 0 0">${button(c.callout.action, C.noir, "#ffffff", C.noir)}</div>` : ""}
    </td>
  </tr>
</table>`
    : "";

  const note = c.note
    ? `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0">
  <tr><td style="border-top:1px solid ${C.rule};padding:18px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted}">${e(c.note)}</td></tr>
</table>`
    : "";

  // Relleno invisible tras el preheader: que la bandeja no complete la vista
  // previa con el principio del cuerpo.
  const filler = "&#847;&zwnj;&nbsp;".repeat(60);

  return `<!doctype html>
<html lang="${c.locale}" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(c.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>td,p,a,span{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<style>
  body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
  @media only screen and (max-width:600px){
    .shell{padding:16px 0!important}
    .px{padding-left:22px!important;padding-right:22px!important}
    .title{font-size:22px!important;line-height:28px!important}
    .btn{width:100%!important}
    .btn a{display:block!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${e(c.preheader)}${filler}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.page}" style="background:${C.page}">
  <tr>
    <td align="center" class="shell" style="padding:32px 12px">
      <!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto">
        <tr>
          <td class="px" bgcolor="${C.noir}" style="background:${C.noir};padding:22px 36px">
            <a href="${e(site)}" target="_blank" style="text-decoration:none"><img src="${e(site)}/email/driony-logo.png" width="120" height="34" alt="Driony" style="display:block;border:0;width:120px;height:34px;font-family:${SANS};font-size:22px;line-height:34px;font-weight:700;color:${C.lime}"></a>
          </td>
        </tr>
        <tr><td bgcolor="${C.lime}" height="4" style="background:${C.lime};height:4px;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr>
          <td class="px" bgcolor="${C.card}" style="background:${C.card};padding:36px 40px 34px">
            ${context}
            <h1 class="title" style="margin:0 0 18px;font-family:${SANS};font-size:24px;line-height:30px;font-weight:700;color:${C.ink}">${e(c.title)}</h1>
            ${c.paragraphs.map(p).join("\n            ")}
            ${action}
            ${callout}
            ${note}
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:20px 40px 8px;font-family:${SANS};font-size:12px;line-height:18px;color:${C.muted}">
            <p style="margin:0 0 6px">${e(c.reason)}</p>
            <p style="margin:0"><a href="${e(site)}" target="_blank" style="color:${C.muted};text-decoration:underline">Driony</a> · ${e(copy.tagline)}</p>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}
