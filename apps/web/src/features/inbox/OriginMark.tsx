import { CHANNEL_KIND_LABEL, type ChatOrigin } from "@crm/shared";
import type { Translator } from "@/i18n/translate";
import { NavIcon } from "@/components/NavIcons";
import { ChannelMark } from "./ChannelMark";

/** La marca de WhatsApp, la misma de la demo de la portada. */
function WhatsappGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 1 1-4.2 15.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8z" />
      <path d="M8.9 7.4c-.2-.4-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.9 4.5 4 2.2.9 2.7.7 3.2.7.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-1.9-.9c-.3-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.6.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.1 0-.3 0-.4l-.9-2.3z" />
    </svg>
  );
}

/** «Llegó por WhatsApp», «por un anuncio», «por el formulario "Curso Power BI"». */
export function originLabel(origin: ChatOrigin, form: string | null, t: Translator): string {
  if (origin === "form") return form ? t("inbox.cameByFormNamed", { name: form }) : t("inbox.cameByForm");
  if (origin === "ad") return t("inbox.cameByAd");
  return t("inbox.cameByChannel", { channel: CHANNEL_KIND_LABEL[origin] });
}

/** El símbolo de por dónde llegó el cliente: su canal, un anuncio o un formulario de Meta. */
export function OriginMark({ origin, size = 11 }: { origin: ChatOrigin; size?: number }) {
  if (origin === "whatsapp") return <WhatsappGlyph size={size} />;
  if (origin === "ad") return <NavIcon name="megaphone" size={size} />;
  if (origin === "form") return <NavIcon name="template" size={size} />;
  return <ChannelMark kind={origin} size={size} />;
}

/** El símbolo en su círculo, para montarlo sobre la esquina del avatar. Lleva el color del canal (CSS). */
export function OriginBadge({ origin, label }: { origin: ChatOrigin; label: string }) {
  return (
    <span className={`origin-badge is-${origin}`} role="img" aria-label={label} title={label} data-origin-mark={origin}>
      <OriginMark origin={origin} />
    </span>
  );
}
