// El tema (claro u oscuro). Se guarda en una cookie, como el idioma: el servidor
// lo sabe antes de pintar y la página no parpadea. Sin elegir, oscuro: es la
// cara de Driony. «Automático» sigue al sistema y lo resuelve el navegador.

export const THEMES = ["light", "dark", "auto"] as const;
export type ThemePref = (typeof THEMES)[number];
export const THEME_COOKIE = "driony_theme";
export const DEFAULT_THEME: ThemePref = "dark";

/** El orden del botón: desde oscuro, primero claro. Si fuera automático, con el sistema en oscuro parecería que no hace nada. */
export function nextTheme(pref: ThemePref): ThemePref {
  return pref === "dark" ? "light" : pref === "light" ? "auto" : "dark";
}

export function themeFrom(value: unknown): ThemePref {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value) ? (value as ThemePref) : DEFAULT_THEME;
}

/** El tema con el que pinta el servidor: en automático (y en las páginas estáticas) lo corrige el guion de abajo. */
export function serverTheme(pref: ThemePref): "light" | "dark" {
  return pref === "light" ? "light" : "dark";
}

/**
 * Antes de pintar: pone el tema elegido. Hace falta en automático (el servidor
 * no conoce el del sistema) y en las páginas estáticas, como la ayuda, que no
 * leen la cookie. Va en línea en el `<head>` para que no se vea un instante el otro.
 */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,m=/(?:^|; )${THEME_COOKIE}=(light|dark|auto)/.exec(document.cookie),p=m?m[1]:d.dataset.themePref||"${DEFAULT_THEME}";d.dataset.themePref=p;d.dataset.theme=p==="auto"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p}catch(e){}})()`;
