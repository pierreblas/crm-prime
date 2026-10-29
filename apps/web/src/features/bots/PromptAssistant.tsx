"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import type {
  PromptAssistantReply,
  PromptAssistantTarget,
  PromptAssistantTurn,
} from "@crm/shared";
import { askPromptAssistant } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { ghostBtn, input as inputStyle, primaryBtn, smBtn } from "@/components/ui";
import { toast } from "@/lib/toast";

// Un turno del chat. La propuesta se guarda en el propio mensaje para poder
// aplicarla (o ignorarla) sin perder el hilo.
type Turn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      proposal?: string;
      applied?: boolean;
      meta?: { model: string; provider: string };
    };

const GOALS = [
  { value: "vender", label: "Vender y cerrar la compra" },
  { value: "calificar", label: "Calificar y agendar una cita o visita" },
  { value: "soporte", label: "Resolver dudas y dar soporte" },
  { value: "datos", label: "Captar datos para que un vendedor llame" },
] as const;

const TONES = [
  { value: "cercano", label: "Cercano y profesional (de tú)" },
  { value: "juvenil", label: "Juvenil y directo" },
  { value: "formal", label: "Formal (de usted)" },
  { value: "divertido", label: "Divertido, con emojis" },
] as const;

// Atajos cuando ya hay texto en el campo: ajustes típicos en un clic.
const TWEAKS = [
  "Mejora el texto actual: más claro, más concreto y mejor estructurado",
  "Hazlo más corto sin perder lo importante",
  "Que sea más vendedor: que lleve la conversación al cierre",
  "Hazlo más formal, tratando al cliente de usted",
  "Añade dos ejemplos de conversación que muestren el tono",
];

// Ejemplos para campos que no son las instrucciones.
const EXAMPLES: Record<Exclude<PromptAssistantTarget, "systemPrompt">, string[]> = {
  welcomeMessage: [
    "Tienda de ropa deportiva, tono juvenil, que pregunte qué busca",
    "Clínica dental, tono formal, que pida nombre y motivo de la consulta",
    "Inmobiliaria, cercano, que pregunte zona y presupuesto",
  ],
  outOfHoursMessage: [
    "Atendemos de lunes a viernes de 9 a 18, que deje su consulta",
    "Restaurante: fuera de horario, que deje reserva y le confirmamos por la mañana",
    "Soporte técnico: urgencias al número de guardia, el resto mañana",
  ],
  quickReply: [
    "Respuesta a «¿hacen envíos?»: sí, a todo el país, 2 a 4 días",
    "Cierre: confirmar pedido y pedir dirección de entrega",
    "Seguimiento amable a quien no respondió en 2 días",
  ],
  free: [
    "Guion de 5 mensajes para vender un plan de internet",
    "Respuesta a la objeción «está caro»",
    "Mensaje de seguimiento para un presupuesto enviado hace una semana",
  ],
};

export function PromptAssistant({
  target,
  title,
  current,
  botName,
  enabledTools,
  onApply,
  onClose,
}: {
  target: PromptAssistantTarget;
  /** Nombre del campo, para la cabecera. */
  title: string;
  /** Texto que hay ahora en el campo. */
  current: string;
  botName: string;
  enabledTools: string[];
  onApply: (text: string) => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ask = useMutation({
    mutationFn: (prompt: string) => {
      const history: PromptAssistantTurn[] = turns.map((t) => ({
        role: t.role,
        content: t.content,
      }));
      return askPromptAssistant({
        prompt,
        target,
        current,
        botName: botName.trim() || null,
        enabledTools,
        history,
      });
    },
    onSuccess: (reply: PromptAssistantReply) => {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: reply.message,
          proposal: reply.proposal ?? undefined,
          meta: { model: reply.model, provider: reply.provider },
        },
      ]);
    },
    onError: (e) => {
      setTurns((prev) => [...prev, { role: "assistant", content: (e as Error).message }]);
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
    onApply(turn.proposal);
    setTurns((prev) =>
      prev.map((t, i) => (i === index && t.role === "assistant" ? { ...t, applied: true } : t)),
    );
  }

  const hasCurrent = current.trim().length > 0;

  // Se monta en <body> con un portal: dentro del editor quedaría bajo la
  // cabecera de la app, que forma su propio contexto de apilamiento.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <>
      <div style={backdrop} onClick={onClose} />
      <aside style={drawer} role="dialog" aria-label="Asistente de redacción">
        <header style={header}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <NavIcon name="sparkles" size={16} />
              Asistente de redacción
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {title} · propone, tú decides
            </div>
          </div>
          <button onClick={onClose} style={{ ...ghostBtn, padding: "6px 8px" }} title="Cerrar (Esc)">
            <NavIcon name="x" size={16} />
          </button>
        </header>

        <div ref={scroller} style={thread}>
          {turns.length === 0 &&
            (target === "systemPrompt" ? (
              <StarterForm hasCurrent={hasCurrent} onSubmit={send} />
            ) : (
              <div style={intro}>
                <p style={{ marginTop: 0 }}>
                  {hasCurrent
                    ? "Dime qué cambiar del texto actual, o pide uno nuevo."
                    : "Cuéntame el contexto y te propongo el texto."}
                </p>
                <p style={introLabel}>Ejemplos:</p>
                {EXAMPLES[target].map((e) => (
                  <button key={e} onClick={() => send(e)} style={exampleBtn}>
                    {e}
                  </button>
                ))}
              </div>
            ))}

          {turns.length === 0 && hasCurrent && (
            <div style={intro}>
              <p style={introLabel}>Ajustes rápidos sobre el texto actual:</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TWEAKS.map((t) => (
                  <button key={t} onClick={() => send(t)} style={chip}>
                    {t}
                  </button>
                ))}
              </div>
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
                    text={t.proposal}
                    applied={!!t.applied}
                    onApply={() => apply(i)}
                  />
                )}
                {t.meta?.provider === "fake" && (
                  <div style={fakeNote}>
                    Sin IA disponible (sin clave, o la IA incluida llegó a su límite este mes): no se usó
                    ningún modelo. Revisa Ajustes › Inteligencia Artificial para que el asistente redacte de verdad.
                  </div>
                )}
              </div>
            ),
          )}

          {ask.isPending && (
            <div style={{ ...botBubble, color: "var(--muted)" }}>Redactando…</div>
          )}
        </div>

        <div style={composer}>
          <textarea
            style={{ ...inputStyle, minHeight: 64, resize: "vertical", fontFamily: "inherit" }}
            rows={3}
            value={draft}
            placeholder={
              turns.length
                ? "Pide un ajuste: «más corto», «añade los horarios», «quita los emojis»…"
                : "O escribe aquí lo que necesitas…"
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(draft);
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", flex: 1 }}>
              Ctrl/⌘ + Enter para enviar
            </span>
            <button
              onClick={() => send(draft)}
              disabled={!draft.trim() || ask.isPending}
              style={primaryBtn}
            >
              {ask.isPending ? "Redactando…" : "Enviar"}
            </button>
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}

/**
 * Primer paso para las instrucciones: tres preguntas en vez de un cuadro en
 * blanco. Con eso el modelo ya puede escribir un borrador completo.
 */
function StarterForm({
  hasCurrent,
  onSubmit,
}: {
  hasCurrent: boolean;
  onSubmit: (prompt: string) => void;
}) {
  const [business, setBusiness] = useState("");
  const [goal, setGoal] = useState<(typeof GOALS)[number]["value"]>("vender");
  const [tone, setTone] = useState<(typeof TONES)[number]["value"]>("cercano");
  const [extra, setExtra] = useState("");

  function compose() {
    const goalLabel = GOALS.find((g) => g.value === goal)?.label ?? goal;
    const toneLabel = TONES.find((t) => t.value === tone)?.label ?? tone;
    const lines = [
      `Negocio: ${business.trim()}`,
      `Objetivo del agente: ${goalLabel}`,
      `Tono: ${toneLabel}`,
      extra.trim() ? `Detalles y límites: ${extra.trim()}` : null,
      hasCurrent
        ? "Reescribe las instrucciones actuales completas con esta información."
        : "Redacta las instrucciones completas del agente.",
    ].filter(Boolean);
    onSubmit(lines.join("\n"));
  }

  return (
    <div style={starter}>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>
        {hasCurrent ? "Reescribir desde cero" : "Empecemos por tu negocio"}
      </div>
      <p style={{ ...introText, margin: 0 }}>
        Con tres datos te propongo unas instrucciones completas: rol, objetivo, tono, uso de
        herramientas, límites y ejemplos. Luego las ajustamos en el chat.
      </p>

      <label style={fieldLabel}>
        Qué vendes y a quién
        <textarea
          style={{ ...inputStyle, minHeight: 64, resize: "vertical", fontFamily: "inherit" }}
          value={business}
          placeholder="Ej: planes de internet para hogares en Lima; vendemos a familias y pequeños negocios"
          onChange={(e) => setBusiness(e.target.value)}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={fieldLabel}>
          Objetivo
          <select
            style={inputStyle}
            value={goal}
            onChange={(e) => setGoal(e.target.value as (typeof GOALS)[number]["value"])}
          >
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldLabel}>
          Tono
          <select
            style={inputStyle}
            value={tone}
            onChange={(e) => setTone(e.target.value as (typeof TONES)[number]["value"])}
          >
            {TONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label style={fieldLabel}>
        <span>
          Detalles y límites <span style={{ color: "var(--muted)" }}>(opcional)</span>
        </span>
        <input
          style={inputStyle}
          value={extra}
          placeholder="Horarios, envíos, medios de pago, lo que no debe prometer…"
          onChange={(e) => setExtra(e.target.value)}
        />
      </label>

      <button
        onClick={compose}
        disabled={business.trim().length < 3}
        style={{ ...primaryBtn, alignSelf: "flex-start" }}
      >
        <NavIcon name="sparkles" size={14} /> Generar borrador
      </button>
    </div>
  );
}

// Texto propuesto, con el botón de aplicar. Se recorta a una altura cómoda y
// se puede desplegar para leerlo entero.
function ProposalCard({
  text,
  applied,
  onApply,
}: {
  text: string;
  applied: boolean;
  onApply: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 900;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Texto copiado");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
        Propuesta · {text.split(/\s+/).filter(Boolean).length} palabras
      </div>
      <pre style={{ ...proposalText, maxHeight: expanded || !long ? "none" : 260 }}>{text}</pre>
      {long && (
        <button onClick={() => setExpanded((v) => !v)} style={linkBtn}>
          {expanded ? "Ver menos" : "Ver completo"}
        </button>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
        <button onClick={onApply} disabled={applied} style={{ ...primaryBtn, flex: 1 }}>
          {applied ? (
            <>
              <NavIcon name="check" size={14} />
              Aplicado
            </>
          ) : (
            "Usar este texto"
          )}
        </button>
        <button onClick={copy} style={{ ...ghostBtn, ...smBtn }} title="Copiar al portapapeles">
          <NavIcon name="copy" size={13} /> Copiar
        </button>
      </div>
      {applied && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
          Ya está en el campo. Revísalo y pulsa «Guardar» para conservarlo.
        </div>
      )}
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 1000,
  animation: "fadeIn 0.15s ease",
};

const drawer: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  height: "100vh",
  width: "min(520px, 100vw)",
  background: "var(--panel-2)",
  borderLeft: "1px solid var(--border)",
  boxShadow: "var(--shadow-drawer)",
  zIndex: 1001,
  display: "flex",
  flexDirection: "column",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "14px 16px",
  borderBottom: "1px solid var(--border)",
};

const thread: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minHeight: 0,
};

const intro: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 12.5,
  lineHeight: 1.55,
};

const introText: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 12.5,
  lineHeight: 1.55,
};

const introLabel: React.CSSProperties = {
  margin: "0 0 6px",
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 600,
};

const starter: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 14,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--panel)",
};

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  fontSize: 12.5,
  color: "var(--text)",
};

const userBubble: React.CSSProperties = {
  alignSelf: "flex-end",
  maxWidth: "88%",
  padding: "8px 11px",
  borderRadius: "10px 10px 2px 10px",
  background: "var(--accent)",
  color: "#f3f8ff",
  fontSize: 12.5,
  whiteSpace: "pre-wrap",
};

const botBubble: React.CSSProperties = {
  alignSelf: "flex-start",
  width: "100%",
  boxSizing: "border-box",
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

const proposalText: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "inherit",
  fontSize: 12.5,
  lineHeight: 1.5,
  overflow: "auto",
};

const linkBtn: React.CSSProperties = {
  marginTop: 6,
  padding: 0,
  border: "none",
  background: "transparent",
  color: "var(--accent)",
  fontSize: 12,
  cursor: "pointer",
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

const chip: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 12,
  cursor: "pointer",
  textAlign: "left",
};

const composer: React.CSSProperties = {
  borderTop: "1px solid var(--border)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
