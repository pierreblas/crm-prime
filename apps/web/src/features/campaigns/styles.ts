import type { CSSProperties } from "react";

export const box: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 18,
  boxShadow: "var(--shadow-card)",
};

export const input: CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

export const label: CSSProperties = { fontSize: 13, color: "var(--muted)", marginBottom: 4 };

export const primaryBtn: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

export const ghostBtn: CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};

export function badge(bg: string): CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 9px",
    borderRadius: 999,
    background: bg,
    color: "#e9f1ff",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  };
}

export const STATUS_COLOR: Record<string, string> = {
  DRAFT: "var(--surface-3)",
  SCHEDULED: "#caa14a",
  RUNNING: "#2c6fb0",
  COMPLETED: "#1f6f46",
  CANCELLED: "#7a3a3a",
};
