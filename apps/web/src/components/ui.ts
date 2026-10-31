import type { CSSProperties } from "react";

/**
 * Estilos canónicos de los controles, para los componentes que aún van con
 * estilo inline. Son los mismos valores que las clases `.btn`, `.field` y
 * `.label` de globals.css, que es lo que debe usar el código nuevo; esto
 * existe para que un archivo pueda dejar de definir su propio `primaryBtn`
 * cambiando una línea de import, y todos los botones queden iguales.
 *
 * Los estados (hover, active, foco, flecha del select) los pone globals.css:
 * aquí solo va el reposo.
 */

export const primaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid transparent",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontSize: 13.5,
  fontWeight: 600,
  lineHeight: 1.2,
  cursor: "pointer",
  whiteSpace: "nowrap",
  boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
};

export const ghostBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  fontSize: 13.5,
  fontWeight: 500,
  lineHeight: 1.2,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const dangerBtn: CSSProperties = {
  ...ghostBtn,
  color: "var(--danger)",
  border: "1px solid #5a2a2a",
};

/** Botón de acento suave: para acciones secundarias que aun así destacan. */
export const softBtn: CSSProperties = {
  ...ghostBtn,
  background: "var(--accent-soft)",
  color: "var(--accent-text)",
  border: "1px solid rgba(200,255,0,0.24)",
};

/** Versión compacta de cualquiera de los anteriores: `{ ...ghostBtn, ...smBtn }`. */
export const smBtn: CSSProperties = {
  padding: "6px 11px",
  fontSize: 12.5,
  borderRadius: 7,
};

export const input: CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

/** Campo compacto (barras de herramientas, filtros). */
export const inputSm: CSSProperties = {
  ...input,
  padding: "7px 10px",
  fontSize: 13,
  borderRadius: 7,
};

export const label: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  color: "var(--muted)",
  marginBottom: 5,
};

export const card: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 18,
  boxShadow: "var(--shadow-card)",
};
