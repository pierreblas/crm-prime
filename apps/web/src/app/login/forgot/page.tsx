import Link from "next/link";
import { redirect } from "next/navigation";
import { PASSWORD_RESET_EMAIL_MINUTES, type PasswordResetOptions } from "@crm/shared";
import { currentOrgContext, currentOrgSlug, isPlatformHost } from "@/lib/org";
import { getLocale, getTranslator } from "@/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeButton } from "@/components/ThemeSwitcher";
import { authBtn, authCard, authFoot, authInput, authLabel, authLink, authMain, authText } from "../styles";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

/**
 * «¿Olvidaste tu contraseña?», en el acceso de cada empresa.
 *
 * Con correo del sistema en el servidor, pide el correo y manda el enlace; la
 * respuesta es la misma exista o no la cuenta. Sin correo, dice el camino que
 * sí funciona: pedirle el enlace a quien administra la empresa.
 */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  // La consola del operador tiene su propia cuenta, que no se recupera aquí.
  if (await isPlatformHost()) redirect("/login");
  const t = await getTranslator();
  const { sent } = await searchParams;
  const ctx = await currentOrgContext();
  if (ctx.kind === "unknown") redirect("/login");
  const esSaaS = !!process.env.SAAS_BASE_DOMAIN;
  const org = ctx.kind === "found" ? ctx.org : null;
  const orgName = org?.name ?? t("auth.signInTitle");
  // El administrador que olvidó la suya no tiene a quién pedírsela: a Driony,
  // que genera el enlace desde la consola. Solo si hay correo de contacto.
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

  async function send(formData: FormData) {
    "use server";
    // La empresa sale del subdominio (servidor), no de un campo del formulario.
    const orgSlug = await currentOrgSlug();
    const email = String(formData.get("email") ?? "").trim();
    await fetch(`${API_URL}/api/v1/auth/password/forgot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, ...(orgSlug ? { orgSlug } : {}), locale: await getLocale() }),
      cache: "no-store",
    }).catch(() => null);
    // Siempre lo mismo: la pantalla no dice si la cuenta existe.
    redirect("/login/forgot?sent=1");
  }

  const frame = (children: React.ReactNode) => (
    <main style={authMain}>
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ThemeButton />
          <LanguageSwitcher />
        </span>
      </div>
      <div style={authCard} data-forgot>
        {children}
        <p style={authFoot}>
          <Link href="/login" style={authLink}>
            {t("auth.backToLogin")}
          </Link>
        </p>
      </div>
    </main>
  );

  // Dominio raíz en la nube: primero hay que saber de qué empresa eres.
  if (esSaaS && !org) {
    return frame(
      <>
        <h1 style={{ marginTop: 0 }}>{t("auth.forgotTitle")}</h1>
        <p style={authText}>{t("auth.forgotChooseCompany")}</p>
      </>,
    );
  }

  if (sent) {
    return frame(
      <div data-forgot-sent>
        <h1 style={{ marginTop: 0 }}>{t("auth.forgotSentTitle")}</h1>
        <p style={authText}>{t("auth.forgotSentBody", { org: orgName, minutes: PASSWORD_RESET_EMAIL_MINUTES })}</p>
        <p style={{ ...authText, fontSize: 13 }}>{t("auth.forgotSentHelp", { org: orgName })}</p>
      </div>,
    );
  }

  const options = (await fetch(`${API_URL}/api/v1/auth/password/options`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { email: false }))
    .catch(() => ({ email: false }))) as PasswordResetOptions;

  if (!options.email) {
    return frame(
      <div data-forgot-no-email>
        <h1 style={{ marginTop: 0 }}>{t("auth.forgotTitle")}</h1>
        <p style={authText}>{t("auth.forgotNoEmail", { org: orgName })}</p>
        {contact && (
          <p style={{ ...authText, fontSize: 13 }}>
            {t("auth.forgotNoEmailAdmin")}{" "}
            <a href={`mailto:${contact}?subject=${encodeURIComponent(`${orgName}: enlace para cambiar la contraseña`)}`} style={authLink}>
              {contact}
            </a>
          </p>
        )}
      </div>,
    );
  }

  return frame(
    <form action={send} style={{ display: "flex", flexDirection: "column" }}>
      <h1 style={{ marginTop: 0 }}>{t("auth.forgotTitle")}</h1>
      <p style={authText}>{org ? t("auth.forgotSubtitle", { org: org.name }) : t("auth.forgotSubtitleNoOrg")}</p>
      <label style={authLabel} htmlFor="email">
        {t("auth.email")}
      </label>
      <input id="email" name="email" type="email" required autoComplete="email" placeholder={t("auth.emailPlaceholder")} style={authInput} />
      <button type="submit" style={authBtn}>
        {t("auth.forgotSend")}
      </button>
    </form>,
  );
}
