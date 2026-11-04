"use client";

import { NavIcon } from "@/components/NavIcons";
import { useLocale, useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";

/**
 * Piezas pequeñas del hilo: estado de entrega, separador de día, esqueleto de
 * carga y la burbuja de "la IA está escribiendo".
 *
 * Todas siguen la Regla del Estado Doble del sistema: ningún estado se
 * comunica solo con color; siempre hay icono o palabra además del tono.
 */

// ── Estado de entrega ────────────────────────────────────────
// Un tick = enviado, dos = entregado, dos en azul = leído. Es la convención
// que el vendedor ya conoce de WhatsApp; antes esto decía "sent"/"delivered"
// en minúsculas, que no se lee de un vistazo.
const STATUS_KEY: Record<string, MessageKey> = {
  QUEUED: "inbox.deliveryQueued",
  SENT: "inbox.deliverySent",
  DELIVERED: "inbox.deliveryDelivered",
  READ: "inbox.deliveryRead",
  FAILED: "inbox.deliveryFailed",
};

export function MessageStatus({
  status,
  author,
}: {
  status: string;
  author: string;
}) {
  const t = useT();
  const key = STATUS_KEY[status];
  const label = key ? t(key) : status.toLowerCase();

  return (
    <span style={row} title={label}>
      {author === "AI" && (
        <span style={aiMark}>
          <NavIcon name="sparkles" size={11} />
          IA
        </span>
      )}
      {status === "FAILED" ? (
        <span style={{ ...mark, color: "var(--danger)" }}>
          <NavIcon name="alert" size={12} />
          {label}
        </span>
      ) : status === "QUEUED" ? (
        <span style={{ ...mark, color: "var(--muted)" }}>
          <NavIcon name="clock" size={12} />
        </span>
      ) : (
        <span
          style={{
            ...mark,
            // El azul de "leído" es el único momento en que el estado cambia
            // de color; entregado y enviado comparten el gris apagado.
            color: status === "READ" ? "var(--accent)" : "var(--muted)",
          }}
        >
          <NavIcon
            name={status === "SENT" ? "check" : "check-double"}
            size={13}
          />
        </span>
      )}
    </span>
  );
}

// ── Separador de día ─────────────────────────────────────────
export function DaySeparator({ date }: { date: Date }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div style={dayWrap}>
      <span style={dayPill}>{dayLabel(date, locale, t)}</span>
    </div>
  );
}

function dayLabel(
  date: Date,
  locale: string,
  t: (key: MessageKey) => string,
): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return t("inbox.today");
  if (same(date, yesterday)) return t("inbox.yesterday");

  // Dentro del año en curso no hace falta repetir el año.
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** true si `a` cae en un día distinto que `b` (o `b` no existe). */
export function isNewDay(a: string, b: string | undefined): boolean {
  if (!b) return true;
  return new Date(a).toDateString() !== new Date(b).toDateString();
}

// ── Carga ────────────────────────────────────────────────────
// Esqueleto en vez de spinner: el hilo aparece con su forma, así el salto al
// contenido real no reorganiza la pantalla.
export function MessagesSkeleton() {
  const rows = [
    { out: false, w: 190 },
    { out: true, w: 140 },
    { out: false, w: 240 },
    { out: true, w: 200 },
    { out: false, w: 120 },
  ];
  return (
    <div
      aria-hidden
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}
    >
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            alignSelf: r.out ? "flex-end" : "flex-start",
            width: r.w,
            height: 38,
            borderRadius: 12,
            background: r.out ? "var(--bubble-out)" : "var(--surface-2)",
            opacity: 0.45,
            animation: "chatPulse 1.4s ease-in-out infinite",
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </div>
  );
}

// ── "La IA está escribiendo" ─────────────────────────────────
// El cliente ve "escribiendo…" en su WhatsApp; esto es su equivalente dentro
// del CRM, para que el agente humano sepa que el bot va a contestar y no
// escriba encima.
export function AiTypingBubble() {
  const t = useT();
  return (
    <div style={typingRow}>
      <div style={typingBubble}>
        <NavIcon name="sparkles" size={13} />
        <span style={{ fontSize: 12.5 }}>{t("inbox.aiTyping")}</span>
        <span style={dots}>
          <i style={{ ...dot, animationDelay: "0ms" }} />
          <i style={{ ...dot, animationDelay: "160ms" }} />
          <i style={{ ...dot, animationDelay: "320ms" }} />
        </span>
      </div>
    </div>
  );
}

const row: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const mark: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 11,
};

const aiMark: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 10.5,
  fontWeight: 600,
  color: "var(--positive)",
  letterSpacing: "0.02em",
};

const dayWrap: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  margin: "10px 0 6px",
};

const dayPill: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--muted)",
  background: "rgba(154, 185, 194, 0.05)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "3px 12px",
  textTransform: "capitalize",
};

// A la derecha, como las respuestas del negocio: la IA contesta por él.
const typingRow: React.CSSProperties = {
  alignSelf: "flex-end",
  maxWidth: "78%",
};

const typingBubble: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderRadius: "10px 10px 2px 10px",
  background: "var(--surface-2)",
  color: "var(--muted)",
};

const dots: React.CSSProperties = {
  display: "inline-flex",
  gap: 3,
  alignItems: "center",
};

const dot: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: "currentColor",
  display: "inline-block",
  animation: "chatDot 1.2s ease-in-out infinite",
};
