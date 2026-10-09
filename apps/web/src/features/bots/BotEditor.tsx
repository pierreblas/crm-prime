"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  effortValues,
  keywordActions,
  weekday,
  type AgentToolInfo,
  type BotChannelRef,
  type BotDto,
  type BusinessHours,
  type CreateBotInput,
  type KeywordAction,
  type KeywordTrigger,
  type KeywordVariant,
  COUNTRIES,
  type Weekday,
  DEFAULT_HANDOFF_MESSAGE,
  type FlowRule,
  normalizeKeywordTrigger,
} from "@crm/shared";
import type { PromptAssistantTarget } from "@crm/shared";
import { createBot, fetchAgents, fetchCustomFields, fetchSources, fetchStages, fetchTags, fetchWhatsappChannels, updateBot } from "@/lib/bff";
import { RuleRow, newRule, type RuleLookups } from "@/features/flows/RuleRow";
import { CONDITION_FIELD_BY, OP_LABEL } from "@/features/flows/flowShared";
import { field, input, label as lbl, primaryBtn, ghostBtn } from "./styles";
import { smBtn } from "@/components/ui";
import { PromptAssistant } from "./PromptAssistant";
import {
  EFFORT_LABEL,
  MODEL_OPTIONS,
  TIMEZONES,
  TOOL_COPY,
  costPerReply,
  isGenericPrompt,
  tokensForUsd,
  usd,
  usdForTokens,
} from "./agentCopy";

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};

const ACTION_LABEL: Record<KeywordAction, string> = {
  reply: "Responder con este texto",
  handoff: "Pasar el chat a tu equipo",
  set_off: "Apagar la IA en ese chat",
};

type Form = {
  name: string;
  model: string;
  effort: string;
  systemPrompt: string;
  enabledTools: string[];
  maxIterations: number;
  monthlyTokenBudget: number;
  isActive: boolean;
  channelId: string | null;
  escalateOnNegativeSentiment: boolean;
  handoffOnMedia: boolean;
  minConfidence: number;
  handoffMessage: string;
  keywords: string;
  autopilotByDefault: boolean;
  replyDelaySec: number;
  welcomeEnabled: boolean;
  welcomeMessage: string;
  businessHoursEnabled: boolean;
  businessHours: BusinessHours;
  keywordTriggers: KeywordTrigger[];
};

// Campos del editor que tienen botón de asistente de redacción.
type AssistTarget = Extract<PromptAssistantTarget, "systemPrompt" | "welcomeMessage" | "outOfHoursMessage">;

/**
 * Niveles de "cuándo rendirse", en vez del umbral 0–1 que nadie sabe elegir.
 *
 * El agente puntúa cada mensaje del cliente restando a una base de 0.85:
 * −0.30 si pide hablar con una persona, −0.15 si está molesto y −0.10 si es
 * urgente. Escala cuando la puntuación queda POR DEBAJO del umbral, así que
 * cada valor de aquí corresponde a una combinación concreta de señales.
 */
const HANDOFF_LEVELS = [
  { value: 0, label: "Nunca por su cuenta", hint: "Solo te pasa el chat con las palabras de arriba. Intenta responderlo todo." },
  { value: 0.6, label: "Si el cliente pide una persona", hint: "Aunque no use esas palabras exactas: lo detecta por cómo lo dice." },
  { value: 0.75, label: "Si pide una persona o está molesto", hint: "Recomendado. Añade los casos en que el cliente suena enfadado o frustrado." },
  { value: 0.8, label: "Ante cualquier duda", hint: "También si el asunto es urgente. Resuelve menos solo, pero se equivoca menos." },
] as const;

/** Presupuestos en dólares: es como piensa la gente, no en tokens. */
const BUDGET_USD = [5, 20, 50] as const;

function nearestLevel(value: number): number {
  return HANDOFF_LEVELS.reduce((best, l) => (Math.abs(l.value - value) < Math.abs(best.value - value) ? l : best)).value;
}

function iterationsHint(n: number): string {
  if (n <= 2) return "Muy justo: responde rápido, pero casi sin consultar tu catálogo ni la ficha del cliente.";
  if (n <= 8) return "Equilibrado: le alcanza para buscar un producto y revisar la ficha del cliente.";
  return "Generoso: resuelve casos enredados, pero tarda más y gasta más en cada respuesta.";
}

function defaultHours(): BusinessHours {
  return {
    timezone: "America/Lima",
    days: {
      mon: { from: "09:00", to: "18:00" },
      tue: { from: "09:00", to: "18:00" },
      wed: { from: "09:00", to: "18:00" },
      thu: { from: "09:00", to: "18:00" },
      fri: { from: "09:00", to: "18:00" },
      sat: null,
      sun: null,
    },
    outOfHoursMessage: "¡Gracias por escribirnos! Ahora estamos fuera de horario, te responderemos pronto.",
  };
}

function toForm(bot: BotDto | null): Form {
  if (!bot) {
    return {
      name: "",
      model: "gpt-4o-mini",
      effort: "medium",
      systemPrompt:
        "Eres un asistente de ventas por WhatsApp. Responde en español, con tono cercano y profesional. Cuando el cliente pregunte por precios, productos o disponibilidad, usa la herramienta de catálogo (search_products) en vez de inventar. Si no tienes la información o el cliente lo amerita, escala a un humano.",
      enabledTools: ["search_contact", "search_products", "search_knowledge", "handoff_to_human"],
      maxIterations: 6,
      monthlyTokenBudget: 0,
      isActive: true,
      channelId: null,
      escalateOnNegativeSentiment: true,
      handoffOnMedia: false,
      minConfidence: 0.75,
      handoffMessage: DEFAULT_HANDOFF_MESSAGE,
      keywords: "humano, persona, asesor, reclamo",
      autopilotByDefault: false,
      replyDelaySec: 4,
      welcomeEnabled: false,
      welcomeMessage: "¡Hola! 👋 Gracias por escribirnos. ¿En qué te ayudamos?",
      businessHoursEnabled: false,
      businessHours: defaultHours(),
      keywordTriggers: [],
    };
  }
  return {
    name: bot.name,
    model: bot.model,
    effort: bot.effort,
    systemPrompt: bot.systemPrompt,
    enabledTools: bot.enabledTools,
    maxIterations: bot.maxIterations,
    monthlyTokenBudget: bot.monthlyTokenBudget,
    isActive: bot.isActive,
    channelId: bot.channelId,
    escalateOnNegativeSentiment: bot.escalationRules.escalateOnNegativeSentiment ?? false,
    handoffOnMedia: bot.escalationRules.onMedia ?? false,
    minConfidence: bot.escalationRules.minConfidence ?? 0.6,
    handoffMessage: bot.escalationRules.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE,
    keywords: (bot.escalationRules.keywords ?? []).join(", "),
    autopilotByDefault: bot.autopilotByDefault,
    replyDelaySec: bot.replyDelaySec ?? 4,
    welcomeEnabled: bot.welcomeEnabled,
    welcomeMessage: bot.welcomeMessage ?? "",
    businessHoursEnabled: bot.businessHoursEnabled,
    businessHours: bot.businessHours ?? defaultHours(),
    keywordTriggers: bot.keywordTriggers.map(normalizeKeywordTrigger),
  };
}

type Tab = "dice" | "hace" | "cuando" | "persona" | "gasto";

/** Límites del backend, para avisar antes de enviar. */
const MAX_TEXT = 2000;
const MAX_NAME = 120;

// Un error de validación llega como "keywordTriggers.0.value: máximo 2000
// caracteres". Se traduce a un nombre que la persona reconoce y a la
// pestaña donde está el campo.
const FIELD_LABELS: [RegExp, (m: RegExpMatchArray) => string, Tab][] = [
  [/^name$/, () => "Nombre", "dice"],
  [/^systemPrompt$/, () => "Cómo debe atender", "dice"],
  [/^enabledTools/, () => "Qué puede hacer", "hace"],
  [/^welcomeMessage$/, () => "Saludo automático", "cuando"],
  [/^replyDelaySec$/, () => "Antes de responder", "cuando"],
  [/^businessHours\.outOfHoursMessage$/, () => "Mensaje fuera de horario", "cuando"],
  [/^businessHours/, () => "Horario de atención", "cuando"],
  [/^keywordTriggers\.(\d+)\.keywords/, (m) => `Respuesta fija ${Number(m[1]) + 1} › palabras`, "cuando"],
  [/^keywordTriggers\.(\d+)\.value/, (m) => `Respuesta fija ${Number(m[1]) + 1} › texto`, "cuando"],
  [/^keywordTriggers/, () => "Respuestas fijas", "cuando"],
  [/^escalationRules\.keywords/, () => "Palabras que pasan el chat", "persona"],
  [/^escalationRules/, () => "Cuándo te pasa el chat", "persona"],
  [/^model$|^effort$/, () => "Modelo", "gasto"],
  [/^monthlyTokenBudget$/, () => "Límite de gasto", "gasto"],
  [/^maxIterations$/, () => "Consultas por respuesta", "gasto"],
];

function explainError(raw: string): { text: string; tab: Tab | null } {
  const parts = raw.split(/,\s*(?=[\w.]+: )|; /).map((p) => p.trim()).filter(Boolean);
  let tab: Tab | null = null;
  const lines = parts.map((part) => {
    const m = part.match(/^([\w.]+): (.*)$/);
    if (!m) return part;
    const hit = FIELD_LABELS.find(([re]) => re.test(m[1]!));
    if (!hit) return part;
    const label = hit[1](m[1]!.match(hit[0])!);
    tab ??= hit[2];
    return `${label}: ${m[2]}`;
  });
  return { text: lines.join(". "), tab };
}

function Counter({ value, max }: { value: string; max: number }) {
  if (value.length < max * 0.8) return null;
  const over = value.length > max;
  return (
    <span className="agent-hint" style={{ textAlign: "right", color: over ? "var(--danger)" : undefined }}>
      {value.length.toLocaleString("es")} / {max.toLocaleString("es")}
      {over && " · demasiado largo"}
    </span>
  );
}

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "dice", label: "Qué dice", icon: "message" },
  { id: "hace", label: "Qué puede hacer", icon: "bolt" },
  { id: "cuando", label: "Cuándo responde", icon: "clock" },
  { id: "persona", label: "Cuándo te pasa el chat", icon: "user" },
  { id: "gasto", label: "Modelo y gasto", icon: "settings" },
];

export function BotEditor({
  bot,
  availableTools,
  channels,
  onSaved,
  onCancel,
  onDeleted,
  onDirtyChange,
  onWizard,
}: {
  bot: BotDto | null; // null = crear nuevo
  availableTools: AgentToolInfo[];
  channels: BotChannelRef[];
  onSaved: (b: BotDto) => void;
  onCancel: () => void;
  onDeleted?: () => void;
  /** Avisa si hay cambios sin guardar (para no perderlos al cambiar de agente). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Abre el asistente paso a paso para configurar este agente. */
  onWizard?: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(bot));
  // Última versión guardada: con ella se sabe si hay cambios pendientes.
  const [saved, setSaved] = useState<Form>(() => toForm(bot));
  const [justSaved, setJustSaved] = useState(false);
  const isNew = !bot;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (dirty) setJustSaved(false);
  }, [dirty]);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 3000);
    return () => clearTimeout(t);
  }, [justSaved]);
  // Cerrar la pestaña con cambios sin guardar: el navegador pregunta.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);
  const [assist, setAssist] = useState<AssistTarget | null>(null);
  const [promptBig, setPromptBig] = useState(false);
  const [tab, setTab] = useState<Tab>("dice");

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const snapshot = form;
      const payload: CreateBotInput = {
        name: form.name,
        model: form.model,
        effort: form.effort as CreateBotInput["effort"],
        systemPrompt: form.systemPrompt,
        enabledTools: form.enabledTools,
        maxIterations: Number(form.maxIterations),
        monthlyTokenBudget: Number(form.monthlyTokenBudget),
        isActive: form.isActive,
        channelId: form.channelId,
        autopilotByDefault: form.autopilotByDefault,
        replyDelaySec: Number(form.replyDelaySec),
        welcomeEnabled: form.welcomeEnabled,
        welcomeMessage: form.welcomeMessage.trim() || null,
        businessHoursEnabled: form.businessHoursEnabled,
        businessHours: form.businessHoursEnabled ? form.businessHours : null,
        keywordTriggers: form.keywordTriggers.filter((t) => t.keywords.length > 0),
        escalationRules: {
          escalateOnNegativeSentiment: form.escalateOnNegativeSentiment,
          onMedia: form.handoffOnMedia,
          minConfidence: Number(form.minConfidence),
          handoffMessage: form.handoffMessage.trim(),
          keywords: form.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        },
      };
      const b = isNew ? await createBot(payload) : await updateBot(bot!.id, payload);
      return { b, snapshot };
    },
    onSuccess: ({ b, snapshot }) => {
      setSaved(snapshot);
      setJustSaved(true);
      toast.success(isNew ? `Agente «${b.name}» creado` : "Cambios guardados");
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      onSaved(b);
    },
    onError: (e) => {
      const { text, tab: where } = explainError((e as Error).message);
      if (where) setTab(where);
      toast.error(text);
    },
  });
  // Lo que el backend rechazaría: se avisa antes de enviar.
  const tooLong =
    form.name.length > MAX_NAME ||
    form.welcomeMessage.length > MAX_TEXT ||
    (form.businessHours.outOfHoursMessage ?? "").length > MAX_TEXT ||
    form.keywordTriggers.some((t) => (t.value ?? "").length > MAX_TEXT);
  const canSave = !save.isPending && form.name.trim().length > 0 && !tooLong && (isNew || dirty);

  // Ctrl+S / Cmd+S guarda desde cualquier pestaña.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canSave) save.mutate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSave]);

  // Un error de guardado deja de tener sentido en cuanto se toca algo.
  useEffect(() => {
    if (save.isError) save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const discard = () =>
    void confirmDialog({ message: "¿Descartar los cambios sin guardar?", danger: true }).then((ok) => ok && setForm(saved));
  const cancel = () => {
    if (!dirty) return onCancel();
    void confirmDialog({ message: "Tienes cambios sin guardar. ¿Salir sin guardar?", danger: true }).then((ok) => ok && onCancel());
  };

  function toggleTool(name: string) {
    set("enabledTools", form.enabledTools.includes(name) ? form.enabledTools.filter((t) => t !== name) : [...form.enabledTools, name]);
  }

  const ASSIST: Record<AssistTarget, { title: string; current: string; apply: (text: string) => void }> = {
    systemPrompt: { title: "Instrucciones del agente", current: form.systemPrompt, apply: (text) => set("systemPrompt", text) },
    welcomeMessage: { title: "Mensaje de bienvenida", current: form.welcomeMessage, apply: (text) => set("welcomeMessage", text) },
    outOfHoursMessage: {
      title: "Mensaje fuera de horario",
      current: form.businessHours.outOfHoursMessage ?? "",
      apply: (text) => set("businessHours", { ...form.businessHours, outOfHoursMessage: text }),
    },
  };

  const readTools = availableTools.filter((t) => !t.isAction);
  const actionTools = availableTools.filter((t) => t.isAction);
  const generic = isGenericPrompt(form.systemPrompt);

  return (
    <div className="agent-editor">
      {/* ── Lo esencial, siempre a la vista ── */}
      <section className="agent-essentials" aria-label="Lo esencial del agente">
        <label className={`agent-switch${form.isActive ? " is-on" : ""}`}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
          <span className="agent-switch__track" aria-hidden="true">
            <span />
          </span>
          <span className="agent-switch__text">
            <strong>{form.isActive ? "Activo" : "Pausado"}</strong>
            <small>{form.isActive ? "Atiende a tus clientes" : "No responde a nadie"}</small>
          </span>
        </label>

        <div className="agent-essentials__item">
          <span className="agent-essentials__label">Atiende</span>
          <select className="field field-sm" value={form.channelId ?? ""} onChange={(e) => set("channelId", e.target.value || null)}>
            <option value="">Todos los números sin agente propio</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label ?? c.displayPhoneNumber ?? c.id}
              </option>
            ))}
          </select>
        </div>

        <div className="agent-essentials__item">
          <span className="agent-essentials__label">En los chats nuevos</span>
          <div className="seg" role="radiogroup" aria-label="Cómo responde en los chats nuevos">
            <button type="button" role="radio" aria-checked={form.autopilotByDefault} className={form.autopilotByDefault ? "is-active" : ""} onClick={() => set("autopilotByDefault", true)}>
              Responde solo
            </button>
            <button type="button" role="radio" aria-checked={!form.autopilotByDefault} className={!form.autopilotByDefault ? "is-active" : ""} onClick={() => set("autopilotByDefault", false)}>
              Te sugiere
            </button>
          </div>
        </div>
      </section>
      <p className="agent-essentials__hint">
        {form.autopilotByDefault
          ? "Responde a tus clientes sin esperar a nadie. Tu equipo puede tomar el control de cualquier chat cuando quiera."
          : "Redacta cada respuesta y espera a que alguien de tu equipo la revise y la envíe. Ideal mientras lo pruebas."}
      </p>

      <nav className="agent-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
            <NavIcon name={t.icon} size={15} />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="agent-panel">
        {/* ── Qué dice ── */}
        {tab === "dice" && (
          <>
            <Card title="Nombre">
              <input className="field" value={form.name} maxLength={MAX_NAME} placeholder="Ej. Asistente de ventas" onChange={(e) => set("name", e.target.value)} />
              <Hint>Solo lo ves tú y tu equipo; el cliente no lo ve.</Hint>
            </Card>

            <Card
              title="Cómo debe atender"
              action={
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setPromptBig(true)}
                    style={{ ...ghostBtn, ...smBtn }}
                    title="Abrir en grande para leerlo y editarlo cómodo"
                    aria-label="Ampliar «Cómo debe atender»"
                  >
                    <NavIcon name="expand" size={13} /> Ampliar
                  </button>
                  <AssistButton onClick={() => setAssist("systemPrompt")} />
                </span>
              }
            >
              <Hint>
                Es lo más importante del agente. Escríbelo como si le explicaras el trabajo a alguien nuevo: qué vendes y a
                quién, cómo habla tu marca, qué no debe hacer nunca y cuándo te pasa el chat.
              </Hint>
              {generic && (
                <div className="agent-callout">
                  <NavIcon name="sparkles" size={16} />
                  <span>
                    <strong>Todavía tiene instrucciones genéricas.</strong> Cuéntale qué vendes y el asistente te las
                    redacta en un minuto.
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {onWizard && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={onWizard}>
                        Armarlo paso a paso
                      </button>
                    )}
                    <button type="button" className={`btn ${onWizard ? "btn-ghost" : "btn-primary"} btn-sm`} onClick={() => setAssist("systemPrompt")}>
                      Redactar con el asistente
                    </button>
                  </span>
                </div>
              )}
              <textarea
                className="field"
                style={{ minHeight: 220, resize: "vertical", fontFamily: "inherit", lineHeight: 1.55 }}
                value={form.systemPrompt}
                onChange={(e) => set("systemPrompt", e.target.value)}
                aria-label="Cómo debe atender"
              />
              {promptBig && (
                <PromptOverlay
                  value={form.systemPrompt}
                  onChange={(v) => set("systemPrompt", v)}
                  onClose={() => setPromptBig(false)}
                  onAssist={() => {
                    setPromptBig(false);
                    setAssist("systemPrompt");
                  }}
                />
              )}
              <ul className="agent-checklist" aria-label="Qué incluir">
                {["Qué vendes y a quién", "Tono de tu marca", "Qué no debe hacer", "Cuándo pasarte el chat"].map((c) => (
                  <li key={c}>
                    <NavIcon name="check" size={12} />
                    {c}
                  </li>
                ))}
              </ul>
              <ToolNamesHelp tools={availableTools.filter((t) => form.enabledTools.includes(t.name))} />
            </Card>
          </>
        )}

        {/* ── Qué puede hacer ── */}
        {tab === "hace" && (
          <>
            <Card title="Para responder bien" subtitle="Lo que puede consultar antes de contestar.">
              <div className="agent-tools">
                {readTools.map((t) => (
                  <ToolRow key={t.name} tool={t} checked={form.enabledTools.includes(t.name)} onToggle={() => toggleTool(t.name)} />
                ))}
              </div>
            </Card>
            <Card
              title="Para ahorrarte trabajo"
              subtitle={
                form.autopilotByDefault
                  ? "Lo que puede hacer en el CRM por su cuenta, mientras conversa."
                  : "Lo que puede hacer en el CRM. Como está en «Te sugiere», lo aplica cuando tu equipo envía la respuesta."
              }
            >
              <div className="agent-tools">
                {actionTools.map((t) => (
                  <ToolRow key={t.name} tool={t} checked={form.enabledTools.includes(t.name)} onToggle={() => toggleTool(t.name)} />
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ── Cuándo responde ── */}
        {tab === "cuando" && (
          <>
            <Card
              title="Antes de responder"
              subtitle="Si el cliente escribe en varios mensajes seguidos, espera a que termine y responde una sola vez a todo."
            >
              <div className="agent-chips" role="radiogroup" aria-label="Espera antes de responder">
                {[0, 3, 5, 10, 20].map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={form.replyDelaySec === s}
                    className={`agent-chip${form.replyDelaySec === s ? " is-on" : ""}`}
                    onClick={() => set("replyDelaySec", s)}
                  >
                    {s === 0 ? "Al instante" : `${s} segundos`}
                  </button>
                ))}
              </div>
              <Hint>
                {form.replyDelaySec === 0
                  ? "Contesta cada mensaje nada más llegar. Si el cliente escribe en partes, puede responder a medias o varias veces."
                  : `Cuenta ${form.replyDelaySec} segundos desde el último mensaje del cliente y responde a todo junto. Recomendado: entre 3 y 5.`}
              </Hint>
            </Card>

            <Card title="Saludo automático" subtitle="Un mensaje fijo al primer mensaje del cliente, al instante y sin usar IA.">
              <Switch checked={form.welcomeEnabled} onChange={(v) => set("welcomeEnabled", v)} label={form.welcomeEnabled ? "Activado" : "Desactivado"} />
              {form.welcomeEnabled && (
                <>
                  <textarea
                    className="field"
                    style={{ minHeight: 70, resize: "vertical", fontFamily: "inherit" }}
                    value={form.welcomeMessage}
                    maxLength={MAX_TEXT}
                    onChange={(e) => set("welcomeMessage", e.target.value)}
                    placeholder="¡Hola! Gracias por escribirnos…"
                  />
                  <Counter value={form.welcomeMessage} max={MAX_TEXT} />
                  <AssistButton onClick={() => setAssist("welcomeMessage")} align="end" />
                </>
              )}
            </Card>

            <Card title="Horario de atención" subtitle="Fuera de horario envía un aviso y deja el chat para tu equipo, sin que responda la IA.">
              <Switch
                checked={form.businessHoursEnabled}
                onChange={(v) => set("businessHoursEnabled", v)}
                label={form.businessHoursEnabled ? "Solo en horario" : "Responde a cualquier hora"}
              />
              {form.businessHoursEnabled && (
                <BusinessHoursEditor value={form.businessHours} onChange={(h) => set("businessHours", h)} onAssist={() => setAssist("outOfHoursMessage")} />
              )}
            </Card>

            <Card
              title="Respuestas por palabra clave"
              subtitle="Si el mensaje del cliente contiene una palabra, hace algo fijo antes que la IA. Útil para «precios», «ubicación» o «baja»."
            >
              <KeywordTriggersEditor value={form.keywordTriggers} onChange={(t) => set("keywordTriggers", t)} />
            </Card>
          </>
        )}

        {/* ── Cuándo te pasa el chat ── */}
        {tab === "persona" && (
          <Card
            title="Cuándo te pasa el chat"
            subtitle="Un buen agente no insiste cuando algo se le escapa. En estos casos deja de responder y el chat aparece como Pendiente en tu bandeja."
          >
            <div style={field}>
              <span style={lbl}>Si el cliente escribe alguna de estas palabras</span>
              <input className="field" value={form.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="humano, persona, asesor, reclamo" />
              <Hint>Sepáralas con comas. Es lo más directo: si pide hablar con alguien, se le pasa sin discutir.</Hint>
            </div>

            <div style={field}>
              <span style={lbl}>Además, por su cuenta</span>
              <div className="agent-options">
                {HANDOFF_LEVELS.map((level) => {
                  const on = nearestLevel(form.minConfidence) === level.value;
                  return (
                    <label key={level.value} className={`agent-option${on ? " is-on" : ""}`}>
                      <input type="radio" name="handoff-level" checked={on} onChange={() => set("minConfidence", level.value)} />
                      <span>
                        <strong>{level.label}</strong>
                        <small>{level.hint}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <Switch
              checked={form.escalateOnNegativeSentiment}
              onChange={(v) => set("escalateOnNegativeSentiment", v)}
              label="Pasar siempre el chat si el cliente está molesto"
              hint="Un cliente enfadado rara vez se calma con un bot. Recomendado."
            />

            <Switch
              checked={form.handoffOnMedia}
              onChange={(v) => set("handoffOnMedia", v)}
              label="Pasar siempre el chat cuando el cliente envía una imagen o un documento"
              hint="Comprobantes de pago, recetas, formularios… La IA responde lo que le hayas indicado (por ejemplo, que una persona validará el pago) y el chat pasa a Pendiente para que alguien lo revise. Es la forma segura: no depende de que la IA decida pasarlo."
            />

            <div style={field}>
              <span style={lbl}>Qué le dice al cliente cuando te pasa el chat</span>
              <textarea
                className="field"
                style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                value={form.handoffMessage}
                maxLength={1000}
                placeholder="Un momento, por favor: te paso con una persona del equipo…"
                onChange={(e) => set("handoffMessage", e.target.value)}
                aria-label="Mensaje al pasar el chat"
              />
              <Hint>
                Así el cliente no se queda en silencio mientras alguien responde. Déjalo vacío si prefieres que no diga
                nada. En la bandeja, el chat queda como Pendiente con una nota interna que explica el motivo.
              </Hint>
            </div>
          </Card>
        )}

        {/* ── Modelo y gasto ── */}
        {tab === "gasto" && (
          <>
            <Card title="Qué IA usa" subtitle="Todas sirven para vender por WhatsApp. Empieza por la económica y sube solo si notas que se queda corta.">
              <div className="agent-models">
                {MODEL_OPTIONS.map((m) => {
                  const on = form.model === m.value;
                  const per1000 = costPerReply(m.value);
                  return (
                    <label key={m.value} className={`agent-model${on ? " is-on" : ""}`}>
                      <input type="radio" name="model" checked={on} onChange={() => set("model", m.value)} />
                      <span className="agent-model__body">
                        <span className="agent-model__title">
                          {m.title}
                          {m.recommended && <em>Recomendado</em>}
                        </span>
                        <small>{m.desc}</small>
                        <span className="agent-model__meta">
                          {m.provider} · {m.value}
                          {per1000 !== null && ` · ≈ ${usd(per1000 * 1000)} por 1.000 respuestas`}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {!MODEL_OPTIONS.some((m) => m.value === form.model) && (
                  <p className="agent-muted">
                    Modelo actual: <code>{form.model}</code>
                  </p>
                )}
              </div>
              <Hint>Los modelos de OpenAI necesitan tu clave de OpenAI; los Claude, tu clave de Anthropic (Ajustes › Inteligencia Artificial).</Hint>
            </Card>

            <Card title="Límite de gasto al mes" subtitle="Al llegar al límite deja de responder hasta el mes siguiente y sus chats pasan a tu equipo. El gasto se corta de verdad.">
              <BudgetPicker model={form.model} value={form.monthlyTokenBudget} onChange={(v) => set("monthlyTokenBudget", v)} />
              {!isNew && bot && <BudgetMeter bot={bot} limit={form.monthlyTokenBudget} model={form.model} />}
            </Card>

            <details className="agent-advanced">
              <summary>
                <NavIcon name="settings" size={14} />
                Ajustes avanzados
              </summary>
              <div className="agent-advanced__body">
                <div style={field}>
                  <span style={lbl}>Cuánto piensa antes de responder</span>
                  <div className="agent-options agent-options--row">
                    {effortValues.map((ef) => {
                      const on = form.effort === ef;
                      return (
                        <label key={ef} className={`agent-option${on ? " is-on" : ""}`}>
                          <input type="radio" name="effort" checked={on} onChange={() => set("effort", ef)} />
                          <span>
                            <strong>{EFFORT_LABEL[ef]?.title ?? ef}</strong>
                            <small>{EFFORT_LABEL[ef]?.desc}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div style={field}>
                  <span style={lbl}>
                    Consultas por respuesta: <strong style={{ color: "var(--text)" }}>{form.maxIterations}</strong>
                  </span>
                  <input type="range" min={1} max={20} value={form.maxIterations} onChange={(e) => set("maxIterations", Number(e.target.value))} style={{ width: "100%" }} />
                  <Hint>{iterationsHint(form.maxIterations)}</Hint>
                </div>
              </div>
            </details>
          </>
        )}
      </div>

      {/* Acciones: fijas abajo, alcanzables desde cualquier pestaña */}
      <div className="sticky-bar agent-actions" style={actionBar}>
        {!isNew && onDeleted && !bot?.isDefault && (
          <button onClick={onDeleted} style={{ ...ghostBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}>
            Eliminar
          </button>
        )}
        <span
          className={`agent-save-state${save.isError ? " is-error" : dirty ? " is-dirty" : justSaved ? " is-saved" : ""}`}
          role="status"
          aria-live="polite"
        >
          {save.isError ? (
            <>
              <NavIcon name="alert" size={13} /> {explainError((save.error as Error).message).text}
            </>
          ) : tooLong ? (
            <>
              <NavIcon name="alert" size={13} /> Hay un texto demasiado largo
            </>
          ) : dirty ? (
            <>
              <i aria-hidden /> Cambios sin guardar
            </>
          ) : justSaved ? (
            <>
              <NavIcon name="check" size={13} /> Guardado
            </>
          ) : isNew ? null : (
            "Todo guardado"
          )}
        </span>
        {isNew ? (
          <button onClick={cancel} style={ghostBtn} title="Cerrar sin guardar">
            Cancelar
          </button>
        ) : (
          dirty && (
            <button onClick={discard} style={ghostBtn}>
              Descartar
            </button>
          )
        )}
        <button onClick={() => save.mutate()} disabled={!canSave} style={primaryBtn} title="Ctrl+S">
          {save.isPending ? "Guardando…" : isNew ? "Crear agente" : "Guardar cambios"}
        </button>
      </div>

      {assist && (
        <PromptAssistant
          target={assist}
          title={ASSIST[assist].title}
          current={ASSIST[assist].current}
          botName={form.name}
          enabledTools={form.enabledTools}
          onApply={ASSIST[assist].apply}
          onClose={() => setAssist(null)}
        />
      )}
    </div>
  );
}

// ── Piezas ─────────────────────────────────────────────────────

function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="agent-card">
      <header className="agent-card__head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="agent-hint">{children}</span>;
}

/**
 * «Cómo debe atender» a pantalla grande: el mismo texto, con sitio para leerlo
 * entero y escribir con calma. Esc o «Listo» vuelven al editor; lo escrito ya
 * está en el formulario (se guarda con el resto).
 */
function PromptOverlay({
  value,
  onChange,
  onClose,
  onAssist,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onAssist: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  // En <body>: el panel del agente crea su propio contexto de apilamiento y,
  // dentro de él, el fondo fijo quedaba por debajo de la cabecera de la app.
  return createPortal(
    <div className="confirm-backdrop confirm-backdrop--top" onClick={onClose}>
      <div className="confirm-dialog prompt-overlay" role="dialog" aria-label="Cómo debe atender, en grande" onClick={(e) => e.stopPropagation()}>
        <header className="prompt-overlay__head">
          <div>
            <h3 style={{ margin: 0 }}>Cómo debe atender</h3>
            <span className="agent-hint">Qué vendes y a quién, el tono de tu marca, qué no debe hacer y cuándo pasarte el chat.</span>
          </div>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <AssistButton onClick={onAssist} />
            <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
              Listo
            </button>
          </span>
        </header>
        <textarea
          ref={ref}
          className="field prompt-overlay__text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Cómo debe atender, en grande"
          spellCheck
        />
        <footer className="prompt-overlay__foot">
          <span>
            {words} palabra{words === 1 ? "" : "s"} · {value.length} caracteres
          </span>
          <span>Esc para volver</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className={`agent-switch${checked ? " is-on" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="agent-switch__track" aria-hidden="true">
        <span />
      </span>
      <span className="agent-switch__text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

// Una acción sin datos (p. ej. sin etiquetas creadas) se puede activar igual,
// pero se avisa de que no hará nada hasta configurarla.
function copyToolName(name: string): void {
  const legacy = (): boolean => {
    try {
      const ta = document.createElement("textarea");
      ta.value = name;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const done = document.execCommand("copy");
      ta.remove();
      return done;
    } catch {
      return false;
    }
  };
  const finish = (done: boolean) => (done ? toast.success(`«${name}» copiado`) : toast.error("No se pudo copiar"));
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(name).then(() => finish(true), () => finish(legacy()));
  } else {
    finish(legacy());
  }
}

/**
 * Cómo referirse a las acciones en las instrucciones: la IA las conoce por su
 * nombre técnico, no por la etiqueta de la pantalla.
 */
function ToolNamesHelp({ tools }: { tools: AgentToolInfo[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="agent-toolnames" data-tour="agents-toolnames">
      <button type="button" className="agent-toolnames__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <NavIcon name="bolt" size={13} />
        Cómo nombrar sus acciones en las instrucciones
        <span style={{ marginLeft: "auto", display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <NavIcon name="arrow-down" size={11} />
        </span>
      </button>
      {open && (
        <div className="agent-toolnames__body">
          {tools.length === 0 ? (
            <p>Este agente no tiene acciones activas. Actívalas en la pestaña «Qué puede hacer».</p>
          ) : (
            <>
              <p>
                La IA conoce cada acción por su nombre técnico. Para que la use en un caso concreto, nómbrala así,
                por ejemplo: «usa la herramienta <code>{tools.find((t) => t.name === "handoff_to_human")?.name ?? tools[0]!.name}</code> con el motivo…».
              </p>
              <ul>
                {tools.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code>
                    <span>{TOOL_COPY[t.name]?.title ?? t.label}</span>
                    <button type="button" onClick={() => copyToolName(t.name)} aria-label={`Copiar el nombre ${t.name}`}>
                      <NavIcon name="copy" size={11} /> copiar
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToolRow({ tool, checked, onToggle }: { tool: AgentToolInfo; checked: boolean; onToggle: () => void }) {
  const copy = TOOL_COPY[tool.name];
  return (
    <label className={`agent-tool${checked ? " is-on" : ""}`} title={tool.name}>
      <span className="agent-tool__icon">
        <NavIcon name={copy?.icon ?? "bolt"} size={16} />
      </span>
      <span className="agent-tool__body">
        <strong>
          {copy?.title ?? tool.label}
          {copy?.recommended && <em>Recomendado</em>}
        </strong>
        {copy && <small>{copy.desc}</small>}
        <span className="agent-tool__name" title="Así se llama para la IA: úsalo en «Cómo debe atender»">
          <code>{tool.name}</code>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              copyToolName(tool.name);
            }}
            aria-label={`Copiar el nombre ${tool.name}`}
          >
            <NavIcon name="copy" size={11} /> copiar
          </button>
        </span>
        {tool.unavailableReason && (
          <span className="agent-tool__warn">
            <NavIcon name="alert" size={13} />
            {tool.unavailableReason}
          </span>
        )}
      </span>
      <input type="checkbox" checked={checked} onChange={onToggle} className="agent-tool__check" />
      <span className="agent-switch__track" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

/** Presupuesto en dólares, convertido a tokens según el modelo. */
function BudgetPicker({ model, value, onChange }: { model: string; value: number; onChange: (v: number) => void }) {
  const [custom, setCustom] = useState(false);
  const priced = costPerReply(model) !== null;
  const presets = BUDGET_USD.map((u) => ({ usd: u, tokens: tokensForUsd(model, u) }));
  const current = usdForTokens(model, value);
  const perReply = costPerReply(model);
  return (
    <div style={field}>
      <div className="agent-chips">
        <button type="button" className={`agent-chip${value === 0 ? " is-on" : ""}`} onClick={() => onChange(0)}>
          Sin límite
        </button>
        {priced &&
          presets.map((p) => (
            <button
              key={p.usd}
              type="button"
              className={`agent-chip${p.tokens !== null && value === p.tokens ? " is-on" : ""}`}
              onClick={() => p.tokens !== null && onChange(p.tokens)}
            >
              USD {p.usd} al mes
            </button>
          ))}
        <button type="button" className={`agent-chip${custom ? " is-on" : ""}`} onClick={() => setCustom((c) => !c)}>
          Otra cantidad
        </button>
      </div>
      {(custom || !priced) && (
        <div className="agent-custom">
          <input type="number" min={0} step={10000} className="field" value={value} onChange={(e) => onChange(Number(e.target.value))} />
          <span className="agent-hint">tokens al mes (0 = sin límite). Un token es un trocito de texto; una respuesta usa unos 1.500.</span>
        </div>
      )}
      <Hint>
        {value <= 0
          ? "Sin límite: el agente responde siempre. Vigila el consumo en Ajustes › Consumo de IA."
          : perReply !== null && current !== null
            ? `Unos ${usd(current)} al mes: alcanza para aproximadamente ${Math.round(current / perReply).toLocaleString("es")} respuestas.`
            : `Alcanza para unas ${Math.round(value / 1500).toLocaleString("es")} respuestas al mes.`}
      </Hint>
    </div>
  );
}

/** Consumo real del mes frente al presupuesto. Sin esto el número es ciego. */
function BudgetMeter({ bot, limit, model }: { bot: BotDto; limit: number; model: string }) {
  const spent = bot.tokensThisMonth;
  const spentUsd = usdForTokens(model, spent);
  const spentText = spentUsd !== null ? `≈ ${usd(spentUsd)}` : `${spent.toLocaleString("es")} tokens`;
  if (limit <= 0) {
    return <span className="agent-hint">Este mes lleva {spentText} ({spent.toLocaleString("es")} tokens).</span>;
  }
  const pct = Math.min(100, Math.round((spent / limit) * 100));
  const over = spent >= limit;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={meterTrack}>
        <div
          style={{
            ...meterFill,
            transform: `scaleX(${pct / 100})`,
            background: over ? "var(--danger)" : pct > 80 ? "var(--warning)" : "var(--accent)",
          }}
        />
      </div>
      <span className="agent-hint" style={{ color: over ? "#e08a8a" : undefined }}>
        Este mes: {spentText} · {pct} % del límite{over ? " · agotado, el agente no responde" : ""}
      </span>
    </div>
  );
}

function BusinessHoursEditor({ value, onChange, onAssist }: { value: BusinessHours; onChange: (h: BusinessHours) => void; onAssist?: () => void }) {
  function setDay(d: Weekday, range: { from: string; to: string } | null) {
    onChange({ ...value, days: { ...value.days, [d]: range } });
  }
  const known = TIMEZONES.some((t) => t.value === value.timezone);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      <div style={field}>
        <span style={lbl}>Zona horaria</span>
        <select className="field" value={value.timezone} onChange={(e) => onChange({ ...value, timezone: e.target.value })}>
          {!known && <option value={value.timezone}>{value.timezone}</option>}
          {TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {weekday.map((d) => {
        const range = value.days?.[d] ?? null;
        const openDay = !!range;
        return (
          <div key={d} className="agent-day">
            <label style={{ display: "flex", alignItems: "center", gap: 6, width: 120 }}>
              <input type="checkbox" checked={openDay} onChange={(e) => setDay(d, e.target.checked ? { from: "09:00", to: "18:00" } : null)} />
              {WEEKDAY_LABEL[d]}
            </label>
            {openDay && range ? (
              <>
                <input type="time" style={{ ...input, width: 110 }} value={range.from} onChange={(e) => setDay(d, { ...range, from: e.target.value })} />
                <span style={{ color: "var(--muted)" }}>a</span>
                <input type="time" style={{ ...input, width: 110 }} value={range.to} onChange={(e) => setDay(d, { ...range, to: e.target.value })} />
              </>
            ) : (
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Cerrado</span>
            )}
          </div>
        );
      })}
      <div style={field}>
        <div className="agent-card__head" style={{ marginBottom: 0 }}>
          <span style={lbl}>Mensaje fuera de horario</span>
          {onAssist && <AssistButton onClick={onAssist} />}
        </div>
        <textarea
          className="field"
          style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
          value={value.outOfHoursMessage ?? ""}
          maxLength={MAX_TEXT}
          onChange={(e) => onChange({ ...value, outOfHoursMessage: e.target.value })}
        />
        <Counter value={value.outOfHoursMessage ?? ""} max={MAX_TEXT} />
      </div>
    </div>
  );
}

function KeywordTriggersEditor({ value, onChange }: { value: KeywordTrigger[]; onChange: (t: KeywordTrigger[]) => void }) {
  // Lo que se está escribiendo en «Si el cliente escribe», sin normalizar
  // hasta salir del campo: si no, el espacio de «medios de pago» desaparecía.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const parseKeywords = (raw: string) => raw.split(",").map((k) => k.trim()).filter(Boolean);
  // Catálogos para las condiciones de las versiones (etiquetas, etapas, fuentes…).
  const { data: tags = [] } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const { data: sources = [] } = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const { data: fields = [] } = useQuery({ queryKey: ["custom-fields"], queryFn: fetchCustomFields });
  const { data: stages = [] } = useQuery({ queryKey: ["stages-ref"], queryFn: fetchStages });
  const { data: channels = [] } = useQuery({ queryKey: ["wa-channels"], queryFn: fetchWhatsappChannels });
  const { data: agents = [] } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const lookups: RuleLookups = {
    variables: [],
    fields,
    tags,
    sources,
    stages: stages.map((s) => ({ id: s.id, name: `${s.pipelineName} › ${s.name}` })),
    channels: channels.map((c) => ({ id: c.id, label: c.label ?? null, displayPhoneNumber: c.displayPhoneNumber ?? null })),
    agents: agents.map((a) => ({ id: a.id, name: a.name ?? null, email: a.email })),
  };
  function update(i: number, patch: Partial<KeywordTrigger>) {
    onChange(value.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {value.map((t, i) => (
        <div key={i} className="agent-trigger">
          <div style={field}>
            <span style={lbl}>Si el cliente escribe</span>
            <input
              className="field"
              value={drafts[i] ?? t.keywords.join(", ")}
              placeholder="medios de pago, cuenta, transferencia"
              aria-label={`Respuesta ${i + 1}: palabras`}
              onChange={(e) => {
                setDrafts({ ...drafts, [i]: e.target.value });
                update(i, { keywords: parseKeywords(e.target.value) });
              }}
              onBlur={() => setDrafts(({ [i]: _done, ...rest }) => rest)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ ...field, flex: 1 }}>
              <span style={lbl}>Entonces</span>
              <select className="field" value={t.action} onChange={(e) => update(i, { action: e.target.value as KeywordAction })}>
                {keywordActions.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABEL[a]}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              style={{ ...ghostBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}
              title="Quitar"
              aria-label="Quitar esta respuesta"
            >
              <NavIcon name="x" size={14} />
            </button>
          </div>
          {t.action === "reply" && (
            <>
              <div style={field}>
                <span style={lbl}>{(t.variants ?? []).length ? "Texto general (los demás países)" : "Texto que se responde"}</span>
                <textarea
                  className="field"
                  style={{ minHeight: 50, resize: "vertical", fontFamily: "inherit" }}
                  value={t.value ?? ""}
                  maxLength={MAX_TEXT}
                  placeholder="Ej. Puedes pagar por transferencia a la cuenta… o con Yape al…"
                  onChange={(e) => update(i, { value: e.target.value })}
                  aria-label={`Respuesta ${i + 1}: texto general`}
                />
              </div>
              <Counter value={t.value ?? ""} max={MAX_TEXT} />
              <KeywordVariantsEditor
                index={i}
                value={t.variants ?? []}
                onChange={(variants) => update(i, { variants })}
                lookups={lookups}
              />
            </>
          )}
        </div>
      ))}
      <button onClick={() => onChange([...value, { keywords: [], action: "reply", value: "", variants: [] }])} style={{ ...ghostBtn, alignSelf: "flex-start" }}>
        <NavIcon name="plus" size={14} /> Añadir respuesta por palabra
      </button>
    </div>
  );
}

/**
 * Versiones de una respuesta fija según el país del cliente (por el prefijo
 * de su teléfono): medios de pago, direcciones, envíos… Quien no tenga la
 * suya recibe el texto general.
 */
const PREFERRED_COUNTRIES = ["PE", "MX", "CO", "CL", "AR", "EC", "BO", "ES", "US"];

/** Una condición en una frase corta, para el título de la versión. */
function describeRule(r: FlowRule, lookups: RuleLookups): string {
  const field = CONDITION_FIELD_BY[r.field]?.label ?? r.field;
  const op = OP_LABEL[r.op] ?? r.op;
  let value = r.value ?? "";
  if (r.field === "country") value = COUNTRIES.find((c) => c.code === value)?.name ?? value;
  if (r.field === "stage") value = lookups.stages.find((x) => x.id === value)?.name ?? value;
  if (r.field === "source") value = lookups.sources.find((x) => x.id === value)?.name ?? value;
  if (r.field === "channel") { const ch = lookups.channels.find((x) => x.id === value); value = ch?.label ?? ch?.displayPhoneNumber ?? value; }
  if (r.op === "empty" || r.op === "not_empty") return `${field} ${op}`;
  return `${field} ${op} ${value || "…"}`;
}

/**
 * Versiones de una respuesta fija según condiciones del cliente (país por el
 * prefijo de su teléfono, etiqueta, etapa, fuente, número…): medios de pago,
 * direcciones, envíos… Se prueban en orden; quien no cumpla ninguna recibe el
 * texto general.
 */
function KeywordVariantsEditor({
  index,
  value,
  onChange,
  lookups,
}: {
  index: number;
  value: KeywordVariant[];
  onChange: (v: KeywordVariant[]) => void;
  lookups: RuleLookups;
}) {
  const rulesOf = (v: KeywordVariant): FlowRule[] => (Array.isArray(v.rules) ? v.rules : []);
  const usedCountries = new Set(value.flatMap((v) => rulesOf(v).filter((r) => r.field === "country" && r.op === "is").map((r) => r.value ?? "")));
  const nextCountry = [...PREFERRED_COUNTRIES, ...COUNTRIES.map((c) => c.code)].find((code) => !usedCountries.has(code)) ?? "PE";
  const update = (i: number, patch: Partial<KeywordVariant>) => onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  return (
    <div className="agent-variants">
      {value.map((v, i) => (
        <div key={i} className="agent-variant" data-variant={`${index}-${i}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ ...lbl, marginBottom: 0 }}>
              Versión {i + 1} · {rulesOf(v).map((r) => describeRule(r, lookups)).join((v.match ?? "all") === "any" ? " o " : " y ")}
            </span>
            <span style={{ flex: 1 }} />
            {rulesOf(v).length > 1 && (
              <div className="seg" role="tablist" aria-label={`Respuesta ${index + 1}, versión ${i + 1}: cómo se combinan`}>
                <button type="button" role="tab" aria-selected={(v.match ?? "all") === "all"} onClick={() => update(i, { match: "all" })}>
                  todas
                </button>
                <button type="button" role="tab" aria-selected={v.match === "any"} onClick={() => update(i, { match: "any" })}>
                  alguna
                </button>
              </div>
            )}
            <button
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              style={{ ...ghostBtn, ...smBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}
              title="Quitar esta versión"
              aria-label={`Respuesta ${index + 1}: quitar versión ${i + 1}`}
            >
              <NavIcon name="x" size={13} />
            </button>
          </div>
          {rulesOf(v).map((r, ri) => (
            <RuleRow
              key={r.id}
              rule={r}
              lookups={lookups}
              onChange={(p) => update(i, { rules: rulesOf(v).map((x, idx) => (idx === ri ? { ...x, ...p } : x)) })}
              onRemove={() =>
                rulesOf(v).length > 1
                  ? update(i, { rules: rulesOf(v).filter((_, idx) => idx !== ri) })
                  : onChange(value.filter((_, idx) => idx !== i))
              }
            />
          ))}
          <button
            type="button"
            onClick={() => update(i, { rules: [...rulesOf(v), newRule("tag", "is", "")] })}
            style={{ ...ghostBtn, ...smBtn, alignSelf: "flex-start" }}
            aria-label={`Respuesta ${index + 1}, versión ${i + 1}: añadir condición`}
          >
            + Añadir condición
          </button>
          <textarea
            className="field"
            style={{ minHeight: 50, resize: "vertical", fontFamily: "inherit" }}
            value={v.value}
            maxLength={MAX_TEXT}
            placeholder="Texto solo para quien cumpla estas condiciones…"
            onChange={(e) => update(i, { value: e.target.value })}
            aria-label={`Respuesta ${index + 1}: texto de la versión ${i + 1}`}
          />
          <Counter value={v.value} max={MAX_TEXT} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => onChange([...value, { rules: [newRule("country", "is", nextCountry)], match: "all", value: "" }])}
          style={{ ...ghostBtn, ...smBtn }}
          aria-label={`Respuesta ${index + 1}: añadir versión`}
        >
          <NavIcon name="plus" size={13} /> Versión con condiciones
        </button>
        <span className="agent-hint">
          {value.length
            ? "Se prueban en orden y gana la primera que se cumple; el país sale del prefijo del teléfono (+51 Perú, +52 México…)."
            : "¿Cuentas, direcciones o envíos distintos según el país, la etiqueta o la etapa del cliente? Añade versiones; los demás reciben el texto general."}
        </span>
      </div>
    </div>
  );
}

// Abre el asistente de redacción para el campo de al lado.
function AssistButton({ onClick, align }: { onClick: () => void; align?: "end" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...ghostBtn, ...smBtn, alignSelf: align === "end" ? "flex-end" : undefined }}
      title="Redactar o mejorar este texto con IA"
      data-tour="agents-assist"
    >
      <NavIcon name="sparkles" size={13} /> Asistente
    </button>
  );
}

// Siempre visible: da igual en qué pestaña estés, guardar está a un clic.
const actionBar: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 0",
  borderTop: "1px solid var(--border)",
  background: "var(--panel-2)",
};

const meterTrack: React.CSSProperties = {
  height: 6,
  borderRadius: 999,
  background: "var(--field)",
  overflow: "hidden",
  marginBottom: 4,
};

// Se anima con transform (no con width) para no recalcular el layout.
const meterFill: React.CSSProperties = {
  width: "100%",
  height: "100%",
  borderRadius: 999,
  transformOrigin: "left",
  transition: "transform 300ms cubic-bezier(0.22,1,0.36,1)",
};
