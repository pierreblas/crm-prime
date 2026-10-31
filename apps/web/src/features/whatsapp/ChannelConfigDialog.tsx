"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WhatsappChannel } from "@crm/shared";
import { fetchBots, fetchFlows, fetchPipeline, updateWhatsappChannel } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { toast } from "@/lib/toast";

/**
 * Qué pasa cuando alguien escribe a este número: cómo se llama, a qué embudo
 * entra y qué agente lo atiende. Es la misma información que se reparte por
 * Ajustes › Embudos y por el editor de agentes, vista desde el número, que es
 * donde uno se lo pregunta.
 */
export function ChannelConfigDialog({
  channel,
  onClose,
}: {
  channel: WhatsappChannel;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const routing = useChannelRouting();
  const pipelines = routing.pipelines;
  const bots = routing.bots.filter((b) => b.isActive || b.id === channel.bot?.id);

  const [label, setLabel] = useState(channel.label ?? "");
  const [pipelineId, setPipelineId] = useState(channel.pipelineId ?? "");
  const [botId, setBotId] = useState(channel.bot?.id ?? "");

  useEffect(() => {
    setLabel(channel.label ?? "");
    setPipelineId(channel.pipelineId ?? "");
    setBotId(channel.bot?.id ?? "");
  }, [channel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const chosenPipeline = pipelines.find((p) => p.id === (pipelineId || defaultPipeline?.id));
  const entryStage = chosenPipeline
    ? routing.stageName(chosenPipeline.inboundStageId) ?? routing.firstStageName(chosenPipeline.id)
    : null;
  const defaultBot = bots.find((b) => b.isDefault);
  const chosenBot = bots.find((b) => b.id === botId);
  // El agente elegido atiende hoy otro número: avisar de que cambia de sitio.
  const movesFrom = chosenBot?.channelId && chosenBot.channelId !== channel.id ? routing.channelName(chosenBot.channelId) : null;
  const flows = routing.flowsOf(channel.id);

  const dirty =
    label.trim() !== (channel.label ?? "") ||
    (pipelineId || null) !== channel.pipelineId ||
    (botId || null) !== (channel.bot?.id ?? null);

  const save = useMutation({
    mutationFn: () =>
      updateWhatsappChannel(channel.id, {
        label: label.trim() || null,
        pipelineId: pipelineId || null,
        botId: botId || null,
      }),
    onSuccess: (channels) => {
      queryClient.setQueryData(["wa-channels"], channels);
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast.success("Número configurado");
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const title = channel.label || channel.displayPhoneNumber || channel.phoneNumberId;

  return (
    <>
      <div style={backdrop} onClick={onClose} />
      <div style={modal} role="dialog" aria-modal="true" aria-label="Configurar número">
        <header style={head}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Configurar número</div>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
              {title}
              {channel.displayPhoneNumber && channel.label ? ` · ${channel.displayPhoneNumber}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} className="cp-iconbtn" title="Cerrar (Esc)" aria-label="Cerrar">
            <NavIcon name="x" size={16} />
          </button>
        </header>

        <form
          style={body}
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) save.mutate();
          }}
        >
          <label style={group}>
            <span style={labelStyle}>Alias</span>
            <input
              className="field"
              value={label}
              maxLength={60}
              placeholder="Ventas, Soporte, Tienda centro…"
              onChange={(e) => setLabel(e.target.value)}
            />
            <span style={hint}>Así verás el número en la bandeja y en los filtros.</span>
          </label>

          <label style={group}>
            <span style={labelStyle}>Embudo de entrada</span>
            <select className="field" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
              <option value="">
                {defaultPipeline ? `El predeterminado (${defaultPipeline.name})` : "El predeterminado"}
              </option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault ? " · predeterminado" : ""}
                </option>
              ))}
            </select>
            {chosenPipeline && chosenPipeline.inboundEnabled ? (
              <span style={hint}>
                Cada contacto nuevo que escriba aquí aparece como oportunidad en <strong>{chosenPipeline.name}</strong>
                {entryStage ? (
                  <>
                    , etapa <strong>{entryStage}</strong>
                  </>
                ) : null}
                .
              </span>
            ) : chosenPipeline ? (
              <span style={{ ...hint, color: "var(--warning)" }}>
                Este embudo tiene apagada la entrada automática: las conversaciones llegan a la bandeja pero no crean
                oportunidad.{" "}
                <Link href="/settings?tab=stages" style={link}>
                  Ajustes › Embudos
                </Link>
              </span>
            ) : null}
          </label>

          <label style={group}>
            <span style={labelStyle}>Agente de IA</span>
            <select className="field" value={botId} onChange={(e) => setBotId(e.target.value)}>
              <option value="">{defaultBot ? `El predeterminado (${defaultBot.name})` : "Ninguno (sin agente predeterminado)"}</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.isDefault ? " · predeterminado" : ""}
                  {!b.isActive ? " · apagado" : ""}
                </option>
              ))}
            </select>
            <span style={hint}>
              {movesFrom ? (
                <>
                  <strong>{chosenBot?.name}</strong> atiende ahora «{movesFrom}»; al guardar pasará a este número.
                </>
              ) : chosenBot ? (
                <>Responde solo en este número; el resto sigue con el predeterminado.</>
              ) : (
                <>Un agente atiende un solo número. Sin elegir ninguno, responde el predeterminado de la empresa.</>
              )}{" "}
              <Link href="/agentes" style={link}>
                Ver agentes
              </Link>
            </span>
          </label>

          <div style={group}>
            <span style={labelStyle}>Flujos</span>
            <span style={hint}>
              {flows.length === 0
                ? "Ningún flujo escucha solo este número; los flujos sin número responden en todos."
                : flows.length === 1
                  ? `1 flujo escucha este número: ${flows[0]!.name}.`
                  : `${flows.length} flujos escuchan este número: ${flows.map((f) => f.name).join(", ")}.`}{" "}
              <Link href="/flows" style={link}>
                Ver flujos
              </Link>
            </span>
          </div>

          <footer style={foot}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={!dirty || save.isPending}>
              {save.isPending ? "Guardando…" : "Guardar"}
            </button>
          </footer>
        </form>
      </div>
    </>
  );
}

/**
 * Lo que hace falta para explicar un número: embudos (con sus etapas),
 * agentes y flujos. Lo usan la fila del número y el diálogo.
 */
export function useChannelRouting() {
  const { data: board } = useQuery({ queryKey: ["pipeline", "default", "open"], queryFn: () => fetchPipeline() });
  const { data: botsRes } = useQuery({ queryKey: ["bots"], queryFn: fetchBots });
  const { data: flowsRes } = useQuery({ queryKey: ["flows"], queryFn: fetchFlows });
  const pipelines = useMemo(() => board?.pipelines ?? [], [board]);
  const stages = useMemo(() => board?.stagesAll ?? [], [board]);
  const bots = useMemo(() => botsRes?.bots ?? [], [botsRes]);
  const flows = useMemo(() => flowsRes?.flows ?? [], [flowsRes]);
  const channels = useMemo(() => botsRes?.channels ?? [], [botsRes]);

  const stageName = (id: string | null) => (id ? (stages.find((s) => s.id === id)?.name ?? null) : null);
  const firstStageName = (pipelineId: string) => stages.find((s) => s.pipelineId === pipelineId)?.name ?? null;
  const channelName = (id: string) => {
    const c = channels.find((x) => x.id === id);
    return c ? (c.label || c.displayPhoneNumber || "otro número") : "otro número";
  };
  const flowsOf = (channelId: string) => flows.filter((f) => f.channel?.id === channelId);

  /** Resumen en palabras para la fila del número. */
  const describe = (ch: WhatsappChannel) => {
    const p = ch.pipelineId ? pipelines.find((x) => x.id === ch.pipelineId) : null;
    const def = pipelines.find((x) => x.isDefault);
    const defBot = bots.find((b) => b.isDefault);
    return {
      pipeline: p ? p.name : def ? `${def.name} (predeterminado)` : "Embudo predeterminado",
      bot: ch.bot ? ch.bot.name : defBot ? `${defBot.name} (predeterminado)` : "Sin agente",
      flows: flowsOf(ch.id).length,
    };
  };

  return { pipelines, stages, bots, flows, stageName, firstStageName, channelName, flowsOf, describe };
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(3, 5, 5, 0.55)",
  backdropFilter: "blur(2px)",
  zIndex: 1060,
};

const modal: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(520px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 32px)",
  display: "flex",
  flexDirection: "column",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  boxShadow: "var(--shadow-overlay)",
  zIndex: 1061,
};

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 18px",
  borderBottom: "1px solid var(--border)",
};

const body: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: 18,
  overflowY: "auto",
};

const group: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--muted)",
};

const hint: React.CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--muted)",
};

const link: React.CSSProperties = {
  color: "var(--accent-text)",
  textDecoration: "underline",
};

const foot: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 4,
};
