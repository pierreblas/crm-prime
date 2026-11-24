import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { PasswordResetCheck } from "@crm/shared";
import { isPlatformHost } from "@/lib/org";
import { getLocale, getTranslator } from "@/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeButton } from "@/components/ThemeSwitcher";
import { authBtn, authCard, authFoot, authInput, authLabel, authLink, authMain, authText } from "../styles";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

// El enlace lleva el token en la dirección: que no viaje a ningún otro sitio.
export const metadata: Metadata = { referrer: "no-referrer" };

const ERRORS = { short: "auth.resetTooShort", mismatch: "auth.resetMismatch", failed: "auth.resetFailed" } as const;

/**
 * El enlace para elegir contraseña nueva (por correo, del administrador o del
 * operador). Primero comprueba que sirve y dice de quién es; al guardar, la
 * API gasta el enlace y cierra todas las sesiones de esa persona, y se vuelve
 * al acceso a entrar con la nueva.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  if (await isPlatformHost()) redirect("/login");
  const t = await getTranslator();
  const { token = "", error } = await searchParams;

  const check = token
    ? ((await fetch(`${API_URL}/api/v1/auth/password/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // En el cuerpo, no en la URL: así no queda en los registros del proxy.
        body: JSON.stringify({ token }),
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as PasswordResetCheck | null)
    : null;

  async function save(formData: FormData) {
    "use server";
    const tk = String(formData.get("token") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    const back = (code: keyof typeof ERRORS | "gone"): never =>
      redirect(`/login/reset?${new URLSearchParams({ token: tk, error: code }).toString()}`);
    if (password.length < 8) back("short");
    if (password !== confirm) back("mismatch");
    const res = await fetch(`${API_URL}/api/v1/auth/password/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tk, password, locale: await getLocale() }),
      cache: "no-store",
    }).catch(() => null);
    if (!res) back("failed");
    else if (!res.ok) back(res.status === 410 ? "gone" : "failed");
    redirect("/login?reset=1");
  }

  const frame = (children: React.ReactNode) => (
    <main style={authMain}>
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ThemeButton />
          <LanguageSwitcher />
        </span>
      </div>
      <div style={authCard}>
        {children}
        <p style={authFoot}>
          <Link href="/login" style={authLink}>
            {t("auth.backToLogin")}
          </Link>
        </p>
      </div>
    </main>
  );

  if (!check) {
    return frame(
      <div data-reset-gone>
        <h1 style={{ marginTop: 0 }}>{t("auth.resetGoneTitle")}</h1>
        <p style={authText}>{t("auth.resetGone")}</p>
        <Link href="/login/forgot" style={{ ...authBtn, textAlign: "center", textDecoration: "none" }}>
          {t("auth.resetAskAgain")}
        </Link>
      </div>,
    );
  }

  const errorKey = error && error in ERRORS ? ERRORS[error as keyof typeof ERRORS] : null;

  return frame(
    <form action={save} style={{ display: "flex", flexDirection: "column" }} data-reset-form>
      <h1 style={{ marginTop: 0 }}>{t("auth.resetTitle")}</h1>
      <p style={authText}>{t("auth.resetFor", { email: check.email, org: check.orgName })}</p>
      {errorKey && (
        <p role="alert" style={{ color: "var(--danger)", margin: "4px 0 0" }} data-reset-error>
          {t(errorKey)}
        </p>
      )}
      <input type="hidden" name="token" value={token} />
      {/* Para que el gestor de contraseñas sepa de qué cuenta es. */}
      <input type="text" name="username" autoComplete="username" value={check.email} readOnly hidden />
      <label style={authLabel} htmlFor="password">
        {t("auth.newPassword")}
      </label>
      <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" style={authInput} />
      <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("auth.newPasswordHint")}</span>
      <label style={authLabel} htmlFor="confirm">
        {t("auth.confirmPassword")}
      </label>
      <input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" style={authInput} />
      <button type="submit" style={authBtn}>
        {t("auth.resetSave")}
      </button>
    </form>,
  );
}
