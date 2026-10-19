"use client";

import { useEffect, useState } from "react";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { ChannelsSettings } from "./ChannelsSettings";
import { TagsManager } from "./TagsManager";
import { QuickRepliesSettings } from "./QuickRepliesSettings";
import { AiSettings } from "./AiSettings";
import { ApiKeysSettings } from "./ApiKeysSettings";
import { IntegrationsSettings } from "./IntegrationsSettings";
import { WebhooksOutSettings } from "./WebhooksOutSettings";
import { PlanSettings } from "@/features/plans/PlanSettings";
import { AiUsageSettings } from "./AiUsageSettings";
import { PipelinesSettings } from "./PipelinesSettings";
import { CustomFieldsSettings, SourcesSettings } from "./SettingsPanels";

type TabKey =
  | "plan"
  | "tags"
  | "quickReplies"
  | "channels"
  | "sources"
  | "fields"
  | "stages"
  | "ai"
  | "aiUsage"
  | "apiKeys"
  | "integrations"
  | "webhooksOut";

const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: "plan", label: "Plan", icon: "trophy" },
  { key: "tags", label: "Etiquetas", icon: "tag" },
  { key: "quickReplies", label: "Respuestas rápidas", icon: "zap" },
  { key: "channels", label: "Canales", icon: "globe" },
  { key: "sources", label: "Fuentes", icon: "target" },
  { key: "fields", label: "Campos personalizados", icon: "puzzle" },
  { key: "stages", label: "Embudos y etapas", icon: "pipeline" },
  { key: "ai", label: "Inteligencia Artificial", icon: "bot" },
  { key: "aiUsage", label: "Consumo de IA", icon: "bolt" },
  { key: "apiKeys", label: "Claves de API", icon: "key" },
  { key: "integrations", label: "Integraciones", icon: "plug" },
  { key: "webhooksOut", label: "Webhooks salientes", icon: "antenna" },
];

/** `hub`: SaaS. Las conexiones con Meta se hacen en el dominio raíz, no en el subdominio. */
export function SettingsManager({ hub = false }: { hub?: boolean }) {
  const [tab, setTab] = useState<TabKey>("tags");

  // Enlaces directos a una pestaña (Primeros pasos manda a ?tab=ai). La antigua
  // «Leads de Meta» vive ahora dentro de Canales.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted === "metaLeads") setTab("channels");
    else if (wanted && TABS.some((t) => t.key === wanted)) setTab(wanted as TabKey);
  }, []);

  return (
    <div style={wrap}>
      <nav style={tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={tabBtn(tab === t.key)}
          >
            <NavIcon name={t.icon} size={16} />
            {t.label}
          </button>
        ))}
      </nav>

      <div style={{ minWidth: 0 }}>
        {tab === "plan" && <PlanSettings />}
        {tab === "tags" && <TagsManager />}
        {tab === "quickReplies" && <QuickRepliesSettings />}
        {tab === "channels" && <ChannelsSettings hub={hub} />}
        {tab === "sources" && <SourcesSettings />}
        {tab === "fields" && <CustomFieldsSettings />}
        {tab === "stages" && <PipelinesSettings />}
        {tab === "ai" && <AiSettings />}
        {tab === "aiUsage" && <AiUsageSettings />}
        {tab === "apiKeys" && <ApiKeysSettings />}
        {tab === "integrations" && <IntegrationsSettings />}
        {tab === "webhooksOut" && <WebhooksOutSettings />}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "220px 1fr",
  gap: 24,
  maxWidth: 1040,
  margin: "0 auto",
  padding: 24,
  alignItems: "start",
};

const tabBar: React.CSSProperties = {
  position: "sticky",
  top: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 9,
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: 9,
    border: "1px solid transparent",
    background: active ? "var(--surface)" : "transparent",
    color: active ? "var(--text)" : "var(--muted)",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    borderColor: active ? "var(--border)" : "transparent",
    transition: "background 0.12s ease, color 0.12s ease",
  };
}
