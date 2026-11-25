import { SOURCE_KIND_LABEL, type DashboardDto, type SourceKind } from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { ChannelMark } from "@/features/inbox/ChannelMark";
import { readableInk } from "@/lib/readable-ink";

type Source = DashboardDto["sources"][number];

// Los canales que ya tienen su marca dibujada en la bandeja.
const CHANNEL: Partial<Record<SourceKind, "messenger" | "instagram" | "tiktok">> = {
  messenger: "messenger",
  instagram: "instagram",
  tiktok: "tiktok",
};
const ICON: Partial<Record<SourceKind, IconName>> = { whatsapp: "whatsapp", ad: "megaphone", form: "template" };

const isKind = (k: string | null): k is SourceKind => k !== null && k in SOURCE_KIND_LABEL;
const isColor = (c: string | null): c is string => !!c && /^#[0-9a-fA-F]{3,8}$/.test(c);

/**
 * El símbolo de una fuente: la marca del canal si es automática, una etiqueta con el
 * color que eligió la empresa si la creó ella, y una raya si el contacto no tiene fuente.
 * Es un adorno: el nombre va escrito al lado.
 */
export function SourceMark({ source, size = 13 }: { source: Source; size?: number }) {
  const kind = isKind(source.kind) ? source.kind : null;
  const own = !kind && source.id !== null;
  const tint = own && isColor(source.color) ? source.color : null;
  const title = kind ? SOURCE_KIND_LABEL[kind] : own ? "Fuente creada por tu empresa" : "Contactos sin fuente";
  const channel = kind ? CHANNEL[kind] : undefined;
  return (
    <span
      className={`src-mark${source.id === null ? " is-none" : ""}`}
      style={tint ? { background: tint, color: readableInk(tint) } : undefined}
      title={title}
      aria-hidden="true"
    >
      {channel ? <ChannelMark kind={channel} size={size} /> : <NavIcon name={kind ? (ICON[kind] ?? "tag") : own ? "tag" : "minus"} size={size} />}
    </span>
  );
}
