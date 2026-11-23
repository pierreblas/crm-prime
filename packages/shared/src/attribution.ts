/**
 * Atribución de marketing: de qué anuncio o campaña viene un contacto.
 *
 * Hay dos vías distintas y conviene no confundirlas:
 *
 *  1. Anuncios Click-to-WhatsApp: Meta adjunta un objeto `referral` al
 *     mensaje que el cliente envía tras tocar el anuncio (texto, imagen, audio,
 *     ubicación…; no a las respuestas de botones). NO trae utm_*; trae el id
 *     del anuncio y el `ctwa_clid`, que es lo que permite devolver
 *     conversiones a Meta. Meta omite el `ctwa_clid` en los anuncios de
 *     Estados de WhatsApp.
 *  2. Enlaces wa.me con texto prellenado (`wa.me/519...?text=Hola utm_source=ig`):
 *     ahí sí viajan los utm_*, pero dentro del texto del mensaje, así que hay
 *     que extraerlos y limpiar el texto para que el agente no vea el churro.
 */

// ── 1. Anuncio Click-to-WhatsApp ─────────────────────────────
export interface AdReferral {
  sourceUrl: string | null;
  sourceId: string | null; // id del anuncio
  sourceType: string | null; // ad | post
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  ctwaClid: string | null; // click id (Conversions API)
  welcomeMessage: string | null; // saludo que el anuncio le mostró antes de escribir
  ref: string | null; // campo nuevo de Meta, sin documentar: se guarda tal cual
}

// Etiqueta corta para mostrar en la UI: el titular, o el id del anuncio.
export function adReferralLabel(r: Pick<AdReferral, "headline" | "sourceId">): string {
  return r.headline?.trim() || r.sourceId?.trim() || "Anuncio";
}

/**
 * Lee un referral guardado (Conversation.referral, Message.referral). Se
 * guarda en camelCase, pero se acepta también la forma de Meta (snake_case)
 * por si alguna fila antigua o una importación lo dejó así. null si no es un
 * referral.
 */
export function readAdReferral(raw: unknown): AdReferral | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (camel: string, snake: string): string | null => {
    const v = r[camel] ?? r[snake];
    return typeof v === "string" && v.trim() ? v : null;
  };
  const welcome = r.welcomeMessage ?? (r.welcome_message as { text?: unknown } | undefined)?.text;
  const out: AdReferral = {
    sourceUrl: s("sourceUrl", "source_url"),
    sourceId: s("sourceId", "source_id"),
    sourceType: s("sourceType", "source_type"),
    headline: s("headline", "headline"),
    body: s("body", "body"),
    mediaType: s("mediaType", "media_type"),
    imageUrl: s("imageUrl", "image_url"),
    videoUrl: s("videoUrl", "video_url"),
    thumbnailUrl: s("thumbnailUrl", "thumbnail_url"),
    ctwaClid: s("ctwaClid", "ctwa_clid"),
    welcomeMessage: typeof welcome === "string" && welcome.trim() ? welcome : null,
    ref: s("ref", "ref"),
  };
  return out.sourceId || out.ctwaClid || out.sourceUrl || out.headline ? out : null;
}

// ── 2. UTMs en el texto del primer mensaje ───────────────────
export const utmKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export type UtmKey = (typeof utmKeys)[number];

/**
 * Los UTM de la ÚLTIMA vez que llegó, si vino otra vez por una campaña. Los de
 * `utmKeys` son los de la primera (los reportes) y no cambian nunca; estos son
 * los que usan el agente y los flujos, que necesitan saber de qué le hablan hoy.
 */
const lastOf = (k: UtmKey) => k.replace("utm_", "utm_last_");
export const utmLastKeys: readonly string[] = utmKeys.map(lastOf);
/** Todas: ninguna es un dato del negocio ni se edita a mano. */
export const allUtmKeys: readonly string[] = [...utmKeys, ...utmLastKeys];

const textOf = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function utmSet(meta: Record<string, unknown>, keyOf: (k: UtmKey) => string): Utms {
  const out: Utms = {};
  for (const k of utmKeys) {
    const v = textOf(meta[keyOf(k)]);
    if (v) out[k] = v;
  }
  return out;
}

const sameUtms = (a: Utms, b: Utms) => utmKeys.every((k) => (a[k] ?? "") === (b[k] ?? ""));

/** Los UTM que valen hoy: los de la última vez y, si solo vino una, los de la primera. */
export function currentUtms(metadata: unknown): Utms {
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const last = utmSet(meta, lastOf);
  return Object.keys(last).length ? last : utmSet(meta, (k) => k);
}

/**
 * Suma una llegada con UTM a lo guardado del contacto: la primera se queda y las
 * siguientes reemplazan la «última» entera (a trozos darían una campaña que
 * nunca existió). Devuelve la metadata nueva, o null si no cambia nada.
 */
export function addUtmTouch(metadata: unknown, incoming: Utms): Record<string, unknown> | null {
  const meta = { ...(metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {}) };
  const next = utmSet(incoming as Record<string, unknown>, (k) => k);
  if (!Object.keys(next).length) return null;
  const first = utmSet(meta, (k) => k);
  if (!Object.keys(first).length) return { ...meta, ...next };
  if (sameUtms(currentUtms(meta), next)) return null;
  for (const k of utmKeys) {
    if (next[k]) meta[lastOf(k)] = next[k];
    else delete meta[lastOf(k)];
  }
  return meta;
}

/**
 * Un dato de origen listo para dárselo a la IA. Lo escribe quien arma el enlace
 * (o quien lo toca), así que va en una línea, corto y sin los signos con los que
 * se marcan secciones, variables y citas.
 */
export function cleanOrigin(value: unknown, max = 80): string {
  return textOf(value)
    .replace(/[\u0000-\u001f\u007f{}«»#`<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

export type Utms = Partial<Record<UtmKey, string>>;

// Acepta las formas en que suele llegar el texto prellenado:
//   "Hola utm_source=ig&utm_campaign=verano"
//   "Hola ?utm_source=ig&utm_campaign=verano"
//   "Hola [utm_source=ig|utm_campaign=verano]"
const UTM_PAIR = new RegExp(`\\b(${utmKeys.join("|")})\\s*[=:]\\s*([^\\s&|,;\\]]+)`, "gi");

export interface ParsedUtms {
  utms: Utms;
  /** El mensaje sin los parámetros, para mostrarlo limpio en el chat. */
  cleanText: string;
}

/**
 * UTMs en la query de una URL. En los anuncios se pueden configurar
 * "parámetros de URL", y cuando los hay acaban en el `source_url` del
 * referral; si no, esto simplemente no encuentra nada.
 */
export function utmsFromUrl(url: string | undefined | null): Utms {
  if (!url) return {};
  const query = url.split("?")[1];
  if (!query) return {};

  const utms: Utms = {};
  for (const part of query.split("&")) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim().toLowerCase();
    if (!key || !(utmKeys as readonly string[]).includes(key)) continue;
    const raw = rest.join("=");
    if (!raw) continue;
    try {
      utms[key as UtmKey] = decodeURIComponent(raw.replace(/\+/g, " ")).slice(0, 120);
    } catch {
      utms[key as UtmKey] = raw.slice(0, 120);
    }
  }
  return utms;
}

export function parseUtms(text: string | undefined | null): ParsedUtms {
  if (!text) return { utms: {}, cleanText: text ?? "" };

  const utms: Utms = {};
  for (const match of text.matchAll(UTM_PAIR)) {
    const key = match[1]?.toLowerCase() as UtmKey | undefined;
    const value = match[2];
    if (key && value && !utms[key]) {
      utms[key] = decodeURIComponent(value).slice(0, 120);
    }
  }
  if (Object.keys(utms).length === 0) return { utms: {}, cleanText: text };

  // Quitar los pares y solo los separadores de parámetros ("?", "&", "|"),
  // nunca la puntuación normal del mensaje: "Hola, quiero info" conserva
  // su coma.
  const cleanText =
    text
      .replace(UTM_PAIR, "")
      .replace(/[?&|]+/g, " ")
      .replace(/\[\s*\]|\(\s*\)/g, "")
      // Separadores que quedaron colgando al final tras borrar los pares.
      .replace(/[\s,;]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim() || text.trim();

  return { utms, cleanText };
}
