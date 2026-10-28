"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WaIcon, WhatsAppConnect } from "@/features/whatsapp/WhatsAppConnect";
import { MetaLeadsSettings } from "./MetaLeadsSettings";
import { fetchMetaPages, fetchWhatsappChannels } from "@/lib/bff";

type ChannelKey = "whatsapp" | "facebook";
type Status = { tone: "ok" | "warn" | "muted"; text: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Ajustes › Canales: por dónde entran los clientes. Arriba, los canales que
 * existen, con su marca y su estado; los que vienen, en una línea discreta.
 * Debajo, el panel del canal elegido.
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
  const brokenNumbers = numbers.filter((n) => n.status === "error").length;
  const activePages = pages.filter((p) => p.isActive).length;
  const pendingLeads = pages.reduce((a, p) => a + p.pendingCount, 0);

  const waStatus: Status =
    numbers.length === 0
      ? { tone: "muted", text: "Sin números conectados" }
      : brokenNumbers > 0
        ? { tone: "warn", text: `${plural(brokenNumbers, "número necesita", "números necesitan")} atención` }
        : activeNumbers === 0
          ? { tone: "warn", text: "Ningún número activo" }
          : { tone: "ok", text: plural(activeNumbers, "número activo", "números activos") };
  const fbStatus: Status =
    pages.length === 0
      ? { tone: "muted", text: "Sin páginas conectadas" }
      : pendingLeads > 0
        ? { tone: "warn", text: `${plural(pendingLeads, "lead", "leads")} sin teléfono` }
        : { tone: "ok", text: plural(activePages, "página conectada", "páginas conectadas") };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Canales</h3>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>Por dónde te escriben tus clientes.</p>
      </header>

      <div className="ch-picker" role="tablist" aria-label="Canales">
        <ChannelTab
          kind="wa"
          name="WhatsApp"
          desc="Tus números de WhatsApp Business: bandeja, agente de IA y difusiones."
          status={waStatus}
          active={channel === "whatsapp"}
          onClick={() => setChannel("whatsapp")}
        />
        <ChannelTab
          kind="fb"
          name="Formularios de Facebook"
          desc="Los leads de tus anuncios de Facebook e Instagram entran solos como contactos."
          status={fbStatus}
          active={channel === "facebook"}
          onClick={() => setChannel("facebook")}
        />
      </div>
      <p className="ch-soon">
        Próximamente: <span>Instagram Direct</span>
        <span>Messenger</span>
      </p>

      <div role="tabpanel" data-channel-panel={channel}>
        {channel === "whatsapp" ? <WhatsAppConnect hub={hub} embedded /> : <MetaLeadsSettings hub={hub} />}
      </div>
    </div>
  );
}

function ChannelTab({
  kind,
  name,
  desc,
  status,
  active,
  onClick,
}: {
  kind: "wa" | "fb";
  name: string;
  desc: string;
  status: Status;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} className="ch-tab" onClick={onClick} data-channel-card={name}>
      <span className={`ch-tab__mark is-${kind}`} aria-hidden="true">
        {kind === "wa" ? <WaIcon /> : <FacebookMark />}
      </span>
      <span className="ch-tab__name">{name}</span>
      <span className="ch-tab__desc">{desc}</span>
      <span className={`ch-status is-${status.tone}`}>{status.text}</span>
    </button>
  );
}

function FacebookMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1Z" />
    </svg>
  );
}
