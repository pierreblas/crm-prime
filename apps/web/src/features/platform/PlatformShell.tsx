import { signOut } from "@/auth";
import { cookies } from "next/headers";
import { readSessionCookie, revokeRefreshToken } from "@/lib/session-token";
import { NavIcon } from "@/components/NavIcons";

/**
 * Marco de la consola en admin.<dominio>: sin el menú de ninguna empresa,
 * porque aquí no se trabaja dentro de una sino por encima de todas.
 */
export function PlatformShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="topbar" style={bar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="brand-mark" style={mark}>D</span>
          <span className="brand-name" style={{ fontWeight: 700, fontSize: 16 }}>Driony</span>
          <span className="pc-chip">Consola de plataforma</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{email}</span>
          <form
            action={async () => {
              "use server";
              const current = await readSessionCookie(await cookies());
              await revokeRefreshToken(current?.token.refreshToken);
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="icon-btn" title="Salir" aria-label="Salir">
              <NavIcon name="logout" />
            </button>
          </form>
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}

const bar: React.CSSProperties = {
  height: "var(--header-h)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 20px",
  position: "sticky",
  top: 0,
};

const mark: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
  color: "var(--accent-ink)",
};
