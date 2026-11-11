import { redirect } from "next/navigation";
import { setupDraftSchema, type SetupDraft } from "@crm/shared";
import { currentOrgSlug } from "@/lib/org";
import { SignupForm } from "./SignupForm";

export const metadata = { title: "Crea tu empresa" };

/**
 * Alta de empresa. Vive en el dominio principal a propósito: desde el
 * subdominio de una empresa no tiene sentido crear otra, así que se redirige a
 * su propio acceso.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  if (await currentOrgSlug()) redirect("/login");
  // Lo armado en el simulador de la landing (/signup?setup=…), si viene bien formado.
  let setup: SetupDraft | null = null;
  const raw = (await searchParams).setup;
  if (raw) {
    try {
      const parsed = setupDraftSchema.safeParse(JSON.parse(raw));
      if (parsed.success) setup = parsed.data;
    } catch {
      setup = null;
    }
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>
          Driony
        </p>
        <SignupForm baseDomain={process.env.SAAS_BASE_DOMAIN ?? "localhost:3000"} setup={setup} />
      </div>
    </main>
  );
}
