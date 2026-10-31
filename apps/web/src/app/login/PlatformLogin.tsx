import { PasswordField } from "@/components/PasswordField";

/**
 * Acceso a la consola de plataforma (admin.<dominio>). Es para el operador
 * del SaaS, no para las empresas: no pide subdominio y no enlaza al alta.
 */
export function PlatformLogin({
  action,
  error,
}: {
  action: (formData: FormData) => Promise<void>;
  error?: string;
}) {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <div style={{ width: 380, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span className="brand-mark" style={mark}>D</span>
          <span className="brand-name" style={{ fontSize: 17, fontWeight: 700 }}>Driony</span>
          <span className="pc-chip" style={{ marginLeft: 4 }}>Consola</span>
        </div>
        <form action={action} className="card-lift" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 6 }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 24 }}>Consola de plataforma</h1>
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
            Cuenta maestra de Driony: todas las empresas, altas y planes. No pertenece a
            ninguna empresa.
          </p>
          {error && (
            <p role="alert" style={{ margin: "0 0 8px", color: "var(--danger)", fontSize: 14 }}>
              Correo o contraseña incorrectos.
            </p>
          )}
          <label className="label" htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" required autoComplete="username" className="field" />
          <label className="label" htmlFor="password" style={{ marginTop: 8 }}>Contraseña</label>
          <PasswordField />
          <button type="submit" className="btn btn-primary" style={{ marginTop: 16 }}>
            Entrar a la consola
          </button>
        </form>
        <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--muted)", textAlign: "center" }}>
          Se configura en el servidor: PLATFORM_ADMIN_EMAIL y PLATFORM_ADMIN_PASSWORD_HASH.
        </p>
      </div>
    </main>
  );
}

const mark: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
  color: "var(--accent-ink)",
};
