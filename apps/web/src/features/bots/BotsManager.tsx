"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmDialog } from "@/lib/confirm";
import type { BotDto } from "@crm/shared";
import { deleteBot, fetchBots } from "@/lib/bff";
import { BotEditor } from "./BotEditor";
import { AgentPlayground } from "./AgentPlayground";
import { AgentSetupWizard } from "./AgentSetupWizard";
import { isGenericPrompt } from "./agentCopy";
import { primaryBtn } from "./styles";
import { softBtn } from "@/components/ui";
import { NavIcon } from "@/components/NavIcons";
import Link from "next/link";
import { resetLabel, useAiStatus } from "@/features/copilot/useAiStatus";

type Selection = { kind: "none" } | { kind: "new" } | { kind: "edit"; id: string };

export function BotsManager() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["bots"],
    queryFn: fetchBots,
  });
  const [sel, setSel] = useState<Selection>({ kind: "none" });
  const [testing, setTesting] = useState<{ id?: string; name?: string } | null>(
    null,
  );
  // Asistente paso a paso: con un agente, lo configura; sin él, crea uno.
  const [wizard, setWizard] = useState<{ bot: BotDto | null } | null>(null);
  // El editor avisa si hay cambios sin guardar; así no se pierden al cambiar de agente.
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);
  const select = (next: Selection) => {
    if (!dirtyRef.current) return setSel(next);
    void confirmDialog({ message: "Tienes cambios sin guardar. ¿Salir sin guardar?", danger: true }).then((ok) => {
      if (ok) {
        dirtyRef.current = false;
        setSel(next);
      }
    });
  };

  const remove = useMutation({
    mutationFn: deleteBot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast.success("Agente eliminado");
      setSel({ kind: "none" });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const bots = data?.bots ?? [];

  // Desde Primeros pasos (/agentes?asistente=1): abre el asistente sobre el
  // agente principal si aún tiene instrucciones genéricas; si no, crea otro.
  // Desde el asistente de bienvenida (/agentes?probar=1): abre el simulador
  // con el agente principal.
  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("probar") === "1") {
      const main = data.bots.find((b) => b.isDefault) ?? data.bots[0];
      if (main) {
        setSel({ kind: "edit", id: main.id });
        setTesting({ id: main.id, name: main.name });
      }
    } else if (params.get("asistente") === "1") {
      const target = data.bots.find((b) => b.isDefault && isGenericPrompt(b.systemPrompt)) ?? null;
      setWizard({ bot: target });
    } else {
      return;
    }
    params.delete("probar");
    params.delete("asistente");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [data]);
  const selectedBot =
    sel.kind === "edit" ? bots.find((b) => b.id === sel.id) ?? null : null;
  const { data: aiStatus } = useAiStatus();

  return (
    <>
    {/* Sin clave de IA no hay agente que valga: que se vea antes de configurar nada. */}
    {aiStatus && !aiStatus.ready && (
      <div className="kb-banner is-warn" role="alert" data-ai-key-banner style={{ maxWidth: 1060, margin: "20px auto -8px" }}>
        <NavIcon name="alert" size={16} />
        {aiStatus.included?.exhausted ? (
          <span className="kb-banner__text">
            <strong>La IA incluida en tu plan llegó a su límite de uso este mes.</strong> Hasta {resetLabel(aiStatus.included)}, los chats en autopilot pasan a Pendientes para tu equipo. Conecta tu clave de IA para seguir ya, o cambia de plan.
          </span>
        ) : (
          <span className="kb-banner__text">
            <strong>Tus agentes no pueden responder: falta la clave de IA.</strong> Hasta que la pongas, los chats en autopilot pasan a Pendientes para tu equipo, sin respuesta automática.
          </span>
        )}
        <Link href="/settings?tab=ai" className="btn btn-primary btn-sm">
          {aiStatus.included?.exhausted ? "Conectar mi clave" : "Configurar la clave"}
        </Link>
      </div>
    )}
    {/* IA de Driony con el cupo lleno o cerca: avisar antes de que el agente deje de atender lo nuevo. */}
    {aiStatus?.ready &&
      aiStatus.source === "included" &&
      aiStatus.included &&
      aiStatus.included.conversations >= aiStatus.included.limit * 0.8 && (
        <div className={`kb-banner${aiStatus.included.full ? " is-warn" : ""}`} role="status" data-ai-included-banner style={{ maxWidth: 1060, margin: "20px auto -8px" }}>
          <NavIcon name={aiStatus.included.full ? "alert" : "sparkles"} size={16} />
          {aiStatus.included.full ? (
            <span className="kb-banner__text">
              <strong>Llegaste a las {aiStatus.included.limit.toLocaleString("es")} conversaciones con IA incluidas este mes.</strong>{" "}
              Tus agentes terminan las que ya atendían; los chats nuevos pasan a Pendientes para tu equipo hasta {resetLabel(aiStatus.included)}.
            </span>
          ) : (
            <span className="kb-banner__text">
              <strong>
                Llevas {aiStatus.included.conversations.toLocaleString("es")} de{" "}
                {aiStatus.included.limit.toLocaleString("es")} conversaciones con IA incluida este mes.
              </strong>{" "}
              Al llegar al cupo, tus agentes terminan las que ya atendían y los chats nuevos pasan a tu equipo. Con tu propia clave no hay cupo.
            </span>
          )}
          <Link href="/settings?tab=ai" className="btn btn-sm">
            Conectar mi clave
          </Link>
        </div>
      )}
    <div style={wrap} className="agents-wrap">
      {/* Lista */}
      <aside style={listCol} className="agents-list" data-tour="agents-list">
        <div style={listHeader}>
          <strong>Agentes</strong>
          <span style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setWizard({ bot: null })}
              style={softBtn}
              title="Arma un agente nuevo respondiendo cinco preguntas"
              data-tour="agents-wizard"
            >
              <NavIcon name="sparkles" size={14} /> Con ayuda
            </button>
            <button onClick={() => select({ kind: "new" })} style={primaryBtn}>
              + Nuevo
            </button>
          </span>
        </div>

        {isPending && <p style={muted}>Cargando…</p>}
        {isError && <p style={{ color: "#ff6b6b" }}>{(error as Error).message}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {bots.map((b) => (
            <BotCard
              key={b.id}
              bot={b}
              active={sel.kind === "edit" && sel.id === b.id}
              onClick={() => select({ kind: "edit", id: b.id })}
            />
          ))}
          {!isPending && bots.length === 0 && (
            <p style={muted}>No hay agentes. Crea el primero con “+ Nuevo”.</p>
          )}
        </div>
      </aside>

      {/* Detalle */}
      <section style={detailCol} className="agents-detail" data-tour="agents-editor">
        {sel.kind === "none" && (
          <div style={empty}>
            <div style={{ color: "var(--muted)", opacity: 0.7 }}>
              <NavIcon name="bot" size={44} />
            </div>
            <p style={muted}>
              Elige un agente para configurarlo, o crea uno nuevo. Puedes tener
              uno para todos tus números o uno distinto por número.
            </p>
            <button
              onClick={() => setWizard({ bot: bots.find((b) => b.isDefault && isGenericPrompt(b.systemPrompt)) ?? null })}
              style={primaryBtn}
            >
              <NavIcon name="sparkles" size={15} />
              Armar mi agente paso a paso
            </button>
            <button onClick={() => setTesting({})} style={softBtn} data-tour="agents-try">
              <NavIcon name="flask" size={15} />
              Probar el agente principal
            </button>
          </div>
        )}

        {sel.kind === "new" && data && (
          <>
            <h2 style={detailTitle}>Nuevo agente</h2>
            <BotEditor
              bot={null}
              availableTools={data.availableTools}
              channels={data.channels}
              onSaved={(b) => {
                dirtyRef.current = false;
                setSel({ kind: "edit", id: b.id });
              }}
              onCancel={() => setSel({ kind: "none" })}
              onDirtyChange={onDirtyChange}
              onWizard={() => setWizard({ bot: null })}
            />
          </>
        )}

        {sel.kind === "edit" && selectedBot && data && (
          <>
            <div style={detailHead}>
              <h2 style={detailTitle}>{selectedBot.name}</h2>
              {selectedBot.isDefault && (
                <span style={badge("var(--surface-3)")} title="Atiende los números que no tienen un agente propio. No se puede eliminar.">
                  Principal
                </span>
              )}
              <div style={{ flex: 1 }} />
              <button
                onClick={() =>
                  setTesting({ id: selectedBot.id, name: selectedBot.name })
                }
                style={softBtn}
                data-tour="agents-try"
              >
                <NavIcon name="flask" size={15} />
                Probar conversación
              </button>
            </div>
            <BotEditor
              key={selectedBot.id}
              bot={selectedBot}
              availableTools={data.availableTools}
              channels={data.channels}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ["bots"] })}
              onCancel={() => setSel({ kind: "none" })}
              onDirtyChange={onDirtyChange}
              onWizard={() => setWizard({ bot: selectedBot })}
              onDeleted={() => {
                void confirmDialog({
                  message: `¿Eliminar el agente "${selectedBot.name}"?`,
                  danger: true,
                }).then((ok) => ok && remove.mutate(selectedBot.id));
              }}
            />
          </>
        )}
      </section>

      {wizard && data && (
        <AgentSetupWizard
          bot={wizard.bot}
          availableTools={data.availableTools}
          onClose={() => setWizard(null)}
          onDone={(b, action) => {
            setWizard(null);
            dirtyRef.current = false;
            setSel({ kind: "edit", id: b.id });
            if (action === "test") setTesting({ id: b.id, name: b.name });
          }}
        />
      )}

      {testing && (
        <AgentPlayground
          botId={testing.id}
          botName={testing.name}
          onClose={() => setTesting(null)}
        />
      )}
    </div>
    </>
  );
}

function BotCard({
  bot,
  active,
  onClick,
}: {
  bot: BotDto;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={card(active)}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={dot(bot.isActive ? "var(--accent)" : "#7a8aa0")} />
        <strong style={{ fontSize: 14 }}>{bot.name}</strong>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        {!bot.isActive
          ? "Pausado: no responde"
          : bot.autopilotByDefault
            ? "Responde solo"
            : "Te sugiere respuestas"}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <span style={badge(bot.channel ? "rgba(200,255,0,.16)" : "var(--surface-3)")}>
          <NavIcon name="phone" size={10} />
          {bot.channel ? bot.channel.label ?? bot.channel.displayPhoneNumber : "Todos los números"}
        </span>
        {bot.welcomeEnabled && <span style={badge("var(--surface-3)")}>Saluda</span>}
        {bot.businessHoursEnabled && <span style={badge("var(--surface-3)")}>Con horario</span>}
        {bot.keywordTriggers.length > 0 && (
          <span style={badge("var(--surface-3)")}>
            {bot.keywordTriggers.length} {bot.keywordTriggers.length > 1 ? "palabras clave" : "palabra clave"}
          </span>
        )}
      </div>
    </button>
  );
}

const wrap: React.CSSProperties = {
  display: "flex",
  gap: 18,
  padding: 20,
  maxWidth: 1100,
  margin: "0 auto",
  alignItems: "flex-start",
};

const listCol: React.CSSProperties = {
  width: 300,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  position: "sticky",
  top: 20,
};

const detailCol: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const listHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const detailHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 14,
};

const detailTitle: React.CSSProperties = { margin: 0, fontSize: 20 };

const empty: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  textAlign: "center",
  padding: "80px 24px",
  border: "1px dashed var(--border)",
  borderRadius: 12,
};

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14 };

function card(active: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    padding: 12,
    borderRadius: 10,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-soft)" : "var(--panel)",
    cursor: "pointer",
    color: "var(--text)",
  };
}

function dot(color: string): React.CSSProperties {
  return { width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 };
}

function badge(bg: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: "#e9f1ff",
  };
}
