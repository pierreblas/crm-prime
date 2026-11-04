import { Logger } from "@nestjs/common";

/**
 * Lo que trae un mensaje de Meta, separado en dos:
 *
 *  - `text`: lo que escribió la persona (o el botón que pulsó). Va a `content`
 *    y lo leen los flujos, las palabras clave y la baja por «STOP».
 *  - `note`: lo que explica Driony de un mensaje sin texto escrito: el contacto
 *    que compartió, su pedido, o el aviso de que WhatsApp no lo entregó. Va a
 *    `note`, separado a propósito: un flujo con la palabra «whatsapp» no debe
 *    saltar con nuestro aviso, ni una pregunta tomarlo por respuesta.
 *
 * Un mensaje sin medio y sin ninguna de las dos cosas no tendría nada que
 * mostrar, así que lo que no se reconoce siempre lleva una nota.
 *
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages
 */
export interface MetaContent {
  type: string;
  text?: { body: string };
  image?: { id?: string; caption?: string };
  document?: { id?: string; caption?: string; filename?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  video?: { id?: string; caption?: string; mime_type?: string };
  sticker?: { id?: string; mime_type?: string; animated?: boolean };
  // Respuesta a un botón de plantilla.
  button?: { text?: string; payload?: string };
  // Respuesta a un mensaje interactivo (botones, lista, formulario) o producto.
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
    /** Botón de respuesta de una tarjeta de carrusel (si Meta no lo manda como button_reply). */
    quick_reply?: { id?: string; title?: string; payload?: string };
    /** Respuesta a un formulario de WhatsApp (Flow). */
    nfm_reply?: { name?: string; body?: string; response_json?: string };
    product?: { retailer_id?: string; title?: string; price_amount?: number | string; currency?: string; url?: string };
  };
  location?: { latitude?: number | string; longitude?: number | string; name?: string; address?: string; url?: string };
  contacts?: MetaSharedContact[];
  order?: {
    catalog_id?: string;
    text?: string;
    product_items?: { product_retailer_id?: string; quantity?: number | string; item_price?: number | string; currency?: string }[];
  };
  /** Qué era lo que Meta no pudo entregar (edit, poll_update, group_invite…). */
  unsupported?: { type?: string };
  errors?: { code?: number; title?: string; message?: string }[];
}

interface MetaSharedContact {
  name?: { formatted_name?: string; first_name?: string; last_name?: string };
  phones?: { phone?: string; wa_id?: string; type?: string }[];
  emails?: { email?: string }[];
  org?: { company?: string };
}

export type MetaSender = "customer" | "business";

/** Lo que entregan los webhooks de historial por cada archivo: sin contenido. */
export const HISTORY_MEDIA_NOTE = "Archivo del historial: WhatsApp solo comparte los de las últimas dos semanas.";

const SEE_PHONE = "Míralo en la app de WhatsApp del celular.";
/** Meta: «This message is currently unavailable». Suele ser el primer mensaje a un número con coexistencia. */
const UNAVAILABLE_CODE = 131060;
const MAX_NOTE = 1500;
const MAX_FORM_FIELDS = 30;

const UNSUPPORTED_KIND: Record<string, string> = {
  edit: "El cliente editó un mensaje",
  poll_update: "El cliente respondió a una encuesta",
  reaction: "El cliente reaccionó a un mensaje",
  location: "El cliente envió una ubicación",
  order: "El cliente envió un pedido",
  group_invite: "El cliente envió una invitación a un grupo",
};

// El medio se ve aparte; sin él (historial, ecos), la bandeja pone su etiqueta.
const MEDIA_TYPES = new Set(["image", "video", "document", "audio", "sticker"]);
const TEXT_TYPES = new Set(["text", "button"]);

const logger = new Logger("WhatsApp");

const hasText = (s?: string | null): s is string => !!s?.trim();

export function readMetaMessage(m: MetaContent, sender: MetaSender = "customer"): { text?: string; note?: string } {
  const i = m.interactive;
  const written = [
    m.text?.body,
    m.button?.text,
    i?.button_reply?.title,
    i?.list_reply?.title,
    i?.quick_reply?.title,
    m.image?.caption,
    m.video?.caption,
    m.document?.caption,
  ].find(hasText);
  const note = noteFor(m, sender, !!written)?.slice(0, MAX_NOTE);
  return { ...(written ? { text: written } : {}), ...(note ? { note } : {}) };
}

function noteFor(m: MetaContent, sender: MetaSender, hasWritten: boolean): string | undefined {
  switch (m.type) {
    case "location":
      return m.location ? locationNote(m.location) : undefined;
    case "contacts":
      return contactsNote(m.contacts ?? []);
    case "order":
      return orderNote(m.order ?? {});
    case "unsupported":
      return unsupportedNote(m, sender);
    case "request_welcome":
      return "El cliente abrió el chat y aún no ha escrito.";
    case "media_placeholder":
      return HISTORY_MEDIA_NOTE;
    case "interactive":
      if (m.interactive?.nfm_reply) return formNote(m.interactive.nfm_reply.response_json);
      if (m.interactive?.product) return productNote(m.interactive.product);
      break;
    default:
      if (MEDIA_TYPES.has(m.type)) return undefined;
      // Para enterarnos de los tipos que aún no se leen (solo el tipo: nada del cliente).
      if (!hasWritten && !TEXT_TYPES.has(m.type)) logger.warn(`Tipo de mensaje de WhatsApp sin leer: ${m.type}`);
  }
  return hasWritten ? undefined : unreadableNote(sender);
}

function unreadableNote(sender: MetaSender): string {
  return sender === "customer"
    ? `El cliente envió un tipo de mensaje que WhatsApp no comparte con Driony (por ejemplo, una encuesta o una foto de ver una vez). ${SEE_PHONE}`
    : `Se envió desde el celular un tipo de mensaje que WhatsApp no comparte con Driony. ${SEE_PHONE}`;
}

function unsupportedNote(m: MetaContent, sender: MetaSender): string {
  if (m.errors?.some((e) => e.code === UNAVAILABLE_CODE)) {
    return `Este mensaje aún no está disponible aquí: WhatsApp a veces retiene el primer mensaje de un cliente. ${SEE_PHONE}`;
  }
  const kind = sender === "customer" ? UNSUPPORTED_KIND[m.unsupported?.type ?? ""] : undefined;
  return kind ? `${kind}, pero WhatsApp no lo comparte con Driony. ${SEE_PHONE}` : unreadableNote(sender);
}

function locationNote(l: NonNullable<MetaContent["location"]>): string {
  const place = [l.name, l.address].filter(hasText).join(", ");
  const lat = Number(l.latitude);
  const lng = Number(l.longitude);
  const hasCoords = l.latitude !== undefined && l.longitude !== undefined && Number.isFinite(lat) && Number.isFinite(lng);
  const map = hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : l.url;
  return [place ? `Ubicación: ${place}` : "Ubicación", map].filter(hasText).join("\n");
}

function contactsNote(contacts: MetaSharedContact[]): string {
  const people = contacts
    .map((c) => {
      const name = c.name?.formatted_name ?? [c.name?.first_name, c.name?.last_name].filter(hasText).join(" ");
      const phones = (c.phones ?? []).map((p) => p.phone ?? p.wa_id);
      const emails = (c.emails ?? []).map((e) => e.email);
      return [name, c.org?.company, ...phones, ...emails].filter(hasText).join(", ");
    })
    .filter(hasText);
  if (!people.length) return "Contacto compartido, sin datos legibles.";
  return people.length === 1 ? `Contacto compartido: ${people[0]}` : `Contactos compartidos:\n${people.join("\n")}`;
}

function orderNote(order: NonNullable<MetaContent["order"]>): string {
  const items = order.product_items ?? [];
  const money = (n: number) => String(Math.round(n * 100) / 100);
  const lines = items.map((it) => {
    const price = it.item_price !== undefined ? ` (${[it.currency, money(Number(it.item_price))].filter(Boolean).join(" ")})` : "";
    return `${it.quantity ?? 1} × ${it.product_retailer_id ?? "producto"}${price}`;
  });
  const currencies = new Set(items.map((it) => it.currency));
  const total = items.reduce((sum, it) => sum + Number(it.quantity ?? 1) * Number(it.item_price), 0);
  return [
    lines.length ? `Pedido del catálogo:\n${lines.join("\n")}` : "Pedido del catálogo.",
    items.length && currencies.size === 1 && Number.isFinite(total) ? `Total: ${[items[0]?.currency, money(total)].filter(Boolean).join(" ")}` : "",
    hasText(order.text) ? `Nota del cliente: ${order.text}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function productNote(p: NonNullable<NonNullable<MetaContent["interactive"]>["product"]>): string {
  const price = p.price_amount !== undefined ? ` (${[p.currency, p.price_amount].filter(Boolean).join(" ")})` : "";
  return [`Producto del catálogo: ${p.title ?? p.retailer_id ?? "sin nombre"}${price}`, p.url].filter(hasText).join("\n");
}

/** Respuestas de un formulario de WhatsApp: «screen_0_Nombre_0» → «Nombre». */
function formNote(responseJson?: string): string {
  const answers: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (key === "flow_token" || answers.length >= MAX_FORM_FIELDS) return;
    if (Array.isArray(value)) {
      if (value.length) answers.push(`${label(key)}: ${value.map(String).join(", ")}`);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    } else if (value !== null && value !== undefined && String(value).trim()) {
      answers.push(`${label(key)}: ${String(value)}`);
    }
  };
  const label = (key: string) =>
    key.replace(/^screen_\d+_/, "").replace(/_\d+$/, "").replace(/_/g, " ").trim() || key;
  try {
    walk(JSON.parse(responseJson ?? "null"), "");
  } catch {
    // Un JSON roto no impide avisar de que llegó.
  }
  return answers.length ? `Formulario enviado:\n${answers.join("\n")}` : "Formulario enviado.";
}
