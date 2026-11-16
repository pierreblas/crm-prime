import type { CSSProperties } from "react";

// Estilos de las pantallas de acceso (entrar, olvidé mi contraseña, contraseña nueva).

export const authMain: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minHeight: "100vh",
  padding: 24,
};

export const authCard: CSSProperties = {
  width: 360,
  maxWidth: "100%",
  padding: 28,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
};

export const authLabel: CSSProperties = {
  fontSize: 13,
  color: "var(--muted)",
  marginTop: 14,
  marginBottom: 6,
};

export const authInput: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
};

export const authBtn: CSSProperties = {
  marginTop: 22,
  padding: "11px 14px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

export const authFoot: CSSProperties = {
  color: "var(--muted)",
  fontSize: 13,
  marginTop: 18,
  textAlign: "center",
};

export const authText: CSSProperties = {
  color: "var(--muted)",
  marginTop: -4,
  lineHeight: 1.5,
};

export const authLink: CSSProperties = { color: "var(--accent-text)" };
