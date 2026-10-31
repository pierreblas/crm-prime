import Link from "next/link";
import { getTranslator } from "@/i18n/server";
import { buscarEmpresa } from "./find-company";

/**
 * Pantalla del dominio raíz: pide la dirección de la empresa y salta a ella.
 * No hay correo ni contraseña aquí a propósito — ver find-company.ts.
 */
export async function FindCompany({
  baseDomain,
  error,
  slug,
}: {
  baseDomain: string;
  error?: string;
  slug?: string;
}) {
  const t = await getTranslator();
  return (
    <form action={buscarEmpresa} style={caja}>
      <h1 style={{ marginTop: 0 }}>{t("auth.findCompanyTitle")}</h1>
      <p style={{ color: "var(--muted)", marginTop: -8 }}>{t("auth.findCompanySubtitle")}</p>

      {error === "unknown-company" && (
        <p role="alert" style={{ color: "#e08a8a" }}>{t("auth.unknownCompany")}</p>
      )}

      <label htmlFor="slug" style={etiqueta}>{t("auth.companyAddress")}</label>
      <div style={grupo}>
        <input
          id="slug"
          name="slug"
          defaultValue={slug ?? ""}
          placeholder="acme"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          style={campo}
        />
        <span style={sufijo}>.{baseDomain}</span>
      </div>

      <button type="submit" style={boton}>{t("auth.goToCompany")}</button>

      <p style={pie}>{t("auth.forgotAddress")}</p>
      <p style={pie}>
        {t("auth.companyNotHere")}{" "}
        <Link href="/signup" style={{ color: "var(--accent)" }}>{t("auth.createCompany")}</Link>
      </p>
    </form>
  );
}

const caja: React.CSSProperties = {
  width: 360,
  padding: 28,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
};
const etiqueta: React.CSSProperties = { fontSize: 13, color: "var(--muted)", marginTop: 14, marginBottom: 6 };
const grupo: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  overflow: "hidden",
};
const campo: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "10px 12px",
  border: "none",
  background: "transparent",
  color: "var(--text)",
  font: "inherit",
};
const sufijo: React.CSSProperties = { padding: "10px 10px", color: "var(--muted)", fontSize: 13, whiteSpace: "nowrap" };
const boton: React.CSSProperties = {
  marginTop: 22,
  padding: "11px 14px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};
const pie: React.CSSProperties = { color: "var(--muted)", fontSize: 13, marginTop: 14, textAlign: "center" };
