import { MetaLoginHub } from "./MetaLoginHub";

export const metadata = { title: "Conectar con Facebook" };

/**
 * Inicio de sesión con Facebook en el dominio raíz (páginas y formularios).
 *
 * Meta solo deja arrancar su SDK en los dominios listados en la app, así que
 * el panel de cada empresa (su subdominio) abre esta ventana en driony.com,
 * aquí se hace el login y el código vuelve al panel por postMessage. El código
 * no sirve sin el secreto de la app, que solo tiene la API, y además la API
 * exige la sesión de un administrador para canjearlo: esta ventana no
 * autoriza nada por sí sola.
 *
 * `origin` tiene que ser un subdominio de la plataforma: a nadie más se le
 * devuelve el código.
 */
export default async function MetaLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ origin?: string }>;
}) {
  const { origin } = await searchParams;
  const base = (process.env.SAAS_BASE_DOMAIN ?? "").split(":")[0]?.toLowerCase() ?? "";
  const allowed = isTenantOrigin(origin, base);
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>Driony</p>
        {allowed ? (
          <MetaLoginHub origin={origin!} />
        ) : (
          <div style={{ padding: 20, borderRadius: 12, border: "1px solid var(--border)", background: "var(--panel)" }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>Enlace no válido</h1>
            <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>
              Esta ventana solo se abre desde el panel de una empresa de Driony. Vuelve a Ajustes › Canales y pulsa
              «Conectar con Facebook».
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

/** `https://acme.<base>` (un solo nivel), o `http://acme.localhost:3000` en desarrollo. */
function isTenantOrigin(origin: string | undefined, base: string): boolean {
  if (!origin || !base) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.pathname !== "/" || u.search || u.hash) return false;
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(`.${base}`)) return false;
  const slug = host.slice(0, -(base.length + 1));
  if (!slug || slug.includes(".")) return false;
  const local = base === "localhost";
  return local ? u.protocol === "http:" : u.protocol === "https:";
}
