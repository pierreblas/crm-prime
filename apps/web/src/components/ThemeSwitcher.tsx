"use client";

import { useEffect, useState } from "react";
import { nextTheme, THEME_COOKIE, THEMES, themeFrom, type ThemePref } from "@/lib/theme";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";

/** El cambio se ve en todas las copias del selector (cabecera, menú, pie) a la vez. */
const CHANGED = "driony:theme";

function apply(pref: ThemePref): void {
  const root = document.documentElement;
  root.dataset.themePref = pref;
  root.dataset.theme = pref === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
}

function useThemePref(): [ThemePref, (next: ThemePref) => void] {
  // El servidor pinta lo mismo para todos; al montar se lee lo elegido.
  const [pref, setPref] = useState<ThemePref>("dark");
  useEffect(() => {
    const read = () => setPref(themeFrom(document.documentElement.dataset.themePref));
    read();
    const system = matchMedia("(prefers-color-scheme: light)");
    const onSystem = () => {
      if (document.documentElement.dataset.themePref === "auto") apply("auto");
    };
    window.addEventListener(CHANGED, read);
    system.addEventListener("change", onSystem);
    return () => {
      window.removeEventListener(CHANGED, read);
      system.removeEventListener("change", onSystem);
    };
  }, []);
  return [
    pref,
    (next) => {
      document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      apply(next);
      window.dispatchEvent(new Event(CHANGED));
    },
  ];
}

const ICON: Record<ThemePref, React.ReactNode> = {
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  auto: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" />
    </>
  ),
};

function Icon({ pref }: { pref: ThemePref }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[pref]}
    </svg>
  );
}

/** El tema que se está viendo, para lo que no se pinta con CSS (el lienzo de los flujos). */
export function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    read();
    const seen = new MutationObserver(read);
    seen.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => seen.disconnect();
  }, []);
  return theme;
}

/** Los tres a la vista: menús y páginas públicas. */
export function ThemeSwitcher() {
  const t = useT();
  const [pref, setPref] = useThemePref();
  return (
    <div className="theme-seg" role="group" aria-label={t("theme.label")} data-theme-switcher>
      {THEMES.map((p) => (
        <button key={p} type="button" aria-pressed={pref === p} onClick={() => setPref(p)} title={t(`theme.${p}` as MessageKey)} aria-label={t(`theme.${p}` as MessageKey)} data-theme-option={p}>
          <Icon pref={p} />
        </button>
      ))}
    </div>
  );
}

/** Un solo botón que va pasando por los tres: para la cabecera, donde no sobra sitio. */
export function ThemeButton({ className = "icon-btn" }: { className?: string }) {
  const t = useT();
  const [pref, setPref] = useThemePref();
  const next = nextTheme(pref);
  const label = `${t("theme.label")}: ${t(`theme.${pref}` as MessageKey)}. ${t("theme.next", { theme: t(`theme.${next}` as MessageKey) })}`;
  return (
    <button type="button" className={className} onClick={() => setPref(next)} title={label} aria-label={label} data-theme-button={pref}>
      <Icon pref={pref} />
    </button>
  );
}
