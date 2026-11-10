"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { WaIcon, WhatsAppConnect } from "@/features/whatsapp/WhatsAppConnect";
import { ChannelMark } from "@/features/inbox/ChannelMark";
import { MetaLeadsSettings } from "./MetaLeadsSettings";
import { MetaMessagingSettings } from "./MetaMessagingSettings";
import { TikTokSettings } from "./TikTokSettings";
import { fetchMetaPages, fetchTikTokAccounts, fetchWhatsappChannels } from "@/lib/bff";

type ChannelKey = "whatsapp" | "messenger" | "instagram" | "tiktok" | "facebook";
type Status = { tone: "ok" | "warn" | "muted"; text: string };

const KEYS: ChannelKey[] = ["whatsapp", "messenger", "instagram", "tiktok", "facebook"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Ajustes › Canales: por dónde entran los clientes. Una fila de pestañas
 * compactas (marca, nombre y estado) y debajo el panel del canal elegido, que
 * es el que explica qué hace cada uno. Messenger e Instagram cuelgan de la
 * misma página de Facebook que los formularios; TikTok va por su cuenta.
 */
export function ChannelsSettings({ hub }: { hub: boolean }) {
  const [channel, setChannel] = useState<ChannelKey>("whatsapp");
  // Enlaces directos: ?tab=metaLeads (el antiguo) o ?channel=whatsapp|messenger|instagram|tiktok|facebook.
  const params = useSearchParams();
  const asked = params.get("channel");
  const wanted: ChannelKey | null =
    params.get("tab") === "metaLeads" ? "facebook" : KEYS.includes(asked as ChannelKey) ? (asked as ChannelKey) : null;
  useEffect(() => {
    if (wanted) setChannel(wanted);
  }, [wanted]);

  function pick(c: ChannelKey) {
    setChannel(c);
    window.history.replaceState(null, "", `${window.location.pathname}?tab=channels&channel=${c}`);
  }

  const { data: numbers = [] } = useQuery({ queryKey: ["wa-channels"], queryFn: fetchWhatsappChannels });
  const { data: pages = [] } = useQuery({ queryKey: ["meta-pages"], queryFn: fetchMetaPages });
  const { data: tiktok } = useQuery({ queryKey: ["tiktok-accounts"], queryFn: fetchTikTokAccounts });

  const activeNumbers = numbers.filter((n) => n.isActive && n.status === "connected").length;
  const brokenNumbers = numbers.filter((n) => n.status === "error").length;
  const activePages = pages.filter((p) => p.isActive);
  const pendingLeads = pages.reduce((a, p) => a + p.pendingCount, 0);
  const messengerPages = activePages.filter((p) => p.messengerEnabled);
  const instagramPages = activePages.filter((p) => p.instagramEnabled);
  const tiktokAccounts = tiktok?.accounts ?? [];

  const waStatus: Status =
    numbers.length === 0
      ? { tone: "muted", text: "Sin conectar" }
      : brokenNumbers > 0
        ? { tone: "warn", text: `${brokenNumbers} con error` }
        : activeNumbers === 0
          ? { tone: "warn", text: "Ningún número activo" }
          : { tone: "ok", text: plural(activeNumbers, "número activo", "números activos") };
  const fbStatus: Status =
    pages.length === 0
      ? { tone: "muted", text: "Sin conectar" }
      : pendingLeads > 0
        ? { tone: "warn", text: `${plural(pendingLeads, "lead", "leads")} sin teléfono` }
        : { tone: "ok", text: plural(activePages.length, "página conectada", "páginas conectadas") };
  const messagingStatus = (list: typeof pages, instagram: boolean): Status =>
    list.length === 0
      ? activePages.length === 0
        ? { tone: "muted", text: "Sin conectar" }
        : { tone: "muted", text: "Apagado en tus páginas" }
      : list.some((p) => p.messagingError)
        ? { tone: "warn", text: "Revisar" }
        : {
            tone: "ok",
            text:
              list.length === 1
                ? instagram && list[0]!.instagramUsername
                  ? `@${list[0]!.instagramUsername}`
                  : list[0]!.name
                : plural(list.length, "página recibiendo", "páginas recibiendo"),
          };
  const ttStatus: Status =
    tiktokAccounts.length === 0
      ? { tone: "muted", text: tiktok && !tiktok.configured ? "Sin app" : "Sin conectar" }
      : tiktokAccounts.some((a) => a.status !== "connected")
        ? { tone: "warn", text: "Reautorizar" }
        : tiktokAccounts.filter((a) => a.isActive).length === 0
          ? { tone: "muted", text: "Apagado" }
          : {
              tone: "ok",
              text:
                tiktokAccounts.length === 1
                  ? tiktokAccounts[0]!.username
                    ? `@${tiktokAccounts[0]!.username}`
                    : "1 cuenta recibiendo"
                  : plural(tiktokAccounts.filter((a) => a.isActive).length, "cuenta recibiendo", "cuentas recibiendo"),
            };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Canales</h3>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>Por dónde te escriben tus clientes. Todo entra en la misma bandeja.</p>
      </header>

      <div className="ch-picker" role="tablist" aria-label="Canales">
        <ChannelTab kind="wa" name="WhatsApp" status={waStatus} active={channel === "whatsapp"} onClick={() => pick("whatsapp")} />
        <ChannelTab kind="ms" name="Messenger" status={messagingStatus(messengerPages, false)} active={channel === "messenger"} onClick={() => pick("messenger")} />
        <ChannelTab kind="ig" name="Instagram" status={messagingStatus(instagramPages, true)} active={channel === "instagram"} onClick={() => pick("instagram")} />
        <ChannelTab kind="tt" name="TikTok" status={ttStatus} active={channel === "tiktok"} onClick={() => pick("tiktok")} />
        <ChannelTab kind="fb" name="Formularios" status={fbStatus} active={channel === "facebook"} onClick={() => pick("facebook")} />
      </div>

      <div role="tabpanel" data-channel-panel={channel}>
        {channel === "whatsapp" ? (
          <WhatsAppConnect hub={hub} embedded />
        ) : channel === "facebook" ? (
          <MetaLeadsSettings hub={hub} />
        ) : channel === "tiktok" ? (
          <TikTokSettings />
        ) : (
          <MetaMessagingSettings kind={channel} hub={hub} />
        )}
      </div>
    </div>
  );
}

function ChannelTab({
  kind,
  name,
  status,
  active,
  onClick,
}: {
  kind: "wa" | "fb" | "ms" | "ig" | "tt";
  name: string;
  status: Status;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} className="ch-tab" onClick={onClick} data-channel-card={name}>
      <span className={`ch-tab__mark is-${kind}`} aria-hidden="true">
        {kind === "wa" ? (
          <WaIcon />
        ) : kind === "fb" ? (
          <FacebookMark />
        ) : (
          <ChannelMark kind={kind === "ms" ? "messenger" : kind === "ig" ? "instagram" : "tiktok"} size={16} />
        )}
      </span>
      <span className="ch-tab__name">{name}</span>
      <span className={`ch-status is-${status.tone}`}>{status.text}</span>
    </button>
  );
}

function FacebookMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1Z" />
    </svg>
  );
}
