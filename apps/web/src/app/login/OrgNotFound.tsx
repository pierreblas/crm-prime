import Link from "next/link";

/**
 * Subdominio que no corresponde a ninguna empresa.
 *
 * Existe porque con DNS comodín **cualquier** subdominio responde: no hay un
 * 404 del servidor que avise. Sin esta pantalla, un error de tecleo enseña un
 * formulario de acceso perfectamente normal que rechaza la contraseña correcta,
 * y eso parece un fallo del producto en vez de una dirección equivocada.
 */
export function OrgNotFound({ slug, baseDomain }: { slug: string; baseDomain: string }) {
  return (
    <div style={caja}>
      <h1 style={{ marginTop: 0, fontSize: 20 }}>Aquí no hay ninguna empresa</h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        No encontramos ninguna cuenta en{" "}
        <strong style={{ color: "inherit" }}>
          {slug}.{baseDomain}
        </strong>
        . Puede que la dirección esté mal escrita.
      </p>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        Si tu empresa ya usa Driony, pídele la dirección exacta a quien la dio
        de alta.
      </p>
      <Link href={`https://${baseDomain}/signup`} style={boton}>
        Crear una empresa nueva
      </Link>
    </div>
  );
}

const caja: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  padding: 28,
  borderRadius: 14,
  background: "var(--panel, #16181d)",
  border: "1px solid var(--border, #262a31)",
};
const boton: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  marginTop: 22,
  padding: "11px 14px",
  borderRadius: 8,
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  textDecoration: "none",
};
