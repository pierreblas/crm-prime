"use client";

import { NavIcon } from "@/components/NavIcons";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { TRIGGER_BY_TYPE } from "./flowShared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmDialog } from "@/lib/confirm";
import type { FlowSummary } from "@crm/shared";
import { deleteFlow, fetchFlows, fetchPipeline } from "@/lib/bff";
import { FlowBuilder } from "./FlowBuilder";

type View = { kind: "list" } | { kind: "edit"; id: string | null };

export function FlowsManager() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ kind: "list" });

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["flows"],
    queryFn: fetchFlows,
  });
  const { data: pipeline } = useQuery({
    queryKey: ["pipeline", "default", "open"],
    queryFn: () => fetchPipeline(),
  });

  const remove = useMutation({
    mutationFn: deleteFlow,
    onSuccess: () => {
      toast.success("Flujo eliminado");
      queryClient.invalidateQueries({ queryKey: ["flows"] });
    },
  });

  if (view.kind === "edit") {
    return (
      <FlowBuilder
        flowId={view.id}
        channels={data?.channels ?? []}
        bots={data?.bots ?? []}
        // Todas las etapas de todos los embudos; con más de uno, el nombre
        // lleva el embudo delante para distinguirlas.
        stages={(pipeline?.stagesAll ?? []).map((s) => ({
          id: s.id,
          name: (pipeline?.pipelines.length ?? 0) > 1 ? `${s.pipelineName} › ${s.name}` : s.name,
        }))}
        agents={data?.agents ?? []}
        flows={data?.flows ?? []}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  const flows = data?.flows ?? [];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <div style={header}>
        <div>
          <h2 style={{ margin: 0 }}>Flujos de conversación</h2>
          <p style={{ color: "var(--muted)", marginTop: 6, marginBottom: 0 }}>
            Automatiza conversaciones con un constructor visual: arrastra bloques,
            conéctalos y define qué responde el bot en cada paso.
          </p>
        </div>
        <button onClick={() => setView({ kind: "edit", id: null })} style={primary}>
          + Nuevo flujo
        </button>
      </div>

      {isPending && <p style={muted}>Cargando…</p>}
      {isError && <p style={{ color: "#ff6b6b" }}>{(error as Error).message}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
        {flows.map((f) => (
          <FlowRow
            key={f.id}
            flow={f}
            onEdit={() => setView({ kind: "edit", id: f.id })}
            onDelete={() => {
              void confirmDialog({
                message: `¿Eliminar el flujo "${f.name}"?`,
                danger: true,
              }).then((ok) => ok && remove.mutate(f.id));
            }}
          />
        ))}
        {!isPending && flows.length === 0 && (
          <div style={empty}>
            <div style={{ color: "var(--muted)", opacity: 0.6 }}>
              <NavIcon name="flow" size={34} />
            </div>
            <p style={muted}>
              Aún no hay flujos. Crea el primero y arrástralo a tu gusto.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FlowRow({
  flow,
  onEdit,
  onDelete,
}: {
  flow: FlowSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={row}>
      <span style={dot(flow.isActive ? "var(--accent)" : "#7a8aa0")} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 15 }}>{flow.name}</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
          <span style={badge("var(--surface-3)")}>
            {TRIGGER_BY_TYPE[flow.triggerType]?.short ?? flow.triggerType}
          </span>
          <span
            style={{
              ...badge(flow.channel ? "#1f5a6f" : "var(--surface-3)"),
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {flow.channel ? (
              <>
                <NavIcon name="whatsapp" size={11} />
                {flow.channel.label ?? flow.channel.displayPhoneNumber}
              </>
            ) : (
              "cualquier número"
            )}
          </span>
          <span style={badge("var(--surface-3)")}>{flow.nodeCount} bloques</span>
          {!flow.isActive && <span style={badge("#5a4a2a")}>inactivo</span>}
        </div>
      </div>
      <button onClick={onEdit} style={ghost}>
        Editar
      </button>
      <button
        onClick={onDelete}
        style={{ ...ghost, color: "#e08a8a", borderColor: "#5a2a2a" }}
      >
        Eliminar
      </button>
    </div>
  );
}

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 16px",
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--panel)",
  boxShadow: "var(--shadow-card)",
};

const empty: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  textAlign: "center",
  padding: "70px 24px",
  border: "1px dashed var(--border)",
  borderRadius: 12,
};

const muted: React.CSSProperties = { color: "var(--muted)", fontSize: 14 };

const primary: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

const ghost: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};

function dot(color: string): React.CSSProperties {
  return { width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 };
}

function badge(bg: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: "#e9f1ff",
  };
}
