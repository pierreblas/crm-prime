"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BotDto, FlowSummary, PipelineSummaryDto, StageDto, WhatsappChannel } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { AutomationsEditor, hint, ROLE_OF, StageConfigDialog, stageRow, TRIGGER_LABEL, type StageRole } from "@/features/pipeline/StageEditors";
import {
  createPipeline,
  createStage,
  deletePipeline,
  deleteStage,
  fetchBots,
  fetchFlows,
  fetchPipeline,
  fetchWhatsappChannels,
  reorderPipelines,
  reorderStages,
  updatePipeline,
  updateStage,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { card, dangerBtn, ghostBtn, input, label, primaryBtn, smBtn } from "@/components/ui";

/**
 * Ajustes › Embudos y etapas. Varios embudos por empresa (Ventas, Soporte…),
 * cada uno con sus etapas y con su regla de entrada automática desde
 * WhatsApp: qué números entran, en qué etapa aparecen y cuántos días esperar
 * antes de descartar lo que nadie atiende.
 */
export function PipelinesSettings() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["pipeline", "settings"],
    queryFn: () => fetchPipeline(),
  });
  const { data: channels = [] } = useQuery({
    queryKey: ["wa-channels"],
    queryFn: fetchWhatsappChannels,
  });
  const { data: botsRes } = useQuery({ queryKey: ["bots"], queryFn: fetchBots });
  const bots = botsRes?.bots ?? [];
  const { data: flowsRes } = useQuery({ queryKey: ["flows"], queryFn: fetchFlows });
  const flows = flowsRes?.flows ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pipeline"] });

  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const create = useMutation({
    mutationFn: () => createPipeline({ name: newName.trim() }),
    onSuccess: (p) => {
      setNewName("");
      setOpenId(p.id);
      refresh();
      toast.success(`Embudo «${p.name}» creado`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const reorder = useMutation({
    mutationFn: reorderPipelines,
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });

  const pipelines = data?.pipelines ?? [];
  const move = (i: number, dir: -1 | 1) => {
    const ids = pipelines.map((p) => p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <header>
        <h3 style={{ margin: "0 0 4px" }}>Embudos y etapas</h3>
        <p style={muted}>
          Un embudo por proceso: ventas, soporte, renovaciones… Cada uno tiene
          sus etapas y decide qué conversaciones de WhatsApp entran solas.
        </p>
      </header>

      <div style={{ ...card, display: "flex", gap: 8, alignItems: "center", padding: 12 }}>
        <input
          style={{ ...input, flex: 1 }}
          value={newName}
          placeholder="Nuevo embudo (ej. Soporte)"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && newName.trim() && create.mutate()}
        />
        <button
          onClick={() => create.mutate()}
          disabled={!newName.trim() || create.isPending}
          style={primaryBtn}
        >
          Añadir embudo
        </button>
      </div>

      {isPending && <p style={muted}>Cargando…</p>}
      {pipelines.map((p, i) => (
        <PipelineCard
          key={p.id}
          pipeline={p}
          stages={(data?.stagesAll ?? []).filter((s) => s.pipelineId === p.id)}
          channels={channels.filter((c) => c.source !== "env")}
          bots={bots}
          flows={flows}
          expanded={openId === p.id}
          onToggle={() => setOpenId(openId === p.id ? null : p.id)}
          onRefresh={refresh}
          first={i === 0}
          last={i === pipelines.length - 1}
          onUp={() => move(i, -1)}
          onDown={() => move(i, 1)}
          onlyOne={pipelines.length === 1}
        />
      ))}
    </div>
  );
}

function PipelineCard({
  pipeline,
  stages,
  channels,
  bots,
  flows,
  expanded,
  onToggle,
  onRefresh,
  first,
  last,
  onUp,
  onDown,
  onlyOne,
}: {
  pipeline: PipelineSummaryDto;
  stages: StageDto[];
  channels: WhatsappChannel[];
  bots: BotDto[];
  flows: FlowSummary[];
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onlyOne: boolean;
}) {
  const [name, setName] = useState(pipeline.name);
  const [inboundEnabled, setInboundEnabled] = useState(pipeline.inboundEnabled);
  const [inboundStageId, setInboundStageId] = useState(pipeline.inboundStageId ?? "");
  const [days, setDays] = useState(String(pipeline.inboundDiscardDays));
  const [channelIds, setChannelIds] = useState<string[]>(pipeline.channelIds);
  const [botId, setBotId] = useState(pipeline.botId ?? "");

  // Si el servidor cambia (otro guardado, otra pestaña), se resincroniza.
  useEffect(() => {
    setName(pipeline.name);
    setInboundEnabled(pipeline.inboundEnabled);
    setInboundStageId(pipeline.inboundStageId ?? "");
    setDays(String(pipeline.inboundDiscardDays));
    setChannelIds(pipeline.channelIds);
    setBotId(pipeline.botId ?? "");
  }, [pipeline]);

  const dirty =
    name.trim() !== pipeline.name ||
    inboundEnabled !== pipeline.inboundEnabled ||
    (inboundStageId || null) !== pipeline.inboundStageId ||
    Number(days) !== pipeline.inboundDiscardDays ||
    (botId || null) !== pipeline.botId ||
    channelIds.slice().sort().join(",") !== pipeline.channelIds.slice().sort().join(",");

  const save = useMutation({
    mutationFn: () =>
      updatePipeline(pipeline.id, {
        name: name.trim() || pipeline.name,
        inboundEnabled,
        inboundStageId: inboundStageId || null,
        inboundDiscardDays: Math.max(0, Math.min(365, Number(days) || 0)),
        channelIds,
        botId: botId || null,
      }),
    onSuccess: () => {
      onRefresh();
      toast.success("Embudo guardado");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const makeDefault = useMutation({
    mutationFn: () => updatePipeline(pipeline.id, { isDefault: true }),
    onSuccess: onRefresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => deletePipeline(pipeline.id),
    onSuccess: () => {
      onRefresh();
      toast.success("Embudo eliminado");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const entryStage = stages.find((s) => s.id === pipeline.inboundStageId) ?? stages[0];

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={head}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button onClick={onUp} disabled={first} style={arrowBtn} title="Subir">
            <NavIcon name="arrow-up" size={12} />
          </button>
          <button onClick={onDown} disabled={last} style={arrowBtn} title="Bajar">
            <NavIcon name="arrow-down" size={12} />
          </button>
        </div>
        <button onClick={onToggle} style={titleBtn}>
          <span style={{ color: "var(--accent)", display: "inline-flex" }}>
            <NavIcon name="pipeline" size={16} />
          </span>
          <strong style={{ fontSize: 15 }}>{pipeline.name}</strong>
          {pipeline.isDefault && <span style={badge("#1f4d38")}>predeterminado</span>}
          {pipeline.inboundEnabled && (
            <span style={badge("#2c4b7a")} title="Las conversaciones nuevas de WhatsApp crean una oportunidad aquí">
              entrada automática
            </span>
          )}
          <span style={{ color: "var(--muted)", fontSize: 12.5, marginLeft: 4 }}>
            {pipeline.stageCount} etapas · {pipeline.openDeals} abiertas
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ color: "var(--muted)", display: "inline-flex", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            <NavIcon name="arrow-down" size={14} />
          </span>
        </button>
      </div>

      {expanded && (
        <div style={{ padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Nombre y predeterminado */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <span style={label}>Nombre</span>
              <input style={input} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {!pipeline.isDefault && (
              <button
                onClick={() => makeDefault.mutate()}
                disabled={makeDefault.isPending}
                style={ghostBtn}
                title="Los números sin embudo asignado y el agente de IA usan el predeterminado"
              >
                Hacer predeterminado
              </button>
            )}
          </div>

          {/* Etapas */}
          <section>
            <div style={sectionTitle}>Etapas</div>
            <StagesEditor pipelineId={pipeline.id} stages={stages} flows={flows} onChanged={onRefresh} />
          </section>

          {/* Agente de IA del embudo */}
          <section>
            <div style={sectionTitle}>Agente de IA</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 260px" }}>
                <span style={label}>Quién responde a los contactos de este embudo</span>
                <select style={input} value={botId} onChange={(e) => setBotId(e.target.value)}>
                  <option value="">Heredar: el agente del número o el predeterminado</option>
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {!b.isActive ? " · apagado" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={hint}>
              Para que el agente clasifique leads, marca qué etapa es «Potencial», «Ganada» y «Perdida» (columna
              «Rol») y dale la acción <code>mark_lead</code>. Lo que pasa en cada etapa (bots, mensajes, avisos) se
              configura con sus <strong>automatizaciones</strong>, y lo que se le cuenta a Meta de los chats que vinieron
              de un anuncio, con sus <strong>conversiones</strong>: pulsa el engranaje de la etapa (aquí o en el tablero).
            </div>
          </section>

          {/* Entrada automática */}
          <section>
            <div style={sectionTitle}>Entrada automática desde WhatsApp</div>
            <label style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: "pointer", fontSize: 14 }}>
              <input
                type="checkbox"
                checked={inboundEnabled}
                onChange={(e) => setInboundEnabled(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                Crear una oportunidad al primer mensaje de WhatsApp
                <div style={hint}>
                  Cuando escribe un contacto sin ninguna oportunidad en curso, aparece
                  en la etapa de entrada, asignada al vendedor de su fuente con menos
                  carga. Si ya está ganada o perdida, se abre una nueva.
                </div>
              </span>
            </label>

            {inboundEnabled && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                <div style={{ flex: "1 1 200px" }}>
                  <span style={label}>Etapa de entrada</span>
                  <select style={input} value={inboundStageId} onChange={(e) => setInboundStageId(e.target.value)}>
                    <option value="">Primera etapa ({stages[0]?.name ?? "—"})</option>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "0 1 220px" }}>
                  <span style={label}>Descartar si no responde en</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      style={{ ...input, width: 90 }}
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    />
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>días (0 = nunca)</span>
                  </div>
                </div>
                <div style={{ flex: "1 1 100%" }}>
                  <span style={label}>Números de WhatsApp que entran a este embudo</span>
                  {channels.length === 0 ? (
                    <div style={hint}>Aún no hay números conectados. Los que conectes entrarán al embudo predeterminado.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {channels.map((c) => {
                        const checked = channelIds.includes(c.id);
                        return (
                          <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setChannelIds((ids) =>
                                  e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id),
                                )
                              }
                            />
                            {c.label ?? c.displayPhoneNumber ?? c.phoneNumberId}
                            {c.displayPhoneNumber && c.label && (
                              <span style={{ color: "var(--muted)" }}>{c.displayPhoneNumber}</span>
                            )}
                          </label>
                        );
                      })}
                      <div style={hint}>
                        Un número sin embudo entra al predeterminado{pipeline.isDefault ? " (este)" : ""}.
                      </div>
                    </div>
                  )}
                </div>
                {entryStage && (
                  <div style={{ ...hint, flex: "1 1 100%", color: "var(--accent-text)" }}>
                    Ahora mismo: las conversaciones nuevas aparecen en «{entryStage.name}»
                    {Number(days) > 0 ? ` y se descartan solas tras ${days} día${days === "1" ? "" : "s"} sin respuesta` : ""}.
                    Si el contacto vuelve a escribir, la oportunidad descartada regresa.
                  </div>
                )}
              </div>
            )}
          </section>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending}
              style={{ ...primaryBtn, opacity: dirty ? 1 : 0.5 }}
            >
              {save.isPending ? "Guardando…" : "Guardar cambios"}
            </button>
            {dirty && <span style={hint}>Hay cambios sin guardar.</span>}
            <span style={{ flex: 1 }} />
            {!pipeline.isDefault && !onlyOne && (
              <button
                onClick={() => {
                  void confirmDialog({
                    title: "Eliminar embudo",
                    message: `¿Eliminar «${pipeline.name}» y sus etapas? Solo se puede si no tiene oportunidades.`,
                    confirmLabel: "Eliminar",
                    danger: true,
                  }).then((ok) => ok && remove.mutate());
                }}
                style={{ ...dangerBtn, ...smBtn }}
              >
                Eliminar embudo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Etapas de un embudo: renombrar, ordenar, añadir, quitar. */
function StagesEditor({
  pipelineId,
  stages,
  flows,
  onChanged,
}: {
  pipelineId: string;
  stages: StageDto[];
  flows: FlowSummary[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  // Etapas con su lista de automatizaciones desplegada.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Etapa con el diálogo «Configurar etapa» abierto (rol, conversiones de Meta, automatizaciones).
  const [config, setConfig] = useState<string | null>(null);
  const configStage = config ? stages.find((s) => s.id === config) : undefined;
  const create = useMutation({
    mutationFn: () => createStage({ name: name.trim(), isWon: false, isLost: false, pipelineId }),
    onSuccess: () => {
      setName("");
      onChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateStage(id, { name }),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const flag = useMutation({
    mutationFn: ({ id, role }: { id: string; role: StageRole }) =>
      updateStage(id, { isWon: role === "won", isLost: role === "lost", isQualified: role === "qualified" }),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: deleteStage,
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const reorder = useMutation({
    mutationFn: reorderStages,
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const move = (i: number, dir: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Cabecera de columnas: solo donde las filas caben en una línea. */}
      <div className="ps-stage-head" style={{ ...stageRow, color: "var(--muted)", fontSize: 12, fontWeight: 600, paddingLeft: 32, marginBottom: 2 }}>
        <span style={{ flex: 1 }}>Etapa</span>
        <span style={{ width: 160 }}>Rol</span>
        <span style={{ width: 200 }}>Automatizaciones</span>
        <span style={{ width: 32 }} />
        <span style={{ width: 32 }} />
      </div>
      {stages.map((s, i) => {
        const n = s.automations.length;
        const isOpen = open.has(s.id);
        const nc = s.conversionEvents.length;
        return (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={stageRow}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button onClick={() => move(i, -1)} disabled={i === 0} style={arrowBtn} title="Subir">
                  <NavIcon name="arrow-up" size={12} />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === stages.length - 1} style={arrowBtn} title="Bajar">
                  <NavIcon name="arrow-down" size={12} />
                </button>
              </div>
              <input
                style={{ ...input, flex: 1, minWidth: 160 }}
                defaultValue={s.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== s.name) rename.mutate({ id: s.id, name: v });
                }}
              />
              <select
                style={{ ...input, width: 160, ...(ROLE_OF(s) === "won" ? { color: "#7ee2a8" } : ROLE_OF(s) === "lost" ? { color: "#e08a8a" } : ROLE_OF(s) === "qualified" ? { color: "#ffd98a" } : {}) }}
                value={ROLE_OF(s)}
                onChange={(e) => flag.mutate({ id: s.id, role: e.target.value as StageRole })}
                title="Rol de la etapa: a dónde manda el agente a los potenciales, las compras y los perdidos"
                aria-label={`Rol de ${s.name}`}
              >
                <option value="">Sin rol</option>
                <option value="qualified">Potencial</option>
                <option value="won">Ganada (compra)</option>
                <option value="lost">Perdida</option>
              </select>
              <button
                onClick={() => toggle(s.id)}
                style={{ ...ghostBtn, width: 200, justifyContent: "flex-start", gap: 6, ...(n ? { color: "var(--accent-text)", borderColor: "var(--accent)" } : {}) }}
                aria-expanded={isOpen}
                aria-label={`Automatizaciones de ${s.name}`}
                title={n ? s.automations.map((a) => `${TRIGGER_LABEL[a.trigger]} → ${a.flowName}`).join("\n") : "Qué pasa cuando una oportunidad está en esta etapa"}
              >
                <NavIcon name="zap" size={13} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {n === 0 ? "Añadir" : n === 1 ? "1 automatización" : `${n} automatizaciones`}
                </span>
                <span style={{ marginLeft: "auto", display: "inline-flex", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
                  <NavIcon name="arrow-down" size={11} />
                </span>
              </button>
              <button
                onClick={() => setConfig(s.id)}
                style={{ ...ghostBtn, ...smBtn, padding: "6px 8px", ...(nc ? { color: "var(--accent-text)", borderColor: "var(--accent)" } : {}) }}
                aria-label={`Configurar etapa ${s.name}`}
                title={`Configurar etapa: rol, conversiones de Meta${nc ? ` (${nc})` : ""} y automatizaciones`}
              >
                <NavIcon name="settings" size={13} />
              </button>
              <button
                onClick={() => {
                  void confirmDialog({
                    message: `¿Eliminar la etapa «${s.name}»? Solo se puede si no tiene oportunidades.`,
                    danger: true,
                  }).then((ok) => ok && remove.mutate(s.id));
                }}
                style={{ ...dangerBtn, ...smBtn, padding: "6px 8px" }}
                title="Eliminar etapa"
              >
                <NavIcon name="x" size={13} />
              </button>
            </div>
            {isOpen && <AutomationsEditor stage={s} flows={flows} onChanged={onChanged} />}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <input
          style={{ ...input, flex: 1 }}
          value={name}
          placeholder="Nueva etapa (ej. Negociación)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()}
        />
        <button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending} style={{ ...ghostBtn }}>
          + Añadir etapa
        </button>
      </div>
      {configStage && <StageConfigDialog stage={configStage} onClose={() => setConfig(null)} onChanged={onChanged} />}
    </div>
  );
}

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14, marginTop: 0 };
const sectionTitle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 };

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px 10px 10px",
};

const titleBtn: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "6px 8px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
};

const arrowBtn: React.CSSProperties = {
  width: 24,
  height: 18,
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

function badge(bg: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: "#eaf2ff",
    whiteSpace: "nowrap",
  };
}
