"use client";

import { useState } from "react";
import Link from "next/link";
import { NavIcon, type IconName } from "./NavIcons";
import { useT } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/translate";
import { OnboardingNavCard } from "@/features/onboarding/OnboardingNavCard";
import { TrialNavChip } from "@/features/plans/TrialNavChip";
import { useRealtimeCtx } from "./RealtimeProvider";
import { useQuery } from "@tanstack/react-query";
import type { PermissionSection } from "@crm/shared";
import { fetchMe } from "@/lib/bff";

/** Qué sección de los permisos manda sobre cada entrada del menú (las demás, siempre). */
const SECTION_OF: Record<string, PermissionSection | undefined> = {
  dashboard: "dashboard",
  pipeline: "pipeline",
  products: "products",
  bots: "automation",
  flows: "automation",
  campaigns: "automation",
  knowledge: "knowledge",
};

export type NavKey =
  | "gettingStarted"
  | "dashboard"
  | "platform"
  | "inbox"
  | "contacts"
  | "pipeline"
  | "products"
  | "bots"
  | "flows"
  | "campaigns"
  | "sellers"
  | "knowledge"
  | "whatsapp"
  | "sessions"
  | "account"
  | "settings";

type Item = {
  key: NavKey;
  href: string;
  labelKey: MessageKey;
  icon: IconName;
  adminOnly?: boolean;
  /** Solo el operador del SaaS (no confundir con ADMIN de una empresa). */
  platformOnly?: boolean;
};
type Group = { labelKey: MessageKey; items: Item[] };

const NAV: Group[] = [
  {
    labelKey: "nav.groupSales",
    items: [
      { key: "dashboard", href: "/dashboard", labelKey: "nav.dashboard", icon: "chart" },
      { key: "inbox", href: "/", labelKey: "nav.inbox", icon: "inbox" },
      { key: "contacts", href: "/contacts", labelKey: "nav.contacts", icon: "user" },
      { key: "pipeline", href: "/pipeline", labelKey: "nav.pipeline", icon: "pipeline" },
      { key: "products", href: "/products", labelKey: "nav.products", icon: "tag" },
    ],
  },
  {
    labelKey: "nav.groupAutomation",
    items: [
      { key: "bots", href: "/agentes", labelKey: "nav.agents", icon: "bot" },
      { key: "flows", href: "/flows", labelKey: "nav.flows", icon: "flow" },
      { key: "campaigns", href: "/difusiones", labelKey: "nav.broadcasts", icon: "megaphone" },
    ],
  },
  {
    labelKey: "nav.groupTeam",
    items: [
      {
        key: "sellers",
        href: "/sellers",
        labelKey: "nav.sellers",
        icon: "user",
        adminOnly: true,
      },
    ],
  },
  {
    labelKey: "nav.groupResources",
    items: [
      { key: "knowledge", href: "/knowledge", labelKey: "nav.knowledge", icon: "book" },
      { key: "whatsapp", href: "/whatsapp", labelKey: "nav.whatsapp", icon: "whatsapp" },
    ],
  },
  {
    labelKey: "nav.groupSystem",
    items: [
      {
        key: "settings",
        href: "/settings",
        labelKey: "nav.settings",
        icon: "settings",
        adminOnly: true,
      },
    ],
  },
  {
    labelKey: "nav.groupPlatform",
    items: [
      {
        key: "platform",
        href: "/platform",
        labelKey: "nav.platform",
        icon: "globe",
        platformOnly: true,
      },
    ],
  },
];

const COOKIE = "sidebar-collapsed";

/**
 * Menú lateral plegable. El estado se guarda en una cookie (no en
 * localStorage) para que el servidor ya lo sepa al pintar: así no se ve el
 * menú ancho un instante antes de plegarse.
 */
export function SideNav({
  role,
  active,
  initialCollapsed,
  platformAdmin = false,
  platformUrl = "/platform",
}: {
  role?: string;
  active: NavKey;
  initialCollapsed: boolean;
  platformAdmin?: boolean;
  /** En SaaS, la consola vive en admin.<dominio>. */
  platformUrl?: string;
}) {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 60_000, enabled: role !== "ADMIN" });
  const sections = me?.permissions?.sections;
  const t = useT();
  const { unread } = useRealtimeCtx();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Un año: es una preferencia, no un dato de sesión.
    document.cookie = `${COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside className="side-nav" style={{ ...sidebar, width: collapsed ? 64 : "var(--sidebar-w)" }}>
      <div style={{ ...brand, justifyContent: collapsed ? "center" : "space-between" }}>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span className="brand-mark" style={brandMark}>D</span>
            <span className="brand-name" style={{ fontWeight: 700, fontSize: 16 }}>Driony</span>
          </div>
        )}
        <button
          onClick={toggle}
          className="icon-btn"
          style={toggleBtn}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          aria-expanded={!collapsed}
        >
          <span
            style={{
              display: "flex",
              transform: collapsed ? "rotate(180deg)" : undefined,
            }}
          >
            <NavIcon name="arrow-left" size={16} />
          </span>
        </button>
      </div>

      <nav style={{ padding: collapsed ? "8px 8px" : "4px 10px", overflowY: "auto", flex: 1 }}>
        {role === "ADMIN" && (
          <>
            <OnboardingNavCard collapsed={collapsed} active={active === "gettingStarted"} />
            <TrialNavChip collapsed={collapsed} />
          </>
        )}
        {NAV.map((group) => {
          const items = group.items.filter(
            (it) =>
              (!it.adminOnly || role === "ADMIN") &&
              (!it.platformOnly || platformAdmin) &&
              (role === "ADMIN" || !sections || !SECTION_OF[it.key] || sections[SECTION_OF[it.key]!]),
          );
          if (items.length === 0) return null;
          return (
            <div key={group.labelKey}>
              {collapsed ? (
                <div style={groupSeparator} />
              ) : (
                <div className="nav-group">{t(group.labelKey)}</div>
              )}
              {items.map((it) => (
                <Link
                  key={it.key}
                  href={it.platformOnly ? platformUrl : it.href}
                  className={`nav-item${active === it.key ? " active" : ""}`}
                  data-tour={`nav-${it.key}`}
                  style={collapsed ? collapsedItem : undefined}
                  title={collapsed ? t(it.labelKey) : undefined}
                  onClick={() => document.body.classList.remove("nav-open")}
                >
                  <NavIcon name={it.icon} />
                  {!collapsed && t(it.labelKey)}
                  {it.key === "inbox" && unread > 0 && (
                    <span className={`nav-badge${collapsed ? " nav-badge--dot" : ""}`} aria-label={`${unread}`}>
                      {collapsed ? "" : unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

const sidebar: React.CSSProperties = {
  flexShrink: 0,
  background: "var(--sidebar)",
  borderRight: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  transition: "width 0.16s ease",
};

const brand: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  height: "var(--header-h)",
  padding: "0 12px",
  borderBottom: "1px solid var(--border)",
};

const brandMark: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  color: "var(--accent-ink)",
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
  flexShrink: 0,
};

const toggleBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
};

const collapsedItem: React.CSSProperties = {
  justifyContent: "center",
  padding: "10px 0",
};

const groupSeparator: React.CSSProperties = {
  height: 1,
  background: "var(--border)",
  margin: "8px 6px",
};
