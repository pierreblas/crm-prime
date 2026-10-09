import Link from "next/link";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { readSessionCookie, revokeRefreshToken } from "@/lib/session-token";
import { NavIcon } from "./NavIcons";
import { SideNav, type NavKey } from "./SideNav";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { MobileMenuButton } from "./MobileMenuButton";
import { HelpMenu } from "./HelpMenu";
import { AlertsBell } from "./AlertsBell";
import { RealtimeProvider } from "./RealtimeProvider";
import { CallProvider } from "@/features/calls/CallProvider";
import { TourHost } from "@/features/onboarding/TourHost";
import { platformConsoleUrl } from "@/lib/org";
import { getTranslator } from "@/i18n/server";
import type { MessageKey } from "@/i18n/translate";

export type { NavKey };

// Cada pantalla toma su título del diccionario; la clave es la misma que su
// entrada en el menú.
const TITLE_KEYS: Record<NavKey, string> = {
  gettingStarted: "gettingStarted",
  dashboard: "dashboard",
  platform: "platform",
  inbox: "inbox",
  contacts: "contacts",
  pipeline: "pipeline",
  products: "products",
  bots: "agents",
  flows: "flows",
  campaigns: "broadcasts",
  sellers: "sellers",
  knowledge: "knowledge",
  whatsapp: "whatsapp",
  sessions: "sessions",
  account: "account",
  settings: "settings",
};

export async function AppShell({
  email,
  role,
  active,
  children,
}: {
  email: string;
  role?: string;
  active: NavKey;
  children: React.ReactNode;
}) {
  const t = await getTranslator();
  const page = TITLE_KEYS[active];
  // La preferencia del menú se lee en el servidor: así se pinta ya plegado,
  // sin el salto de verlo ancho un instante.
  const collapsed = (await cookies()).get("sidebar-collapsed")?.value === "1";
  // Cuenta maestra del SaaS (admin.<dominio>); los usuarios de empresa, nunca.
  const session = await auth();
  const platformAdmin = (session?.user as { platformAdmin?: boolean } | undefined)?.platformAdmin === true;

  return (
    <RealtimeProvider>
    <CallProvider>
    <div style={shell}>
      <SideNav
        role={role}
        active={active}
        initialCollapsed={collapsed}
        platformAdmin={platformAdmin}
        platformUrl={platformConsoleUrl() ?? "/platform"}
      />

      <div style={main}>
        <header className="topbar" style={topbar}>
          <MobileMenuButton />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="topbar-title" style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {t(`pages.${page}.title` as MessageKey)}
            </div>
            <div className="topbar-subtitle" style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {t(`pages.${page}.subtitle` as MessageKey)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <AlertsBell />
            <HelpMenu />
            <span className="topbar-lang">
              <LanguageSwitcher />
            </span>
            <Link
              href="/account"
              className="user-chip"
              style={{ ...userChip, color: "var(--text)" }}
              title={t("nav.myAccount")}
            >
              <span className="avatar" style={avatar}>{(email[0] ?? "?").toUpperCase()}</span>
              <div className="user-chip__text" style={{ lineHeight: 1.2 }}>
                <div style={{ fontSize: 13 }}>{email}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{role}</div>
              </div>
            </Link>
            <form
              action={async () => {
                "use server";
                // Revoca también la sesión en el backend: si no, seguiría
                // activa (y listada en Sesiones) hasta que caducara.
                const current = await readSessionCookie(await cookies());
                await revokeRefreshToken(current?.token.refreshToken);
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button type="submit" className="icon-btn" title={t("nav.logout")}>
                <NavIcon name="logout" />
              </button>
            </form>
          </div>
        </header>

        <div className="app-content" style={content}>{children}</div>
        <TourHost />
      </div>
    </div>
    </CallProvider>
    </RealtimeProvider>
  );
}

const shell: React.CSSProperties = {
  display: "flex",
  height: "100vh",
  overflow: "hidden",
};

const main: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
};

const topbar: React.CSSProperties = {
  height: "var(--header-h)",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 20px",
  // Fondo, borde y cristal: en .topbar (globals.css).
};

const content: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

const userChip: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "4px 6px",
  borderRadius: 9,
  transition: "background 0.12s ease",
};

const avatar: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "50%",
  color: "#eaf2ff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  fontWeight: 700,
};
