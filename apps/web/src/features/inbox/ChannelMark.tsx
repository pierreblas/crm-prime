import type { ChannelKind } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";

/**
 * La marca de cada canal en una fila o una ficha: el teléfono para WhatsApp,
 * el bocadillo con rayo para Messenger, la cámara para Instagram y la nota
 * para TikTok. Pequeña y monocroma, hereda el color del texto donde se pinta.
 */
export function ChannelMark({ kind, size = 10 }: { kind: ChannelKind; size?: number }) {
  if (kind === "messenger") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.4 5.5 3.7 7.2V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.5 0 10-4.1 10-9.2S17.5 2 12 2zm1 12.4l-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8z" />
      </svg>
    );
  }
  if (kind === "instagram") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "tiktok") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M16.6 5.8A4.8 4.8 0 0 1 15.4 3h-3.3v13.1a2.8 2.8 0 1 1-2.8-2.8c.3 0 .6 0 .9.1V10a6.1 6.1 0 1 0 5.2 6V9.6a8 8 0 0 0 4.6 1.5V7.8a4.8 4.8 0 0 1-3.4-2z" />
      </svg>
    );
  }
  return <NavIcon name="phone" size={size} />;
}
