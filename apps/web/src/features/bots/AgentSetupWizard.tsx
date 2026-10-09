"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentToolInfo, BotDto, CreateBotInput } from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { toast } from "@/lib/toast";
import { askPromptAssistant, createBot, fetchAiStatus, updateBot } from "@/lib/bff";
import { TOOL_COPY } from "./agentCopy";

/**
 * Asistente paso a paso para armar un agente sin saber de prompts: una
 * pregunta por pantalla, con el porqué de cada decisión. Al final redacta
 * las instrucciones con la IA (o con una plantilla si no hay clave) y crea
 * el agente, o configura el que ya existe.
 */

type Goal = "vender" | "agendar" | "soporte" | "datos";
type Tone = "cercano" | "formal" | "juvenil" | "divertido";

const GOALS: { value: Goal; title: string; desc: string; icon: IconName }[] = [
  { value: "vender", title: "Vender", desc: "Da precios, resuelve dudas y cierra la compra.", icon: "tag" },
  { value: "agendar", title: "Agendar citas", desc: "Califica al cliente y consigue una cita o visita.", icon: "clock" },
  { value: "soporte", title: "Dar soporte", desc: "Responde preguntas frecuentes y resuelve problemas.", icon: "book" },
  { value: "datos", title: "Captar datos", desc: "Recoge lo que necesita un vendedor para llamar.", icon: "user" },
];

const TONES: { value: Tone; title: string; sample: string }[] = [
  { value: "cercano", title: "Cercano", sample: "¡Hola! Claro, te cuento 😊" },
  { value: "formal", title: "Formal, de usted", sample: "Buenos días. Con gusto le informo." },
  { value: "juvenil", title: "Juvenil y directo", sample: "Hey! Va, te explico rápido." },
  { value: "divertido", title: "Divertido", sample: "¡Holaaa! 🎉 Esto te va a encantar." },
];

/** Qué capacidades tienen sentido para cada misión. */
const TOOLS_BY_GOAL: Record<Goal, string[]> = {
  vender: ["search_products", "search_knowledge", "search_contact", "handoff_to_human", "mark_lead", "move_deal_stage", "update_contact", "send_product_image"],
  agendar: ["search_knowledge", "search_contact", "handoff_to_human", "update_contact", "assign_to_seller", "add_tag"],
  soporte: ["search_knowledge", "search_contact", "handoff_to_human", "add_tag"],
  datos: ["search_contact", "update_contact", "handoff_to_human", "assign_to_seller", "add_tag", "search_knowledge"],
};

const KEYWORD_PRESETS = ["asesor", "humano", "persona", "reclamo", "factura", "reembolso", "cancelar"];
const DEFAULT_KEYWORDS = ["asesor", "humano", "persona", "reclamo"];

const BUSINESS_EXAMPLES = [
  "Tienda de ropa deportiva en Lima; vendemos a jóvenes y deportistas por Instagram y WhatsApp",
  "Clínica dental en Bogotá; atendemos familias y necesitamos llenar la agenda",
  "Cursos online de marketing; vendemos a emprendedores de toda Latinoamérica",
  "Distribuidora de insumos para restaurantes; clientes son negocios que compran cada semana",
];

const STEPS = [
  { key: "negocio", label: "Tu negocio" },
  { key: "mision", label: "Su misión" },
  { key: "capacidades", label: "Qué puede hacer" },
  { key: "limites", label: "Cuándo te avisa" },
  { key: "instrucciones", label: "Instrucciones" },
] as const;

interface Answers {
  name: string;
  business: string;
  goal: Goal;
  tone: Tone;
  extra: string;
  tools: string[];
  keywords: string[];
  angry: boolean;
  autopilot: boolean;
  prompt: string;
}

export function AgentSetupWizard({
  bot,
  availableTools,
  onDone,
  onClose,
}: {
  /** Agente que se configura, o null para crear uno nuevo. */
  bot: BotDto | null;
  availableTools: AgentToolInfo[];
  onDone: (b: BotDto, action: "test" | "edit") => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<BotDto | null>(null);
  const [a, setA] = useState<Answers>({
    name: bot?.name ?? "",
    business: "",
    goal: "vender",
    tone: "cercano",
    extra: "",
    tools: TOOLS_BY_GOAL.vender,
    keywords: DEFAULT_KEYWORDS,
    angry: true,
    autopilot: false,
    prompt: "",
  });
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setA((x) => ({ ...x, [k]: v }));
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: fetchAiStatus, staleTime: 60_000 });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Herramientas que existen en este workspace, en el orden de la misión.
  const toolList = useMemo(() => {
    const order = TOOLS_BY_GOAL[a.goal];
    return [...availableTools].sort((x, y) => {
      const ix = order.indexOf(x.name);
      const iy = order.indexOf(y.name);
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    });
  }, [availableTools, a.goal]);

  const write = useMutation({
    mutationFn: async () => {
      if (!ai.data?.ready) return localPrompt(a);
      try {
        const reply = await askPromptAssistant({
          prompt: composeBrief(a),
          target: "systemPrompt",
          current: "",
          botName: a.name.trim() || null,
          enabledTools: a.tools,
          history: [],
        });
        return reply.proposal?.trim() || localPrompt(a);
      } catch {
        return localPrompt(a);
      }
    },
    onSuccess: (text) => set("prompt", text),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: CreateBotInput = {
        name: a.name.trim() || "Asistente",
        model: bot?.model ?? defaultModel(ai.data?.provider),
        effort: (bot?.effort ?? "medium") as CreateBotInput["effort"],
        systemPrompt: a.prompt.trim(),
        enabledTools: a.tools,
        maxIterations: bot?.maxIterations ?? 6,
        monthlyTokenBudget: bot?.monthlyTokenBudget ?? 0,
        isActive: true,
        channelId: bot?.channelId ?? null,
        autopilotByDefault: a.autopilot,
        replyDelaySec: bot?.replyDelaySec ?? 4,
        welcomeEnabled: bot?.welcomeEnabled ?? false,
        welcomeMessage: bot?.welcomeMessage ?? null,
        businessHoursEnabled: bot?.businessHoursEnabled ?? false,
        businessHours: bot?.businessHours ?? null,
        keywordTriggers: bot?.keywordTriggers ?? [],
        escalationRules: {
          escalateOnNegativeSentiment: a.angry,
          minConfidence: bot?.escalationRules.minConfidence ?? 0.75,
          keywords: a.keywords,
        },
      };
      return bot ? updateBot(bot.id, payload) : createBot(payload);
    },
    onSuccess: (b) => {
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success(bot ? "Agente configurado" : `Agente «${b.name}» creado`);
      setCreated(b);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Al llegar a Instrucciones se redacta solo, una vez.
  useEffect(() => {
    if (step === 4 && !a.prompt && !write.isPending && !write.isError) write.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!mounted) return null;

  const canNext = [
    a.business.trim().length >= 10 && a.name.trim().length > 0,
    true,
    a.tools.length > 0,
    true,
    a.prompt.trim().length > 20 && !write.isPending,
  ][step];

  const toggleTool = (name: string) => set("tools", a.tools.includes(name) ? a.tools.filter((t) => t !== name) : [...a.tools, name]);
  const toggleKeyword = (k: string) => set("keywords", a.keywords.includes(k) ? a.keywords.filter((x) => x !== k) : [...a.keywords, k]);

  return createPortal(
    <div className="aw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="aw-title" className="aw-modal">
        <header className="aw-head">
          <div>
            <strong id="aw-title">{bot ? `Configurar «${bot.name}»` : "Arma tu agente de IA"}</strong>
            <span>Cinco preguntas y queda listo. Podrás cambiar todo después.</span>
          </div>
          <button type="button" className="pf-icon-btn" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)">
            <NavIcon name="x" size={17} />
          </button>
        </header>

        {created ? (
          <Done bot={created} isNew={!bot} onTest={() => onDone(created, "test")} onEdit={() => onDone(created, "edit")} />
        ) : (
          <>
            <ol className="aw-progress" aria-label="Pasos">
              {STEPS.map((s, i) => (
                <li key={s.key} className={i < step ? "is-done" : i === step ? "is-current" : ""} aria-current={i === step ? "step" : undefined}>
                  <span className="aw-progress__dot">{i < step ? <NavIcon name="check" size={12} /> : i + 1}</span>
                  <span className="aw-progress__label">{s.label}</span>
                </li>
              ))}
            </ol>

            <div className="aw-body">
              {step === 0 && (
                <section className="aw-step">
                  <h3>¿Qué vendes y a quién?</h3>
                  <p className="aw-why">Es lo primero que el agente necesita saber. Con dos frases basta: qué ofreces, dónde y a qué tipo de cliente.</p>
                  <textarea
                    className="field"
                    rows={3}
                    autoFocus
                    value={a.business}
                    placeholder="Ej: vendemos planes de internet para hogares en Lima, a familias y pequeños negocios"
                    onChange={(e) => set("business", e.target.value)}
                  />
                  {!a.business && (
                    <div className="aw-examples">
                      <span>Ejemplos:</span>
                      {BUSINESS_EXAMPLES.map((ex) => (
                        <button key={ex} type="button" className="agent-chip" onClick={() => set("business", ex)}>
                          {ex.split(";")[0]}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="aw-label">
                    <span>¿Cómo se llama tu agente?</span>
                    <input className="field" value={a.name} placeholder="Ej: Lía, Asistente de ventas" onChange={(e) => set("name", e.target.value)} />
                    <small>Solo lo ves tú y tu equipo. Si le das un nombre de persona, en el chat se presentará así.</small>
                  </label>
                </section>
              )}

              {step === 1 && (
                <section className="aw-step">
                  <h3>¿Cuál es su misión?</h3>
                  <p className="aw-why">Define qué considera un buen resultado y qué capacidades te proponemos en el paso siguiente.</p>
                  <div className="aw-cards" role="radiogroup" aria-label="Misión">
                    {GOALS.map((g) => (
                      <button
                        key={g.value}
                        type="button"
                        role="radio"
                        aria-checked={a.goal === g.value}
                        className={`aw-card${a.goal === g.value ? " is-on" : ""}`}
                        onClick={() => {
                          set("goal", g.value);
                          set("tools", TOOLS_BY_GOAL[g.value].filter((t) => availableTools.some((x) => x.name === t)));
                        }}
                      >
                        <NavIcon name={g.icon} size={18} />
                        <strong>{g.title}</strong>
                        <small>{g.desc}</small>
                      </button>
                    ))}
                  </div>
                  <div className="aw-label">
                    <span>¿Cómo habla tu marca?</span>
                    <div className="aw-tones" role="radiogroup" aria-label="Tono">
                      {TONES.map((t) => (
                        <button key={t.value} type="button" role="radio" aria-checked={a.tone === t.value} className={`aw-tone${a.tone === t.value ? " is-on" : ""}`} onClick={() => set("tone", t.value)}>
                          <strong>{t.title}</strong>
                          <small>{t.sample}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="aw-label">
                    <span>Algo más que deba saber (opcional)</span>
                    <textarea
                      className="field"
                      rows={2}
                      value={a.extra}
                      placeholder="Ej: hacemos envíos a todo el país en 2 a 4 días; no damos descuentos; el horario es de 9 a 18"
                      onChange={(e) => set("extra", e.target.value)}
                    />
                  </label>
                </section>
              )}

              {step === 2 && (
                <section className="aw-step">
                  <h3>¿Qué puede consultar y hacer?</h3>
                  <p className="aw-why">
                    Marcamos lo habitual para «{GOALS.find((g) => g.value === a.goal)?.title.toLowerCase()}». Lo que no active, el agente ni lo intenta.
                  </p>
                  <div className="agent-tools">
                    {toolList.map((t) => {
                      const copy = TOOL_COPY[t.name];
                      const on = a.tools.includes(t.name);
                      return (
                        <label key={t.name} className={`agent-tool${on ? " is-on" : ""}`}>
                          <span className="agent-tool__icon">
                            <NavIcon name={copy?.icon ?? "bolt"} size={16} />
                          </span>
                          <span className="agent-tool__body">
                            <strong>
                              {copy?.title ?? t.label}
                              {TOOLS_BY_GOAL[a.goal].includes(t.name) && <em>Sugerido</em>}
                            </strong>
                            {copy && <small>{copy.desc}</small>}
                            {t.unavailableReason && (
                              <span className="agent-tool__warn">
                                <NavIcon name="alert" size={13} />
                                {t.unavailableReason}
                              </span>
                            )}
                          </span>
                          <input type="checkbox" className="agent-tool__check" checked={on} onChange={() => toggleTool(t.name)} />
                          <span className="agent-switch__track" aria-hidden="true">
                            <span />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              )}

              {step === 3 && (
                <section className="aw-step">
                  <h3>¿Cuándo te pasa el chat?</h3>
                  <p className="aw-why">Un buen agente sabe cuándo apartarse. Si el cliente dice alguna de estas palabras, la conversación pasa a tu equipo al momento.</p>
                  <div className="aw-chips" role="group" aria-label="Palabras que pasan el chat">
                    {[...KEYWORD_PRESETS, ...a.keywords.filter((k) => !KEYWORD_PRESETS.includes(k))].map((k) => (
                      <button key={k} type="button" aria-pressed={a.keywords.includes(k)} className={`agent-chip${a.keywords.includes(k) ? " is-on" : ""}`} onClick={() => toggleKeyword(k)}>
                        {k}
                      </button>
                    ))}
                    <KeywordInput onAdd={(k) => !a.keywords.includes(k) && set("keywords", [...a.keywords, k])} />
                  </div>
                  <label className={`agent-switch${a.angry ? " is-on" : ""}`}>
                    <input type="checkbox" checked={a.angry} onChange={(e) => set("angry", e.target.checked)} />
                    <span className="agent-switch__track" aria-hidden="true">
                      <span />
                    </span>
                    <span className="agent-switch__text">
                      <strong>También si el cliente está molesto</strong>
                      <small>Detecta el enfado y deja el chat para una persona.</small>
                    </span>
                  </label>

                  <div className="aw-label">
                    <span>¿Cómo empieza?</span>
                    <div className="aw-cards aw-cards--2" role="radiogroup" aria-label="Modo">
                      <button type="button" role="radio" aria-checked={!a.autopilot} className={`aw-card${!a.autopilot ? " is-on" : ""}`} onClick={() => set("autopilot", false)}>
                        <NavIcon name="check-double" size={18} />
                        <strong>
                          Te sugiere <em>Recomendado</em>
                        </strong>
                        <small>Redacta cada respuesta y tu equipo la revisa antes de enviarla. Ideal la primera semana.</small>
                      </button>
                      <button type="button" role="radio" aria-checked={a.autopilot} className={`aw-card${a.autopilot ? " is-on" : ""}`} onClick={() => set("autopilot", true)}>
                        <NavIcon name="zap" size={18} />
                        <strong>Responde solo</strong>
                        <small>Contesta sin esperar a nadie. Tu equipo puede tomar cualquier chat cuando quiera.</small>
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {step === 4 && (
                <section className="aw-step">
                  <h3>Sus instrucciones</h3>
                  <p className="aw-why">
                    {ai.data?.ready
                      ? "Las redactó la IA con tus respuestas. Léelas como si fueran el manual de alguien nuevo: cambia lo que no encaje."
                      : "Sin clave de IA no podemos redactarlas por ti: te dejamos una base con tus respuestas. Actívala en Ajustes › Inteligencia Artificial para mejorarlas."}
                  </p>
                  {write.isPending ? (
                    <div className="aw-writing">
                      <span className="skeleton" style={{ height: 14, width: "92%" }} />
                      <span className="skeleton" style={{ height: 14, width: "78%" }} />
                      <span className="skeleton" style={{ height: 14, width: "85%" }} />
                      <span className="skeleton" style={{ height: 14, width: "60%" }} />
                      <p>
                        <NavIcon name="sparkles" size={14} /> Redactando con tus respuestas…
                      </p>
                    </div>
                  ) : (
                    <>
                      <textarea className="field aw-prompt" value={a.prompt} onChange={(e) => set("prompt", e.target.value)} spellCheck={false} />
                      <div className="aw-inline">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => write.mutate()}>
                          <NavIcon name="sparkles" size={13} /> Volver a redactar
                        </button>
                        <small>Después podrás afinarlas con el Asistente del editor.</small>
                      </div>
                    </>
                  )}
                </section>
              )}
            </div>

            <footer className="aw-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
                {step === 0 ? "Cancelar" : "Atrás"}
              </button>
              <span className="aw-foot__count">
                {step + 1} de {STEPS.length}
              </span>
              {step < STEPS.length - 1 ? (
                <button type="button" className="btn btn-primary btn-sm" disabled={!canNext} onClick={() => setStep(step + 1)}>
                  Siguiente <NavIcon name="arrow-right" size={14} />
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" disabled={!canNext || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Guardando…" : bot ? "Guardar agente" : "Crear agente"}
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Done({ bot, isNew, onTest, onEdit }: { bot: BotDto; isNew: boolean; onTest: () => void; onEdit: () => void }) {
  return (
    <div className="aw-done">
      <span className="aw-done__icon">
        <NavIcon name="check" size={26} />
      </span>
      <h3>{isNew ? `¡Listo! «${bot.name}» ya está creado` : `¡Listo! «${bot.name}» quedó configurado`}</h3>
      <p>
        {bot.autopilotByDefault
          ? "Responderá solo en los chats nuevos. Tu equipo puede tomar cualquier conversación cuando quiera."
          : "Sugerirá respuestas y tu equipo las revisará antes de enviarlas."}{" "}
        Antes de que hable con un cliente real, pruébalo tú.
      </p>
      <div className="aw-done__actions">
        <button type="button" className="btn btn-primary" onClick={onTest} autoFocus>
          <NavIcon name="flask" size={15} /> Probar una conversación
        </button>
        <button type="button" className="btn btn-ghost" onClick={onEdit}>
          Ver la configuración
        </button>
      </div>
      <ul className="aw-done__next" aria-label="Siguientes pasos">
        <li>
          <NavIcon name="tag" size={13} /> Carga tus productos para que dé precios reales.
        </li>
        <li>
          <NavIcon name="book" size={13} /> Sube tus preguntas frecuentes a Conocimiento.
        </li>
        <li>
          <NavIcon name="whatsapp" size={13} /> Conecta un número si aún no lo hiciste.
        </li>
      </ul>
    </div>
  );
}

function KeywordInput({ onAdd }: { onAdd: (k: string) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const k = text.trim().toLowerCase();
    if (k) onAdd(k);
    setText("");
  };
  return (
    <input
      className="aw-chip-input"
      value={text}
      placeholder="+ otra palabra"
      aria-label="Añadir palabra"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          add();
        }
      }}
      onBlur={add}
    />
  );
}

// ── Redacción ─────────────────────────────────────────────────

const GOAL_TEXT: Record<Goal, string> = {
  vender: "vender: informar, resolver objeciones y llevar al cliente a confirmar la compra",
  agendar: "calificar al cliente y conseguir que agende una cita o visita",
  soporte: "resolver dudas y problemas con la información del negocio",
  datos: "captar los datos del cliente (nombre, qué necesita, cómo contactarlo) para que un vendedor lo llame",
};

const TONE_TEXT: Record<Tone, string> = {
  cercano: "cercano y profesional, de tú, con algún emoji ocasional",
  formal: "formal y cortés, de usted, sin emojis",
  juvenil: "juvenil y directo, de tú, frases cortas",
  divertido: "divertido y cálido, con emojis, sin perder claridad",
};

/** Lo que se le cuenta al asistente de redacción. */
function composeBrief(a: Answers): string {
  return [
    `Negocio: ${a.business.trim()}`,
    `Nombre del agente: ${a.name.trim() || "Asistente"}`,
    `Objetivo del agente: ${GOAL_TEXT[a.goal]}`,
    `Tono: ${TONE_TEXT[a.tone]}`,
    a.extra.trim() ? `Detalles y límites: ${a.extra.trim()}` : null,
    `Debe pasar el chat a una persona (handoff_to_human) si el cliente está molesto, pide hablar con alguien, o menciona: ${a.keywords.join(", ")}.`,
    "Redacta las instrucciones completas del agente.",
  ]
    .filter(Boolean)
    .join("\n");
}

const TOOL_RULES: Record<string, string> = {
  search_products: "Cuando pregunten por productos, precios o disponibilidad, consulta el catálogo con search_products. Nunca inventes precios ni productos.",
  search_knowledge: "Antes de responder sobre envíos, garantías, horarios, políticas o preguntas frecuentes, busca en search_knowledge y responde con esa información.",
  search_contact: "Revisa la ficha del cliente con search_contact para no volver a preguntar lo que ya sabes.",
  update_contact: "Guarda con update_contact los datos que el cliente te confirme (nombre, ciudad, lo que busca).",
  mark_lead: "Clasifica al cliente con mark_lead: «potential» en cuanto muestre interés real (pide precio, cotización, quiere comprar), «purchase» cuando confirme la compra o el pago, «lost» si dice que no le interesa.",
  move_deal_stage: "Mueve su oportunidad con move_deal_stage cuando avance: a negociación si pide precio, a ganado si confirma.",
  add_tag: "Etiqueta al cliente con add_tag según su interés, usando solo las etiquetas disponibles.",
  send_product_image: "Si quiere ver un producto, envía su foto con send_product_image.",
  assign_to_seller: "Cuando el cliente esté listo para que lo atienda alguien, asigna un vendedor con assign_to_seller.",
  handoff_to_human: "",
};

/** Plantilla sin IA: correcta y completa, aunque menos fina que la redactada. */
function localPrompt(a: Answers): string {
  const name = a.name.trim() || "el asistente";
  const rules = a.tools.map((t) => TOOL_RULES[t]).filter(Boolean);
  return [
    `Eres ${name}, asistente por WhatsApp de este negocio: ${a.business.trim()}.`,
    "",
    `Tu objetivo: ${GOAL_TEXT[a.goal]}.`,
    `Tono: ${TONE_TEXT[a.tone]}. Responde siempre en español, en mensajes cortos (máximo 5 líneas) y con una sola pregunta por mensaje.`,
    "",
    "Cómo trabajas:",
    ...rules.map((r) => `- ${r}`),
    "- No inventes datos. Si no tienes la información, dilo y ofrece consultarlo.",
    "- No prometas plazos, descuentos ni condiciones que no estén en tu información.",
    "",
    "Cuándo pasar el chat a una persona (usa handoff_to_human):",
    `- Si pide hablar con alguien o menciona: ${a.keywords.join(", ")}.`,
    a.angry ? "- Si está molesto o insatisfecho." : null,
    "- Si el tema excede lo que sabes. Antes de pasarlo, despídete con una frase corta.",
    a.extra.trim() ? `\nDatos del negocio a tener en cuenta: ${a.extra.trim()}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function defaultModel(provider: string | undefined): string {
  return provider === "anthropic" ? "claude-haiku-4-5" : "gpt-4o-mini";
}
