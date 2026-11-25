import type { ChannelKind } from "./schemas/messaging.schema.js";

/** Por dónde llegó el cliente de un chat: un canal, un anuncio o un formulario de Meta. */
export type ChatOrigin = ChannelKind | "ad" | "form";

interface ChatOriginInput {
  channel?: { kind: ChannelKind } | null;
  /** El anuncio click-to-WhatsApp de este chat, si vino de uno. */
  ad?: unknown;
  contact: {
    /** Nombre del formulario de Meta que llenó. */
    form?: string | null;
    source?: { kind?: string | null } | null;
  };
}

/**
 * El símbolo que lleva un chat en la bandeja. Messenger, Instagram y TikTok
 * mandan: es por donde se le responde. En WhatsApp se afina: si el chat viene
 * de un anuncio, anuncio; si el cliente llenó un formulario, formulario.
 */
export function chatOrigin(c: ChatOriginInput): ChatOrigin {
  const channel = c.channel?.kind ?? "whatsapp";
  if (channel !== "whatsapp") return channel;
  const source = c.contact.source?.kind ?? null;
  if (c.ad) return "ad";
  if (c.contact.form?.trim() || source === "form") return "form";
  if (source === "ad") return "ad";
  return "whatsapp";
}
