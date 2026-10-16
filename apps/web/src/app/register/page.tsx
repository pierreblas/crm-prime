import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import { PasswordField } from "@/components/PasswordField";
import { getTranslator } from "@/i18n/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: `Driony — ${t("auth.signUpTitle")}` };
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslator();
  const session = await auth();
  if (session) redirect("/");
  // En SaaS no hay usuarios sueltos: se crea una empresa, o te invita la tuya.
  if (process.env.SAAS_BASE_DOMAIN) redirect("/signup");
  const { error } = await searchParams;

  async function register(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "");
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const res = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { message?: string | string[] }
        | null;
      const msg = Array.isArray(body?.message)
        ? body?.message.join(", ")
        : (body?.message ?? t("auth.signUpFailed"));
      redirect(`/register?error=${encodeURIComponent(msg)}`);
    }

    // Registro correcto → iniciar sesión automáticamente.
    try {
      await signIn("credentials", { email, password, redirectTo: "/getting-started" });
    } catch (e) {
      if (e instanceof AuthError) {
        redirect("/login?error=credentials");
      }
      throw e;
    }
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <LanguageSwitcher />
      </div>
      <div style={{ width: 360, maxWidth: "100%" }}>
        {/* La misma marca que en la landing: el visitante sabe que sigue en Driony. */}
        <Link href="/" style={brandLink} aria-label="Driony, inicio">
          <span className="brand-mark" style={brandMark}>D</span>
          <span className="brand-name">Driony</span>
        </Link>
        <form action={register} style={card}>
        <h1 style={{ marginTop: 0 }}>{t("auth.signUpTitle")}</h1>
        <p style={{ color: "var(--muted)", marginTop: -8 }}>
          {t("auth.signUpSubtitle")}
        </p>
        <p style={{ color: "var(--accent-text)", fontSize: 13.5, margin: "4px 0 0" }}>
          {t("auth.signUpReassure")}
        </p>

        {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}

        <label style={label}>{t("auth.name")}</label>
        <input name="name" type="text" required placeholder={t("auth.namePlaceholder")} style={input} />

        <label style={label}>{t("auth.email")}</label>
        <input name="email" type="email" required placeholder={t("auth.emailPlaceholder")} style={input} />

        <label style={label}>{t("auth.password")}</label>
        <PasswordField />

        <button type="submit" style={btn}>
          {t("auth.createAccount")}
        </button>

        <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 12, textAlign: "center", lineHeight: 1.5 }}>
          {t("auth.termsPrefix")}{" "}
          <Link href="/terms" style={{ color: "var(--accent)" }}>
            {t("auth.termsLink")}
          </Link>{" "}
          {t("auth.andThe")}{" "}
          <Link href="/privacy" style={{ color: "var(--accent)" }}>
            {t("auth.privacyLink")}
          </Link>
          .
        </p>

        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 18, textAlign: "center" }}>
          {t("auth.haveAccount")}{" "}
          <Link href="/login" style={{ color: "var(--accent)" }}>
            {t("auth.signIn")}
          </Link>
        </p>
        </form>
      </div>
    </main>
  );
}

const brandLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 18,
  fontSize: 17,
  fontWeight: 700,
  color: "var(--text)",
  textDecoration: "none",
};

const brandMark: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
};

const card: React.CSSProperties = {
  width: "100%",
  padding: 28,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
};

const label: React.CSSProperties = {
  fontSize: 13,
  color: "var(--muted)",
  marginTop: 14,
  marginBottom: 6,
};

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
};

const btn: React.CSSProperties = {
  marginTop: 22,
  padding: "11px 14px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};
