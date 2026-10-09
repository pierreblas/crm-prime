"use client";

import { MessageDirection, MessageType, type ConversationDto } from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";
import type { Translator } from "@/i18n/translate";

/** Iniciales del contacto: dos palabras si las hay, si no los últimos dígitos. */
function initials(name: string | null, phone: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return phone.replace(/\D/g, "").slice(-2);
}

export function timeAgo(iso: string | null, t: Translator): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("inbox.timeNow");
  if (m < 60) return t("inbox.timeMinutes", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("inbox.timeHours", { n: h });
  return t("inbox.timeDays", { n: Math.floor(h / 24) });
}

/** Vista previa del último mensaje: el contenido, o un icono con el tipo de archivo. */
export interface Preview {
  icon: IconName | null;
  text: string;
}

export function previewOf(c: ConversationDto, t: Translator): Preview {
  const m = c.lastMessage;
  if (!m) return { icon: null, text: "" };
  const mine = m.direction === MessageDirection.OUTBOUND;
  let icon: IconName | null = null;
  let body: string;
  switch (m.type) {
    case MessageType.TEXT:
      body = (m.text ?? "").replace(/\s+/g, " ").trim();
      break;
    case MessageType.IMAGE:
      icon = "image";
      body = t("inbox.previewImage");
      break;
    case MessageType.VIDEO:
      icon = "video";
      body = t("inbox.previewVideo");
      break;
    case MessageType.AUDIO:
      icon = "mic";
      body = t("inbox.previewAudio");
      break;
    case MessageType.DOCUMENT:
      icon = "paperclip";
      body = m.text?.trim() || t("inbox.previewDocument");
      break;
    case MessageType.LOCATION:
      icon = "map-pin";
      body = t("inbox.previewLocation");
      break;
    default:
      body = m.text?.trim() || t("inbox.previewOther");
  }
  return { icon, text: mine ? `${t("inbox.you")}: ${body}` : body };
}

/** Cuánto lleva esperando el contacto (solo si la conversación está sin responder). */
function waitingSince(c: ConversationDto): number | null {
  if (!c.awaitingReply || !c.lastMessageAt) return null;
  return Date.now() - new Date(c.lastMessageAt).getTime();
}

function waitingLabel(ms: number, t: Translator): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return t("inbox.timeMinutes", { n: Math.max(1, m) });
  const h = Math.floor(m / 60);
  if (h < 24) return t("inbox.timeHours", { n: h });
  return t("inbox.timeDays", { n: Math.floor(h / 24) });
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  emptyMessage,
}: {
  conversations: ConversationDto[];
  selectedId: string | null;
  onSelect: (c: ConversationDto) => void;
  emptyMessage?: string;
}) {
  const t = useT();

  if (conversations.length === 0) {
    return (
      <p style={{ color: "var(--muted)", padding: 16, fontSize: 14 }}>
        {emptyMessage ?? t("inbox.noConversations")}
      </p>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }} role="list">
      {conversations.map((c) => {
        const active = c.id === selectedId;
        const unread = c.unreadCount ?? 0;
        const waiting = waitingSince(c);
        // Más de una hora sin respuesta: el contador pasa a color de aviso.
        const urgent = waiting !== null && waiting > 60 * 60_000;
        const preview = previewOf(c, t);
        return (
          <li
            key={c.id}
            onClick={() => onSelect(c)}
            className={`conv-item${active ? " is-active" : ""}`}
            data-conversation-id={c.id}
            style={row}
          >
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={avatar}>{initials(c.contact.name, c.contact.phone)}</div>
              {c.aiMode === "AUTOPILOT" && (
                <span style={autoDot} title={t("inbox.modeAuto")}>
                  <NavIcon name="bot" size={9} />
                </span>
              )}
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={topRow}>
                <span style={{ ...ellipsis, fontWeight: unread > 0 ? 700 : 600, fontSize: 14 }}>
                  {c.contact.name ?? c.contact.phone}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {waiting !== null ? (
                    <span
                      style={{ ...waitChip, ...(urgent ? waitChipUrgent : {}) }}
                      title={t("inbox.waitingFor", { time: waitingLabel(waiting, t) })}
                    >
                      <NavIcon name="hourglass" size={10} />
                      {waitingLabel(waiting, t)}
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)", fontSize: 11.5 }}>
                      {timeAgo(c.lastMessageAt, t)}
                    </span>
                  )}
                </span>
              </div>

              <div style={previewRow}>
                <span
                  style={{
                    ...ellipsis,
                    flex: 1,
                    fontSize: 13,
                    color: unread > 0 ? "var(--text)" : "var(--muted)",
                  }}
                >
                  {preview.icon && (
                    <span style={previewIcon}>
                      <NavIcon name={preview.icon} size={12} />
                    </span>
                  )}
                  {preview.text || c.contact.phone}
                </span>
                {unread > 0 && (
                  <span style={unreadBadge} aria-label={t("inbox.unreadCount", { n: unread })}>
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </div>

              <div style={metaRow}>
                {c.handoffAt ? (
                  <span style={{ ...metaChip, color: "var(--warning)" }} title={c.handoffReason ?? undefined} data-handoff>
                    <NavIcon name="bot" size={10} />
                    {t("inbox.handoffBadge")}
                  </span>
                ) : (
                  c.status !== "OPEN" && (
                    <span style={{ ...metaChip, color: c.status === "CLOSED" ? "var(--muted)" : "var(--warning)" }}>
                      {c.status === "PENDING" ? t("inbox.statusPending") : t("inbox.statusClosed")}
                    </span>
                  )
                )}
                {c.assignedAgent ? (
                  <span style={metaChip}>
                    <NavIcon name="user" size={10} />
                    {c.assignedAgent.name ?? "—"}
                  </span>
                ) : (
                  <span style={{ ...metaChip, color: "#c9a25a" }}>
                    <NavIcon name="user" size={10} />
                    {t("inbox.unassigned")}
                  </span>
                )}
                {c.channel && (
                  <span style={metaChip} title={c.channel.displayPhoneNumber ?? undefined}>
                    <NavIcon name="phone" size={10} />
                    {c.channel.label ?? c.channel.displayPhoneNumber}
                  </span>
                )}
                {c.contact.tags.slice(0, 3).map((tag) => (
                  <span key={tag.name} style={tagChip(tag.color)}>
                    {tag.name}
                  </span>
                ))}
                {c.contact.tags.length > 3 && (
                  <span style={metaChip}>+{c.contact.tags.length - 3}</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ConversationListSkeleton() {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {Array.from({ length: 7 }).map((_, i) => (
        <li key={i} style={{ ...row, alignItems: "center" }}>
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="skeleton" style={{ height: 12, width: "55%" }} />
            <div className="skeleton" style={{ height: 10, width: "75%", opacity: 0.7 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Estilos ───────────────────────────────────────────────────

const row: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  padding: "11px 14px 11px 16px",
  cursor: "pointer",
  borderBottom: "1px solid var(--border)",
};

const topRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

const previewRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 2,
};

// Icono del tipo de archivo, alineado con el texto recortado de la vista previa.
const previewIcon: React.CSSProperties = {
  display: "inline-flex",
  verticalAlign: "-2px",
  marginRight: 5,
};

const metaRow: React.CSSProperties = {
  display: "flex",
  gap: 5,
  marginTop: 6,
  flexWrap: "wrap",
  alignItems: "center",
};

const metaChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 10.5,
  padding: "1px 7px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  color: "var(--muted)",
  whiteSpace: "nowrap",
  maxWidth: 140,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function tagChip(color: string | null): React.CSSProperties {
  const bg =
    color && /^#?[0-9a-fA-F]{3,8}$/.test(color)
      ? color.startsWith("#")
        ? color
        : `#${color}`
      : "#2c4b7a";
  return {
    ...metaChip,
    border: "1px solid transparent",
    background: bg,
    color: "#eaf2ff",
    fontWeight: 600,
  };
}

const unreadBadge: React.CSSProperties = {
  minWidth: 20,
  height: 20,
  padding: "0 6px",
  borderRadius: 999,
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontSize: 11.5,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const waitChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 11,
  fontWeight: 600,
  padding: "1px 7px",
  borderRadius: 999,
  background: "var(--warning-soft)",
  color: "var(--warning)",
  whiteSpace: "nowrap",
};

const waitChipUrgent: React.CSSProperties = {
  background: "var(--danger-soft)",
  color: "var(--danger)",
};

const avatar: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  background: "var(--accent-soft)",
  color: "#dbe7ff",
  display: "grid",
  placeItems: "center",
  fontSize: 14,
  fontWeight: 600,
  flexShrink: 0,
};

const autoDot: React.CSSProperties = {
  position: "absolute",
  right: -3,
  bottom: -3,
  width: 17,
  height: 17,
  borderRadius: "50%",
  background: "var(--accent)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  border: "2px solid var(--bg)",
};

const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
