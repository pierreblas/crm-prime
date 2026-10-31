import type { CSSProperties } from "react";

// Estilos compartidos por los diálogos del inbox (plantilla y botones).

export const dialogInput: CSSProperties = {
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

export const dialogLabel: CSSProperties = {
  fontSize: 12.5,
  color: "var(--muted)",
  marginBottom: 4,
};

export const primaryBtn: CSSProperties = {
  padding: "9px 16px",
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
