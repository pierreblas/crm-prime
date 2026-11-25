"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, type Locale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/I18nProvider";

/**
 * Selector de idioma. Guarda la elección en una cookie y recarga los datos del
 * servidor: así la siguiente pantalla ya llega traducida, sin recargar la
 * página entera.
 */
export function LanguageSwitcher() {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  const [pending, startTransition] = useTransition();

  function change(next: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <select
      value={locale}
      onChange={(e) => change(e.target.value as Locale)}
      disabled={pending}
      title={t("nav.language")}
      aria-label={t("nav.language")}
      style={select}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_NAMES[l]}
        </option>
      ))}
    </select>
  );
}

const select: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: "var(--r-sm)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 12.5,
  cursor: "pointer",
};
