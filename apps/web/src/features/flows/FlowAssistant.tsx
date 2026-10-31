"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  FlowAssistantReply,
  FlowAssistantTurn,
  FlowEdge,
  FlowNode,
} from "@crm/shared";
import { askFlowAssistant } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";

// Un turno del chat. La propuesta del asistente se conserva en el mensaje
// para poder aplicarla (o descartarla) sin perder el hilo.
type Turn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      proposal?: { nodes: FlowNode[]; edges: FlowEdge[] };
      warnings?: string[];
      applied?: boolean;
      meta?: { model: string; provider: string };
    };

const EXAMPLES = [
  "Saluda, pregunta el nombre y deriva por precio, soporte o hablar con alguien",
  "Si escribe «catálogo», manda el catálogo y espera 10 minutos antes de preguntar si le interesó",
  "Califica al lead con 3 preguntas y si tiene presupuesto pásalo a un humano",
];

const BLOCK_LABEL: Record<string, string> = {
  start: "Inicio",
  sendMessage: "Enviar mensaje",
  askQuestion: "Preguntar y guardar",
  condition: "Condición",
  action: "Acción",
  delay: "Esperar",
  http: "Petición HTTP",
  assign: "Asignar a agente",
  jumpToFlow: "Ir a otro flujo",
};

export function FlowAssistant({
  flowId,
  nodes,
  edges,
  onApply,
  onClose,
}: {
  flowId: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  onApply: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  const ask = useMutation({
    mutationFn: (prompt: string) => {
      // Solo el hilo de texto va como historial; las propuestas no.
      const history: FlowAssistantTurn[] = turns.map((t) => ({
        role: t.role,
        content: t.content,
      }));
      return askFlowAssistant({ prompt, nodes, edges, history, flowId });
    },
    onSuccess: (reply: FlowAssistantReply) => {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply.message,
          proposal:
            reply.nodes && reply.edges
              ? { nodes: reply.nodes, edges: reply.edges }
              : undefined,
          warnings: reply.warnings,
          meta: { model: reply.model, provider: reply.provider },
        },
      ]);
    },
    onError: (e) => {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: (e as Error).message },
      ]);
    },
  });

  function send(prompt: string) {
    const text = prompt.trim();
    if (!text || ask.isPending) return;
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    ask.mutate(text);
  }

  function apply(index: number) {
    const turn = turns[index];
    if (turn?.role !== "assistant" || !turn.proposal) return;
    onApply(turn.proposal.nodes, turn.proposal.edges);
    setTurns((prev) =>
      prev.map((t, i) =>
        i === index && t.role === "assistant" ? { ...t, applied: true } : t,
      ),
    );
  }

  const isEmptyCanvas =
    nodes.length === 0 || (nodes.length === 1 && nodes[0]?.type === "start");

  return (
    <aside style={panel}>
      <header style={header}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <NavIcon name="bot" size={16} />
          Asistente
        </span>
        <button onClick={onClose} style={closeBtn} title="Cerrar">
          <NavIcon name="x" size={15} />
        </button>
      </header>

      <div ref={scroller} style={thread}>
        {turns.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
            <p style={{ marginTop: 0 }}>
              {isEmptyCanvas
                ? "Describe el flujo que quieres y lo armo con tus bloques."
                : "Puedo modificar el flujo que tienes en el lienzo. Dime qué cambiar."}
            </p>
            <p style={{ marginBottom: 6, color: "var(--text)", fontSize: 12 }}>Ejemplos:</p>
            {EXAMPLES.map((e) => (
              <button key={e} onClick={() => send(e)} style={exampleBtn}>
                {e}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} style={userBubble}>
              {t.content}
            </div>
          ) : (
            <div key={i} style={botBubble}>
              <div style={{ whiteSpace: "pre-wrap" }}>{t.content}</div>

              {t.proposal && (
                <ProposalCard
                  nodes={t.proposal.nodes}
                  applied={!!t.applied}
                  onApply={() => apply(i)}
                />
              )}

              {!!t.warnings?.length && (
                <ul style={warnList}>
                  {t.warnings.map((w, k) => (
                    <li key={k}>{w}</li>
                  ))}
                </ul>
              )}

              {t.meta && t.meta.provider === "fake" && (
                <div style={fakeNote}>
                  Sin IA disponible (sin clave, o la IA incluida llegó a su límite este mes): respuesta
                  simulada. Revisa Ajustes › Inteligencia Artificial.
                </div>
              )}
            </div>
          ),
        )}

        {ask.isPending && <div style={{ ...botBubble, color: "var(--muted)" }}>Pensando…</div>}
      </div>

      <div style={composer}>
        <textarea
          style={textarea}
          rows={3}
          value={draft}
          placeholder="Ej: pregunta el nombre y si dice «precio» manda la lista…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(draft);
          }}
        />
        <button
          onClick={() => send(draft)}
          disabled={!draft.trim() || ask.isPending}
          style={sendBtn}
        >
          {ask.isPending ? "Generando…" : "Enviar"}
        </button>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          Ctrl/⌘ + Enter para enviar
        </span>
      </div>
    </aside>
  );
}

// Resumen de la propuesta: cuántos bloques de cada tipo, y el botón de aplicar.
function ProposalCard({
  nodes,
  applied,
  onApply,
}: {
  nodes: FlowNode[];
  applied: boolean;
  onApply: () => void;
}) {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.type === "start") continue;
    counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
        {nodes.length - 1} bloque{nodes.length - 1 === 1 ? "" : "s"}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
        {[...counts.entries()].map(([type, n]) => (
          <li key={type} style={{ fontSize: 12, display: "flex", gap: 6 }}>
            <span style={bullet} />
            {BLOCK_LABEL[type] ?? type}
            {n > 1 ? ` ×${n}` : ""}
          </li>
        ))}
      </ul>
      <button onClick={onApply} disabled={applied} style={applyBtn(applied)}>
        {applied ? (
          <>
            <NavIcon name="check" size={14} />
            Aplicado
          </>
        ) : (
          "Aplicar al lienzo"
        )}
      </button>
      {applied && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>
          Revisa los bloques y pulsa «Guardar flujo» para conservarlo.
        </div>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  width: 330,
  flexShrink: 0,
  borderLeft: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  background: "var(--panel)",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
  fontSize: 13.5,
};

const closeBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 14,
};

const thread: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minHeight: 0,
};

const userBubble: React.CSSProperties = {
  alignSelf: "flex-end",
  maxWidth: "88%",
  padding: "8px 11px",
  borderRadius: "10px 10px 2px 10px",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontSize: 12.5,
  whiteSpace: "pre-wrap",
};

const botBubble: React.CSSProperties = {
  alignSelf: "flex-start",
  maxWidth: "94%",
  padding: "9px 11px",
  borderRadius: "10px 10px 10px 2px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontSize: 12.5,
  lineHeight: 1.5,
};

const card: React.CSSProperties = {
  marginTop: 9,
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
};

function applyBtn(applied: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 9,
    width: "100%",
    padding: "7px 10px",
    borderRadius: 7,
    border: applied ? "1px solid var(--border)" : "none",
    background: applied ? "transparent" : "var(--accent)",
    color: applied ? "var(--muted)" : "var(--accent-ink)",
    fontWeight: 600,
    fontSize: 12.5,
    cursor: applied ? "default" : "pointer",
  };
}

// Punto que sustituye a la viñeta tipográfica en la lista de bloques.
const bullet: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: 999,
  background: "var(--muted)",
  marginTop: 6,
  flexShrink: 0,
};

const warnList: React.CSSProperties = {
  margin: "9px 0 0",
  paddingLeft: 16,
  fontSize: 11.5,
  color: "#e8d79a",
  display: "grid",
  gap: 3,
};

const fakeNote: React.CSSProperties = {
  marginTop: 9,
  fontSize: 11.5,
  color: "#ffd98a",
};

const exampleBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  marginBottom: 6,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 12,
  cursor: "pointer",
  lineHeight: 1.4,
};

const composer: React.CSSProperties = {
  borderTop: "1px solid var(--border)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 7,
};

const textarea: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 12.5,
  resize: "vertical",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const sendBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 7,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
