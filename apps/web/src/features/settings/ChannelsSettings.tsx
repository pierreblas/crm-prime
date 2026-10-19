"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { WhatsAppConnect } from "@/features/whatsapp/WhatsAppConnect";
import { MetaLeadsSettings } from "./MetaLeadsSettings";
import { fetchMetaPages, fetchWhatsappChannels } from "@/lib/bff";

type ChannelKey = "whatsapp" | "facebook";

/**
 * Ajustes › Canales: por dónde entran los clientes. Una tarjeta por canal con
 * su estado y, debajo, la conexión del canal elegido. Los que aún no existen
 * se ven como «próximamente» para que se entienda a dónde va esto.
 */
export function ChannelsSettings({ hub }: { hub: boolean }) {
  const [channel, setChannel] = useState<ChannelKey>("whatsapp");
  // Enlaces directos: ?tab=metaLeads (el antiguo) o ?channel=facebook.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("channel") === "facebook" || q.get("tab") === "metaLeads") setChannel("facebook");
  }, []);

  const { data: numbers = [] } = useQuery({ queryKey: ["wa-channels"], queryFn: fetchWhatsappChannels });
  const { data: pages = [] } = useQuery({ queryKey: ["meta-pages"], queryFn: fetchMetaPages });

  const activeNumbers = numbers.filter((n) => n.isActive && n.status === "connected").length;
  const brokenNumbers = numbers.filter((n) => n.isActive && n.status === "error").length;
  const activePages = pages.filter((p) => p.isActive).length;
  const pendingLeads = pages.reduce((a, p) => a + p.pendingCount, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Canales</h3>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
          Por dónde te escriben tus clientes. Elige un canal para conectarlo o gestionarlo.
        </p>
      </header>

      <div style={grid} role="tablist" aria-label="Canales">
        <ChannelCard
          icon="whatsapp"
          name="WhatsApp"
          active={channel === "whatsapp"}
          onClick={() => setChannel("whatsapp")}
          status={
            numbers.length === 0
              ? { tone: "muted", text: "Sin números conectados" }
              : brokenNumbers > 0
                ? { tone: "warn", text: `${activeNumbers} activo${activeNumbers === 1 ? "" : "s"} · ${brokenNumbers} con error` }
                : { tone: "ok", text: `${activeNumbers} número${activeNumbers === 1 ? "" : "s"} activo${activeNumbers === 1 ? "" : "s"}` }
          }
          description="Números de WhatsApp Business: la bandeja, el agente de IA y las difusiones."
        />
        <ChannelCard
          icon="megaphone"
          name="Formularios de Facebook"
          active={channel === "facebook"}
          onClick={() => setChannel("facebook")}
          status={
            pages.length === 0
              ? { tone: "muted", text: "Sin páginas conectadas" }
              : pendingLeads > 0
                ? { tone: "warn", text: `${activePages} página${activePages === 1 ? "" : "s"} · ${pendingLeads} lead${pendingLeads === 1 ? "" : "s"} sin teléfono` }
                : { tone: "ok", text: `${activePages} página${activePages === 1 ? "" : "s"} conectada${activePages === 1 ? "" : "s"}` }
          }
          description="Leads de los formularios de Facebook e Instagram entran solos como contactos."
        />
        <ChannelCard icon="message" name="Instagram" soon description="Mensajes directos de Instagram en la misma bandeja." />
        <ChannelCard icon="message" name="Messenger" soon description="Chats de tu página de Facebook en la misma bandeja." />
      </div>

      <div data-channel-panel={channel}>
        {channel === "whatsapp" ? <WhatsAppConnect hub={hub} /> : <MetaLeadsSettings hub={hub} />}
      </div>
    </div>
  );
}

function ChannelCard({
  icon,
  name,
  description,
  status,
  active = false,
  soon = false,
  onClick,
}: {
  icon: IconName;
  name: string;
  description: string;
  status?: { tone: "ok" | "warn" | "muted"; text: string };
  active?: boolean;
  soon?: boolean;
  onClick?: () => void;
}) {
  const color = status?.tone === "ok" ? "var(--positive)" : status?.tone === "warn" ? "var(--warning)" : "var(--muted)";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={soon}
      onClick={onClick}
      style={{
        ...card,
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "color-mix(in oklab, var(--accent) 8%, var(--panel))" : "var(--panel)",
        opacity: soon ? 0.55 : 1,
        cursor: soon ? "default" : "pointer",
      }}
      data-channel-card={name}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: active ? "var(--accent-text)" : "var(--muted)", display: "inline-flex" }}>
          <NavIcon name={icon} size={16} />
        </span>
        <strong style={{ fontSize: 14 }}>{name}</strong>
        {soon && <span style={pill}>Próximamente</span>}
      </span>
      <span style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.4 }}>{description}</span>
      {status && (
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
          {status.text}
        </span>
      )}
    </button>
  );
}

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
};
const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 8,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  textAlign: "left",
  color: "var(--text)",
  font: "inherit",
  boxShadow: "var(--shadow-card)",
};
const pill: React.CSSProperties = {
  fontSize: 11,
  padding: "1px 7px",
  borderRadius: 999,
  background: "var(--surface-3)",
  color: "var(--muted)",
};
