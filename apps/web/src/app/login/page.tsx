import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { currentOrgContext, currentOrgSlug, isPlatformHost } from "@/lib/org";
import { PlatformLogin } from "./PlatformLogin";
import { OrgNotFound } from "./OrgNotFound";
import { FindCompany } from "./FindCompany";
import { safeCallbackUrl } from "@/lib/session-token";
import { getTranslator } from "@/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeButton } from "@/components/ThemeSwitcher";
import { authBtn as btn, authCard as card, authFoot as pieTexto, authInput as input, authLabel as label } from "./styles";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    expired?: string;
    callbackUrl?: string;
    slug?: string;
    reset?: string;
  }>;
}) {
  const t = await getTranslator();
  const { error, expired, callbackUrl: rawCallback, slug, reset } = await searchParams;
  const callbackUrl = safeCallbackUrl(rawCallback);
  const session = await auth();

  // admin.<dominio>: consola del operador del SaaS, con su propio acceso.
  if (await isPlatformHost()) {
    if (session) redirect("/platform");
    async function operatorLogin(formData: FormData) {
      "use server";
      try {
        await signIn("credentials", {
          email: formData.get("email"),
          password: formData.get("password"),
          operator: "1",
          redirectTo: "/platform",
        });
      } catch (e) {
        if (e instanceof AuthError) redirect("/login?error=credentials");
        throw e;
      }
    }
    return <PlatformLogin action={operatorLogin} error={error} />;
  }

  if (session) redirect(callbackUrl);

  // Empresa del subdominio. Con DNS comodín cualquier subdominio responde, así
  // que hay que distinguir "no hay subdominio" de "subdominio que no existe".
  const ctx = await currentOrgContext();
  const baseDomain = process.env.SAAS_BASE_DOMAIN ?? "localhost:3000";
  const org = ctx.kind === "found" ? ctx.org : null;
  // Hay dominio base configurado = instalación SaaS con subdominios.
  const esSaaS = !!process.env.SAAS_BASE_DOMAIN;

  async function login(formData: FormData) {
    "use server";
    const target = safeCallbackUrl(formData.get("callbackUrl"));
    try {
      // El subdominio se lee del servidor, no del formulario: así no depende de
      // un campo oculto que cualquiera puede cambiar en el navegador.
      const orgSlug = await currentOrgSlug();
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        ...(orgSlug ? { orgSlug } : {}),
        redirectTo: target,
      });
    } catch (e) {
      // signIn lanza NEXT_REDIRECT al tener éxito (hay que re-lanzarlo).
      // Si las credenciales fallan, lanza AuthError → volvemos con error.
      if (e instanceof AuthError) {
        const params = new URLSearchParams({ error: "credentials" });
        if (target !== "/") params.set("callbackUrl", target);
        redirect(`/login?${params.toString()}`);
      }
      throw e;
    }
  }

  // Dominio raíz en SaaS: aquí no se inicia sesión, se elige empresa.
  if (esSaaS && ctx.kind === "none") {
    return (
      <main
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          padding: 24,
        }}
      >
        <div style={{ position: "absolute", top: 20, right: 20 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ThemeButton />
            <LanguageSwitcher />
          </span>
        </div>
        <FindCompany baseDomain={baseDomain} error={error} slug={slug} />
      </main>
    );
  }

  if (ctx.kind === "unknown") {
    return (
      <main
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          padding: 24,
        }}
      >
        <OrgNotFound slug={ctx.slug} baseDomain={baseDomain} />
      </main>
    );
  }

  return (
    <main
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ThemeButton />
          <LanguageSwitcher />
        </span>
      </div>
      <form action={login} style={card}>
        <h1 style={{ marginTop: 0 }}>{org?.name ?? t("auth.signInTitle")}</h1>
        <p style={{ color: "var(--muted)", marginTop: -8 }}>
          {org
            ? t("auth.orgAccess", { org: org.name })
            : t("auth.signInSubtitle")}
        </p>

        {error ? (
          <p role="alert" style={{ color: "var(--danger)" }}>
            {error === "handoff"
              ? t("auth.handoffExpired")
              : t("auth.invalidCredentials")}
          </p>
        ) : reset ? (
          <p role="status" style={{ color: "var(--accent-text)", lineHeight: 1.5 }} data-reset-done>
            {t("auth.resetDone")}
          </p>
        ) : expired ? (
          <p style={{ color: "var(--muted)" }}>{t("auth.sessionExpired")}</p>
        ) : null}

        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        <label style={label}>{t("auth.email")}</label>
        <input
          name="email"
          type="email"
          required
          placeholder={t("auth.emailPlaceholder")}
          style={input}
        />

        <label style={label}>{t("auth.password")}</label>
        <input name="password" type="password" required style={input} />
        <Link href="/login/forgot" style={forgotLink} data-forgot-link>
          {t("auth.forgotLink")}
        </Link>

        <button type="submit" style={btn}>
          {t("auth.signIn")}
        </button>

        {/*
          Qué se ofrece debajo del formulario depende de dónde estés:

          · Dentro del subdominio de una empresa, NO se ofrece registrarse. Si
            se ofreciera, cualquiera que supiera el subdominio podría meterse
            en la lista de usuarios de esa empresa. Se entra por invitación.
          · En el dominio principal, lo que se crea es una EMPRESA, no un
            usuario suelto.
          · Con una sola empresa (open source), todo sigue como siempre.
        */}
        {org ? (
          <p style={pieTexto}>{t("auth.askAdmin", { org: org.name })}</p>
        ) : esSaaS ? (
          <p style={pieTexto}>
            {t("auth.companyNotHere")}{" "}
            <Link href="/signup" style={{ color: "var(--accent-text)" }}>
              {t("auth.createCompany")}
            </Link>
          </p>
        ) : (
          <p style={pieTexto}>
            {t("auth.noAccount")}{" "}
            <Link href="/register" style={{ color: "var(--accent-text)" }}>
              {t("auth.signUp")}
            </Link>
          </p>
        )}
      </form>
    </main>
  );
}

const forgotLink: React.CSSProperties = {
  alignSelf: "flex-end",
  marginTop: 8,
  fontSize: 13,
  color: "var(--accent-text)",
};
