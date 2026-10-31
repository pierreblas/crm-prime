"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AGENT_GOALS,
  AGENT_GOAL_INFO,
  AGENT_TONES,
  AGENT_TONE_INFO,
  BUSINESS_TYPES,
  BUSINESS_TYPE_KEYS,
  SETUP_DAY_PRESETS,
  businessSetupSchema,
  hoursLabel,
  welcomeMessageFor,
  type AgentGoal,
  type AgentTone,
  type BusinessSetupInput,
  type BusinessSetupState,
  type BusinessType,
  type SetupAgentResult,
  type SetupDayPreset,
  type SetupKnowledgeResult,
  type SetupProfileResult,
} from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { buildBusinessAgent, buildBusinessKnowledge, fetchBusinessSetup, saveBusinessProfile } from "@/lib/bff";
import "./setup.css";

/**
 * Asistente de bienvenida: lo primero que ve una empresa recién creada.
 *
 * Cinco pantallas cortas (rubro, negocio, agente, lo que sabe, cómo atiende)
 * con una vista previa del chat que cambia con cada respuesta, y al final una
 * pantalla de carga que enseña lo que Driony construye de verdad: cada línea
 * se marca cuando la fase correspondiente terminó en el servidor, no antes.
 *
 * Solo el rubro y el nombre del agente son obligatorios; lo demás se puede
 * omitir y completar después desde cada sección.
 */

const STEPS = [
  { key: "tipo", label: "Tu rubro" },
  { key: "negocio", label: "Tu negocio" },
  { key: "agente", label: "Tu agente" },
  { key: "saber", label: "Lo que sabe" },
  { key: "atencion", label: "Cómo atiende" },
] as const;

const TYPE_ICON: Record<BusinessType, IconName> = {
  tienda: "store",
  restaurante: "utensils",
  salud: "stethoscope",
  belleza: "scissors",
  inmobiliaria: "home",
  educacion: "graduation",
  servicios: "briefcase",
  automotriz: "car",
  turismo: "plane",
  otro: "puzzle",
};

const GOAL_ICON: Record<AgentGoal, IconName> = { vender: "tag", agendar: "clock", soporte: "book", datos: "user" };

const DAY_SHORT: Record<SetupDayPreset, string> = { lv: "Lun a vie", ls: "Lun a sáb", all: "Todos los días" };

const DRAFT_KEY = "driony-setup-draft";

interface Draft {
  businessType: BusinessType | null;
  description: string;
  city: string;
  website: string;
  agentName: string;
  goal: AgentGoal;
  tone: AgentTone;
  answers: Record<string, string>;
  extra: string;
  autopilot: boolean;
  welcome: boolean;
  hoursOn: boolean;
  days: SetupDayPreset;
  from: string;
  to: string;
}

const EMPTY: Draft = {
  businessType: null,
  description: "",
  city: "",
  website: "",
  agentName: "",
  goal: "vender",
  tone: "cercano",
  answers: {},
  extra: "",
  autopilot: true,
  welcome: true,
  hoursOn: false,
  days: "ls",
  from: "09:00",
  to: "19:00",
};

function fromProfile(p: BusinessSetupInput): Draft {
  return {
    ...EMPTY,
    ...p,
    hoursOn: !!p.hours,
    days: p.hours?.days ?? EMPTY.days,
    from: p.hours?.from ?? EMPTY.from,
    to: p.hours?.to ?? EMPTY.to,
  };
}

/** Lo guardado del intento anterior, o un borrador de esta pestaña, o vacío. */
function initialDraft(state: BusinessSetupState): Draft {
  if (state.profile) return fromProfile(state.profile);
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* sin almacenamiento: se empieza de cero */
  }
  return EMPTY;
}

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima";
  } catch {
    return "America/Lima";
  }
}

/** El borrador tal como lo espera la API (solo las respuestas de su rubro). */
function toInput(d: Draft): ReturnType<typeof businessSetupSchema.safeParse> {
  const keys = new Set(d.businessType ? BUSINESS_TYPES[d.businessType].faq.map((f) => f.key) : []);
  return businessSetupSchema.safeParse({
    businessType: d.businessType,
    description: d.description,
    city: d.city,
    website: d.website,
    agentName: d.agentName,
    goal: d.goal,
    tone: d.tone,
    answers: Object.fromEntries(Object.entries(d.answers).filter(([k, v]) => keys.has(k) && v.trim())),
    extra: d.extra,
    autopilot: d.autopilot,
    welcome: d.welcome,
    hours: d.hoursOn ? { days: d.days, from: d.from, to: d.to } : null,
    timezone: timezone(),
  });
}

/** En qué pantalla vive cada campo, para volver a ella si algo no vale. */
const STEP_OF: Record<string, number> = {
  businessType: 0,
  description: 1,
  city: 1,
  website: 1,
  agentName: 2,
  goal: 2,
  tone: 2,
  answers: 3,
  extra: 3,
  hours: 4,
};

export function SetupWizard({ userName }: { userName: string | null }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["business-setup"],
    queryFn: fetchBusinessSetup,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (isPending) {
    return (
      <div className="sw">
        <TopBar step={-1} />
        <div className="sw-loading" role="status">
          <span className="sw-spinner" aria-hidden="true" /> Preparando tu asistente…
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="sw">
        <TopBar step={-1} />
        <div className="sw-loading" role="alert">
          No se pudo cargar el asistente.
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refetch()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }
  return <Wizard state={data} userName={userName} />;
}

function Wizard({ state, userName }: { state: BusinessSetupState; userName: string | null }) {
  const [stage, setStage] = useState<"form" | "build" | "done">("form");
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(state));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [input, setInput] = useState<BusinessSetupInput | null>(null);
  const [results, setResults] = useState<BuildResults>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* sin almacenamiento, no pasa nada */
    }
  }, [draft]);

  // Al cambiar de pantalla, el foco va al título (lectores de pantalla y
  // teclado) y la página vuelve arriba; en la primera, no se mueve nada.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, stage]);

  const def = draft.businessType ? BUSINESS_TYPES[draft.businessType] : null;
  const agentName = draft.agentName.trim() || def?.agentName || "Tu agente";
  const first = userName?.trim().split(/\s+/)[0] ?? "";

  function pickType(t: BusinessType) {
    setDraft((d) => {
      const prev = d.businessType ? BUSINESS_TYPES[d.businessType] : null;
      // El nombre y la misión sugeridos siguen al rubro mientras la persona no los cambie.
      const nameIsSuggested = !d.agentName.trim() || d.agentName === prev?.agentName;
      const goalIsSuggested = !prev || d.goal === prev.goal;
      return {
        ...d,
        businessType: t,
        agentName: nameIsSuggested ? BUSINESS_TYPES[t].agentName : d.agentName,
        goal: goalIsSuggested ? BUSINESS_TYPES[t].goal : d.goal,
      };
    });
    setErrors({});
  }

  function validateStep(i: number): boolean {
    const e: Record<string, string> = {};
    if (i === 0 && !draft.businessType) e.businessType = "Elige el que más se parezca; «Otro» también vale.";
    if (i === 1 && draft.website.trim()) {
      const ok = businessSetupSchema.shape.website.safeParse(draft.website);
      if (!ok.success) e.website = ok.error.issues[0]?.message ?? "Dirección no válida";
    }
    if (i === 2 && !draft.agentName.trim()) e.agentName = "Ponle un nombre a tu agente";
    if (i === 4 && draft.hoursOn && draft.from >= draft.to) e.hours = "La hora de cierre debe ser después de la de apertura";
    setErrors(e);
    return Object.values(e).every((m) => !m);
  }

  function next() {
    if (!validateStep(step)) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    const parsed = toInput(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? "");
      setErrors({ [field]: issue?.message ?? "Revisa este dato" });
      setStep(STEP_OF[field] ?? 0);
      return;
    }
    setInput(parsed.data);
    setResults({});
    setStage("build");
  }

  if (stage === "build" && input) {
    return (
      <div className="sw">
        <TopBar step={STEPS.length} />
        <Build
          input={input}
          orgName={state.orgName}
          headingRef={headingRef}
          onBack={() => setStage("form")}
          onDone={(r) => {
            setResults(r);
            setStage("done");
            try {
              sessionStorage.removeItem(DRAFT_KEY);
            } catch {
              /* nada */
            }
          }}
        />
      </div>
    );
  }

  if (stage === "done" && input) {
    return (
      <div className="sw">
        <TopBar step={STEPS.length} />
        <Done input={input} orgName={state.orgName} results={results} aiReady={state.aiReady} headingRef={headingRef} />
      </div>
    );
  }

  const optional = step === 1 || step === 3;
  const filled =
    step === 1
      ? !!(draft.description.trim() || draft.city.trim() || draft.website.trim())
      : step === 3
        ? Object.values(draft.answers).some((v) => v.trim()) || !!draft.extra.trim()
        : true;
  const last = step === STEPS.length - 1;

  return (
    <div className="sw">
      <TopBar step={step} onStep={(i) => i < step && setStep(i)} />
      <main className="sw-main">
        <form
          className="sw-pane"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <div key={step} className="sw-step">
            {step === 0 && (
              <>
                <header className="sw-head">
                  {first && <p className="sw-hello">Hola, {first}. Te damos la bienvenida a Driony.</p>}
                  <h1 ref={headingRef} tabIndex={-1}>
                    ¿Qué tipo de negocio es {state.orgName}?
                  </h1>
                  <p>
                    En unos minutos armamos tu IA de WhatsApp: aprende tu rubro, adapta tu embudo de ventas y responde
                    con tus datos. Todo se puede cambiar después.
                  </p>
                </header>
                {state.completedAt && (
                  <p className="sw-note">
                    <NavIcon name="alert" size={15} />
                    <span>
                      Ya armaste tu IA el{" "}
                      {new Date(state.completedAt).toLocaleDateString("es", { day: "numeric", month: "long" })}. Si la
                      construyes otra vez, reemplazamos las instrucciones de tu agente; las respuestas rápidas y el
                      embudo que hayas editado se respetan.
                    </span>
                  </p>
                )}
                <div className="sw-types" role="radiogroup" aria-label="Tipo de negocio" aria-describedby="sw-type-err">
                  {BUSINESS_TYPE_KEYS.map((t) => {
                    const on = draft.businessType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`sw-type${on ? " is-on" : ""}`}
                        onClick={() => pickType(t)}
                      >
                        <span className="sw-type__icon">
                          <NavIcon name={TYPE_ICON[t]} size={18} />
                        </span>
                        <span className="sw-type__text">
                          <strong>{BUSINESS_TYPES[t].label}</strong>
                          <small>{BUSINESS_TYPES[t].hint}</small>
                        </span>
                        <span className="sw-type__check" aria-hidden="true">
                          <NavIcon name="check" size={13} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <FieldError id="sw-type-err" message={errors.businessType} />
              </>
            )}

            {step === 1 && def && (
              <>
                <header className="sw-head">
                  <h1 ref={headingRef} tabIndex={-1}>
                    Cuéntanos de {state.orgName}
                  </h1>
                  <p>Tu IA se presenta y vende con esto. Dos frases bastan; si prefieres, sigue sin rellenarlo.</p>
                </header>
                <label className="sw-field">
                  <span>Qué vendes y a quién</span>
                  <textarea
                    className="field"
                    rows={3}
                    maxLength={1200}
                    value={draft.description}
                    placeholder={`Ej.: ${def.describe}`}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </label>
                <div className="sw-row">
                  <label className="sw-field">
                    <span>
                      Ciudad o zona <em>opcional</em>
                    </span>
                    <input
                      className="field"
                      value={draft.city}
                      maxLength={120}
                      autoComplete="address-level2"
                      placeholder="Ej.: Lima, Bogotá, Ciudad de México"
                      onChange={(e) => set("city", e.target.value)}
                    />
                  </label>
                  <label className="sw-field">
                    <span>
                      Tu web <em>opcional</em>
                    </span>
                    <input
                      className="field"
                      value={draft.website}
                      maxLength={300}
                      inputMode="url"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="tutienda.com"
                      aria-invalid={!!errors.website}
                      aria-describedby="sw-web-hint"
                      onChange={(e) => set("website", e.target.value)}
                    />
                    {errors.website ? (
                      <FieldError id="sw-web-hint" message={errors.website} />
                    ) : (
                      <small id="sw-web-hint">Si tienes web, tu IA la lee y aprende de ella.</small>
                    )}
                  </label>
                </div>
              </>
            )}

            {step === 2 && def && (
              <>
                <header className="sw-head">
                  <h1 ref={headingRef} tabIndex={-1}>
                    Conoce a tu agente
                  </h1>
                  <p>Es quien responde tus WhatsApp. Elige cómo se llama, qué busca en cada chat y cómo habla.</p>
                </header>
                <label className="sw-field">
                  <span>Su nombre</span>
                  <input
                    className="field"
                    value={draft.agentName}
                    maxLength={60}
                    aria-invalid={!!errors.agentName}
                    aria-describedby="sw-name-hint"
                    onChange={(e) => set("agentName", e.target.value)}
                  />
                  {errors.agentName ? (
                    <FieldError id="sw-name-hint" message={errors.agentName} />
                  ) : (
                    <small id="sw-name-hint">Con nombre de persona, en el chat se presentará así.</small>
                  )}
                </label>
                <div className="sw-chips" aria-label="Sugerencias de nombre">
                  {[...new Set([def.agentName, `Asistente de ${state.orgName}`, state.orgName])].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`sw-chip${draft.agentName === n ? " is-on" : ""}`}
                      aria-pressed={draft.agentName === n}
                      onClick={() => set("agentName", n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                <fieldset className="sw-group">
                  <legend>Su misión</legend>
                  <div className="sw-options" role="radiogroup" aria-label="Misión">
                    {AGENT_GOALS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        role="radio"
                        aria-checked={draft.goal === g}
                        className={`sw-option${draft.goal === g ? " is-on" : ""}`}
                        onClick={() => set("goal", g)}
                      >
                        <NavIcon name={GOAL_ICON[g]} size={17} />
                        <span>
                          <strong>
                            {AGENT_GOAL_INFO[g].title}
                            {def.goal === g && <em>Lo habitual en tu rubro</em>}
                          </strong>
                          <small>{AGENT_GOAL_INFO[g].desc}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="sw-group">
                  <legend>Cómo habla</legend>
                  <div className="sw-tones" role="radiogroup" aria-label="Tono">
                    {AGENT_TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={draft.tone === t}
                        className={`sw-tone${draft.tone === t ? " is-on" : ""}`}
                        onClick={() => set("tone", t)}
                      >
                        <strong>{AGENT_TONE_INFO[t].title}</strong>
                        <small>{AGENT_TONE_INFO[t].sample}</small>
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}

            {step === 3 && def && (
              <>
                <header className="sw-head">
                  <h1 ref={headingRef} tabIndex={-1}>
                    Lo que {agentName} debe saber
                  </h1>
                  <p>
                    Responde lo que más te preguntan. Tu IA contesta con esto y tu equipo lo tendrá como respuestas
                    rápidas en el chat. Deja en blanco lo que no aplique.
                  </p>
                </header>
                {def.faq.map((f) => (
                  <label key={f.key} className="sw-field">
                    <span>
                      {f.question} <code className="sw-shortcut">{f.shortcut}</code>
                    </span>
                    <textarea
                      className="field"
                      rows={2}
                      maxLength={1500}
                      value={draft.answers[f.key] ?? ""}
                      placeholder={`Ej.: ${f.placeholder}`}
                      onChange={(e) => set("answers", { ...draft.answers, [f.key]: e.target.value })}
                    />
                  </label>
                ))}
                <label className="sw-field">
                  <span>
                    Algo más que deba saber <em>opcional</em>
                  </span>
                  <textarea
                    className="field"
                    rows={2}
                    maxLength={2000}
                    value={draft.extra}
                    placeholder="Ej.: no damos descuentos; los pedidos grandes se coordinan con una persona"
                    onChange={(e) => set("extra", e.target.value)}
                  />
                </label>
              </>
            )}

            {step === 4 && (
              <>
                <header className="sw-head">
                  <h1 ref={headingRef} tabIndex={-1}>
                    Cómo atiende {agentName}
                  </h1>
                  <p>Puedes tomar cualquier conversación cuando quieras. Esto solo define cómo empieza.</p>
                </header>

                <fieldset className="sw-group">
                  <legend>En los chats nuevos</legend>
                  <div className="sw-options sw-options--2" role="radiogroup" aria-label="Modo">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.autopilot}
                      className={`sw-option${draft.autopilot ? " is-on" : ""}`}
                      onClick={() => set("autopilot", true)}
                    >
                      <NavIcon name="zap" size={17} />
                      <span>
                        <strong>Responde sola</strong>
                        <small>Contesta al momento, sin esperar a nadie. Te pasa el chat cuando hace falta.</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!draft.autopilot}
                      className={`sw-option${!draft.autopilot ? " is-on" : ""}`}
                      onClick={() => set("autopilot", false)}
                    >
                      <NavIcon name="check-double" size={17} />
                      <span>
                        <strong>Te sugiere</strong>
                        <small>Redacta cada respuesta y tu equipo la aprueba antes de enviarla.</small>
                      </span>
                    </button>
                  </div>
                </fieldset>

                <fieldset className="sw-group">
                  <legend>Cuándo responde</legend>
                  <div className="seg sw-seg" role="radiogroup" aria-label="Horario">
                    <button type="button" role="radio" aria-checked={!draft.hoursOn} onClick={() => set("hoursOn", false)}>
                      A toda hora
                    </button>
                    <button type="button" role="radio" aria-checked={draft.hoursOn} onClick={() => set("hoursOn", true)}>
                      Solo en mi horario
                    </button>
                  </div>
                  {draft.hoursOn ? (
                    <div className="sw-hours">
                      <div className="sw-chips" role="radiogroup" aria-label="Días">
                        {SETUP_DAY_PRESETS.map((d) => (
                          <button
                            key={d}
                            type="button"
                            role="radio"
                            aria-checked={draft.days === d}
                            className={`sw-chip${draft.days === d ? " is-on" : ""}`}
                            onClick={() => set("days", d)}
                          >
                            {DAY_SHORT[d]}
                          </button>
                        ))}
                      </div>
                      <div className="sw-time">
                        <label>
                          <span>Abre</span>
                          <input className="field" type="time" value={draft.from} onChange={(e) => set("from", e.target.value)} />
                        </label>
                        <label>
                          <span>Cierra</span>
                          <input
                            className="field"
                            type="time"
                            value={draft.to}
                            aria-invalid={!!errors.hours}
                            onChange={(e) => {
                              set("to", e.target.value);
                              if (errors.hours) setErrors((x) => ({ ...x, hours: "" }));
                            }}
                          />
                        </label>
                      </div>
                      <FieldError message={errors.hours} />
                      <small className="sw-hint">Fuera de ese horario envía un aviso y deja el chat para tu equipo.</small>
                    </div>
                  ) : (
                    <small className="sw-hint">Responde también de noche y los fines de semana: ningún cliente se queda esperando.</small>
                  )}
                </fieldset>

                <label className={`agent-switch sw-switch${draft.welcome ? " is-on" : ""}`}>
                  <input type="checkbox" checked={draft.welcome} onChange={(e) => set("welcome", e.target.checked)} />
                  <span className="agent-switch__track" aria-hidden="true">
                    <span />
                  </span>
                  <span className="agent-switch__text">
                    <strong>Saludar al primer mensaje</strong>
                    <small>Un saludo con su nombre y el de tu negocio, al instante.</small>
                  </span>
                </label>

                {!state.aiReady && (
                  <p className="sw-note">
                    <NavIcon name="alert" size={15} />
                    <span>
                      Ahora mismo no hay IA activa en tu cuenta: armaremos tu agente con una plantilla completa y
                      responderá en cuanto la actives en Ajustes › Inteligencia artificial.
                    </span>
                  </p>
                )}
              </>
            )}
          </div>

          <footer className="sw-foot">
            {step > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
                <NavIcon name="arrow-left" size={15} /> Atrás
              </button>
            ) : (
              <Link href="/getting-started" className="sw-later">
                Configurar después
              </Link>
            )}
            <span className="sw-foot__count">
              {step + 1} de {STEPS.length}
            </span>
            {optional && !filled ? (
              <button type="submit" className="btn btn-ghost">
                Omitir este paso <NavIcon name="arrow-right" size={15} />
              </button>
            ) : last ? (
              <button type="submit" className="btn btn-primary btn-lg">
                <NavIcon name="sparkles" size={16} /> Construir mi IA
              </button>
            ) : (
              <button type="submit" className="btn btn-primary">
                Continuar <NavIcon name="arrow-right" size={15} />
              </button>
            )}
          </footer>
        </form>

        <Preview draft={draft} orgName={state.orgName} agentName={agentName} />
      </main>
    </div>
  );
}

function TopBar({ step, onStep }: { step: number; onStep?: (i: number) => void }) {
  return (
    <header className="sw-top">
      <span className="sw-brand">
        <span className="sw-brand__mark" aria-hidden="true">
          D
        </span>
        Driony
      </span>
      {step >= 0 && (
        <ol className="sw-steps" aria-label="Pasos">
          {STEPS.map((s, i) => {
            const state = i < step ? "is-done" : i === step ? "is-current" : "";
            const inner = (
              <>
                <span className="sw-steps__dot">{i < step ? <NavIcon name="check" size={11} /> : i + 1}</span>
                <span className="sw-steps__label">{s.label}</span>
              </>
            );
            return (
              <li key={s.key} className={state} aria-current={i === step ? "step" : undefined}>
                {onStep && i < step ? (
                  <button type="button" className="sw-steps__item" onClick={() => onStep(i)} title={`Volver a «${s.label}»`}>
                    {inner}
                  </button>
                ) : (
                  <span className="sw-steps__item">{inner}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </header>
  );
}

function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <small id={id} className="sw-error" role="alert">
      {message}
    </small>
  );
}

// ── Vista previa ──────────────────────────────────────────────

function Preview({ draft, orgName, agentName }: { draft: Draft; orgName: string; agentName: string }) {
  const def = draft.businessType ? BUSINESS_TYPES[draft.businessType] : null;
  const firstAnswer = def?.faq.map((f) => draft.answers[f.key]?.trim()).find(Boolean);
  const question = def?.sample.question ?? "Hola, quisiera información";
  const answer = firstAnswer ?? def?.sample.answer ?? "¡Hola! Con gusto te ayudo. ¿Qué estás buscando?";
  const welcome = welcomeMessageFor(draft.tone, agentName, orgName);
  const answered = def ? def.faq.filter((f) => draft.answers[f.key]?.trim()).length : 0;
  const facts = answered + (draft.extra.trim() ? 1 : 0) + (draft.description.trim() ? 1 : 0);

  return (
    <aside className="sw-preview" aria-label="Vista previa de tu IA">
      <p className="sw-preview__title">Así responderá en tu WhatsApp</p>
      <div className="sw-phone">
        <div className="sw-phone__head">
          <span className="sw-phone__avatar" aria-hidden="true">
            {agentName.trim().charAt(0).toUpperCase() || "A"}
          </span>
          <span className="sw-phone__who">
            <strong>{orgName}</strong>
            <small>
              <span className="sw-live" aria-hidden="true" /> {agentName} · IA
            </small>
          </span>
        </div>
        <div className="sw-phone__chat">
          <p key={`q-${draft.businessType}`} className="sw-bubble is-in">
            {question}
          </p>
          {draft.welcome && (
            <p key={`w-${draft.tone}`} className="sw-bubble is-out">
              {welcome}
            </p>
          )}
          <p key={`a-${draft.businessType}-${draft.autopilot}`} className={`sw-bubble is-out${draft.autopilot ? "" : " is-draft"}`}>
            {answer}
            <span className="sw-bubble__meta">
              {draft.autopilot ? (
                <>
                  <NavIcon name="sparkles" size={11} /> Enviado por {agentName}
                </>
              ) : (
                <>
                  <NavIcon name="pencil" size={11} /> Sugerencia: tu equipo la aprueba
                </>
              )}
            </span>
          </p>
        </div>
      </div>
      <dl className="sw-facts">
        <div>
          <dt>Rubro</dt>
          <dd>{def?.label ?? "Sin elegir"}</dd>
        </div>
        <div>
          <dt>Misión</dt>
          <dd>{AGENT_GOAL_INFO[draft.goal].title}</dd>
        </div>
        <div>
          <dt>Horario</dt>
          <dd>{draft.hoursOn ? `${DAY_SHORT[draft.days]}, ${draft.from} a ${draft.to}` : "A toda hora"}</dd>
        </div>
        <div>
          <dt>Sabe</dt>
          <dd>
            {facts === 0 && draft.website.trim()
              ? "Tu web"
              : `${facts} ${facts === 1 ? "dato" : "datos"} de tu negocio${draft.website.trim() ? " y tu web" : ""}`}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

// ── Construcción ──────────────────────────────────────────────

type PhaseKey = "profile" | "knowledge" | "agent";
type TaskStatus = "pending" | "active" | "done" | "warn" | "skipped" | "error";

interface BuildResults {
  profile?: SetupProfileResult;
  knowledge?: SetupKnowledgeResult | { error: string };
  agent?: SetupAgentResult;
}

interface Task {
  key: string;
  phase: PhaseKey;
  title: string;
  /** Cómo se cuenta en el resumen final, ya hecho. */
  doneTitle: string;
  icon: IconName;
  /** Lo que se va contando mientras la fase trabaja. */
  hints?: string[];
}

/** Lo mínimo que se ve cada fase: si responde al instante, que dé tiempo a leerla. */
const MIN_PHASE_MS = 1100;
const REVEAL_MS = 420;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tasksFor(input: BusinessSetupInput): Task[] {
  const host = input.website ? input.website.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") : "";
  const tasks: (Task | null)[] = [
    {
      key: "analyze",
      phase: "profile",
      title: "Analizando tu negocio",
      doneTitle: "Tu negocio",
      icon: "search",
      hints: ["Leyendo lo que nos contaste…"],
    },
    { key: "pipeline", phase: "profile", title: "Adaptando tu embudo de ventas", doneTitle: "Embudo de ventas de tu rubro", icon: "pipeline" },
    { key: "quick", phase: "profile", title: "Creando respuestas rápidas para tu equipo", doneTitle: "Respuestas rápidas para tu equipo", icon: "bolt" },
    {
      key: "knowledge",
      phase: "knowledge",
      title: "Armando tu base de conocimiento",
      doneTitle: "Base de conocimiento",
      icon: "book",
      hints: input.website
        ? ["Ordenando tus respuestas…", `Leyendo ${host}…`, "Indexando para que tu IA lo encuentre al instante…"]
        : ["Ordenando tus respuestas…", "Indexando para que tu IA lo encuentre al instante…"],
    },
    input.website
      ? { key: "website", phase: "knowledge", title: `Aprendiendo de ${host}`, doneTitle: `Tu web, ${host}`, icon: "globe" }
      : null,
    {
      key: "prompt",
      phase: "agent",
      title: `Redactando las instrucciones de ${input.agentName}`,
      doneTitle: `Instrucciones de ${input.agentName}`,
      icon: "sparkles",
      hints: [
        "Definiendo cómo se presenta…",
        "Escribiendo cómo responde a tus clientes…",
        "Enseñándole a usar tu base de conocimiento…",
        "Marcando cuándo debe pasarte el chat…",
        "Revisando que nunca invente precios…",
      ],
    },
    {
      key: "config",
      phase: "agent",
      title: "Configurando saludo, horario y traspaso a tu equipo",
      doneTitle: "Saludo, horario y traspaso",
      icon: "settings",
    },
    { key: "activate", phase: "agent", title: `Activando a ${input.agentName}`, doneTitle: `${input.agentName} en marcha`, icon: "zap" },
  ];
  return tasks.filter((t): t is Task => t !== null);
}

/** Estado y detalle de una tarea ya terminada, según lo que devolvió el servidor. */
function outcome(task: Task, input: BusinessSetupInput, r: BuildResults): { status: TaskStatus; detail: string } {
  const def = BUSINESS_TYPES[input.businessType];
  const k = r.knowledge && "error" in r.knowledge ? null : r.knowledge;
  const kError = r.knowledge && "error" in r.knowledge ? r.knowledge.error : null;
  switch (task.key) {
    case "analyze":
      return { status: "done", detail: `${def.label}${input.city ? ` en ${input.city}` : ""}` };
    case "pipeline":
      return r.profile?.stages
        ? { status: "done", detail: r.profile.stages.join(" → ") }
        : { status: "skipped", detail: "Ya lo habías personalizado: lo dejamos como está" };
    case "quick": {
      const n = r.profile?.quickReplies ?? 0;
      return n
        ? { status: "done", detail: `${n} ${n === 1 ? "respuesta lista" : "respuestas listas"} para usar con «/» en el chat` }
        : { status: "skipped", detail: "Ya tenías estas respuestas rápidas" };
    }
    case "knowledge":
      if (kError) return { status: "warn", detail: `No pudimos guardarlo (${kError}). Puedes subirlo en Conocimiento.` };
      return k?.facts
        ? { status: "done", detail: `${k.facts} ${k.facts === 1 ? "dato" : "datos"} de tu negocio, listos para consultar` }
        : { status: "skipped", detail: "Sin datos por ahora: súbelos cuando quieras en Conocimiento" };
    case "website":
      if (kError || !k?.website) return { status: "warn", detail: "No pudimos leerla. Puedes importarla en Conocimiento." };
      return k.website.ok
        ? { status: "done", detail: `${k.website.pages} ${k.website.pages === 1 ? "página aprendida" : "páginas aprendidas"}` }
        : { status: "warn", detail: `No pudimos leerla (${k.website.error}). Puedes importarla en Conocimiento.` };
    case "prompt":
      return {
        status: "done",
        detail:
          r.agent?.writtenBy === "ai"
            ? "Escritas con IA a partir de tus respuestas"
            : "Escritas con una plantilla completa a partir de tus respuestas",
      };
    case "config":
      return {
        status: "done",
        detail: [
          r.agent?.welcome ? "Saludo automático" : null,
          input.hours ? `Atiende ${hoursLabel(input.hours)}` : "Atiende a toda hora",
          "te pasa el chat si se lo piden",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "activate":
      return {
        status: "done",
        detail: r.agent?.autopilot ? "Responde sola en los chats nuevos" : "Sugiere respuestas a tu equipo",
      };
    default:
      return { status: "done", detail: "" };
  }
}

function Build({
  input,
  orgName,
  headingRef,
  onBack,
  onDone,
}: {
  input: BusinessSetupInput;
  orgName: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onDone: (r: BuildResults) => void;
}) {
  const [tasks] = useState(() => tasksFor(input));
  const [results, setResults] = useState<BuildResults>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [phase, setPhase] = useState<PhaseKey | null>(null);
  const [error, setError] = useState<{ phase: PhaseKey; message: string } | null>(null);
  const [hint, setHint] = useState(0);
  const [slow, setSlow] = useState(false);
  const started = useRef(false);
  const acc = useRef<BuildResults>({});

  async function run(from: PhaseKey) {
    setError(null);
    const order: PhaseKey[] = ["profile", "knowledge", "agent"];
    for (const ph of order.slice(order.indexOf(from))) {
      setPhase(ph);
      setHint(0);
      setSlow(false);
      const t0 = performance.now();
      let result: BuildResults[PhaseKey];
      try {
        result =
          ph === "profile"
            ? await saveBusinessProfile(input)
            : ph === "knowledge"
              ? await buildBusinessKnowledge()
              : await buildBusinessAgent();
      } catch (e) {
        // El conocimiento no es imprescindible: se avisa y se sigue. Sin
        // perfil o sin agente no hay IA, así que ahí se para y se ofrece reintentar.
        if (ph !== "knowledge") {
          setError({ phase: ph, message: (e as Error).message });
          setPhase(null);
          return;
        }
        result = { error: (e as Error).message };
      }
      const rest = MIN_PHASE_MS - (performance.now() - t0);
      if (rest > 0) await sleep(rest);
      acc.current = { ...acc.current, [ph]: result };
      setResults(acc.current);
      for (const t of tasks.filter((x) => x.phase === ph)) {
        setRevealed((r) => (r.includes(t.key) ? r : [...r, t.key]));
        await sleep(REVEAL_MS);
      }
    }
    setPhase(null);
    await sleep(700);
    onDone(acc.current);
  }

  // Una sola vez, aunque el modo estricto de React monte el efecto dos veces.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run("profile");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Los textos de la tarea en curso van rotando; si tarda, se dice.
  useEffect(() => {
    if (!phase) return;
    const rot = setInterval(() => setHint((h) => h + 1), 2600);
    const late = setTimeout(() => setSlow(true), 22_000);
    return () => {
      clearInterval(rot);
      clearTimeout(late);
    };
  }, [phase]);

  const activeKey = phase ? tasks.find((t) => t.phase === phase && !revealed.includes(t.key))?.key : undefined;
  const errorKey = error ? tasks.find((t) => t.phase === error.phase && !revealed.includes(t.key))?.key : undefined;
  const pct = revealed.length / tasks.length;

  return (
    <main className="sw-build" aria-busy={!!phase}>
      <div className={`sw-orb${error ? " is-error" : ""}`} aria-hidden="true">
        <NavIcon name={error ? "alert" : "sparkles"} size={28} />
      </div>
      <h1 ref={headingRef} tabIndex={-1}>
        {error ? "Algo no salió bien" : `Construyendo la IA de ${orgName}`}
      </h1>
      <p className="sw-build__sub">
        {error
          ? "Lo que ya estaba hecho se queda. Puedes reintentar desde donde se paró."
          : slow
            ? "Tu IA se está tomando su tiempo para escribir bien. Ya casi."
            : "Toma menos de un minuto. No cierres esta pestaña."}
      </p>
      <div
        className="sw-progress"
        role="progressbar"
        aria-label="Progreso"
        aria-valuemin={0}
        aria-valuemax={tasks.length}
        aria-valuenow={revealed.length}
      >
        <span style={{ transform: `scaleX(${pct})` }} />
      </div>

      <ol className="sw-tasks">
        {tasks.map((t) => {
          const done = revealed.includes(t.key);
          const o = done ? outcome(t, input, results) : null;
          const status: TaskStatus = o?.status ?? (t.key === errorKey ? "error" : t.key === activeKey ? "active" : "pending");
          return (
            <li key={t.key} className={`sw-task is-${status}`}>
              <span className="sw-task__icon" aria-hidden="true">
                {status === "active" ? (
                  <span className="sw-spinner" />
                ) : status === "done" ? (
                  <NavIcon name="check" size={13} />
                ) : status === "warn" || status === "error" ? (
                  <NavIcon name="alert" size={13} />
                ) : status === "skipped" ? (
                  <NavIcon name="minus" size={13} />
                ) : (
                  <NavIcon name={t.icon} size={13} />
                )}
              </span>
              <span className="sw-task__text">
                <span className="sw-task__title">{t.title}</span>
                {o ? (
                  <span className="sw-task__detail">{o.detail}</span>
                ) : status === "active" && t.hints?.length ? (
                  <span key={hint % t.hints.length} className="sw-task__detail sw-task__hint" aria-live="polite">
                    {t.hints[hint % t.hints.length]}
                  </span>
                ) : status === "error" && error ? (
                  <span className="sw-task__detail">{error.message}</span>
                ) : null}
              </span>
              <span className="sr-only">
                {status === "done" ? "hecho" : status === "active" ? "en curso" : status === "skipped" ? "omitido" : status === "warn" ? "con aviso" : status === "error" ? "falló" : "pendiente"}
              </span>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="sw-build__actions">
          <button type="button" className="btn btn-primary" onClick={() => void run(error.phase)}>
            Reintentar
          </button>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Volver a mis respuestas
          </button>
        </div>
      )}
    </main>
  );
}

// ── Lista ─────────────────────────────────────────────────────

function Done({
  input,
  orgName,
  results,
  aiReady,
  headingRef,
}: {
  input: BusinessSetupInput;
  orgName: string;
  results: BuildResults;
  aiReady: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const queryClient = useQueryClient();
  const agent = results.agent?.botName ?? input.agentName;
  const items = tasksFor(input)
    .filter((t) => t.key !== "analyze" && t.key !== "activate")
    .map((t) => ({ t, o: outcome(t, input, results) }))
    .filter(({ o }) => o.status !== "skipped");

  // Lo construido cambia el agente, el embudo y Primeros pasos: que lo vean fresco.
  useEffect(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  return (
    <main className="sw-done">
      <div className="sw-orb is-done" aria-hidden="true">
        <NavIcon name="check" size={30} />
      </div>
      <h1 ref={headingRef} tabIndex={-1}>
        Tu IA está lista
      </h1>
      <p className="sw-done__sub">
        {agent} ya conoce {orgName}.{" "}
        {aiReady
          ? `Conecta tu WhatsApp y empezará a ${input.autopilot ? "responder sola" : "sugerirte respuestas"} en los chats nuevos.`
          : "Responderá en cuanto actives la IA en Ajustes › Inteligencia artificial y conectes tu WhatsApp."}
      </p>

      <ul className="sw-summary" aria-label="Lo que se construyó">
        {items.map(({ t, o }) => (
          <li key={t.key} className={o.status === "warn" ? "is-warn" : ""}>
            <NavIcon name={o.status === "warn" ? "alert" : t.icon} size={15} />
            <span>
              <strong>{t.doneTitle}</strong>
              <small>{o.detail}</small>
            </span>
          </li>
        ))}
      </ul>

      <section className="sw-connect" aria-labelledby="sw-connect-title">
        <span className="sw-connect__icon" aria-hidden="true">
          <NavIcon name="whatsapp" size={22} />
        </span>
        <div className="sw-connect__text">
          <strong id="sw-connect-title">Último paso: conecta tu número</strong>
          <span>Con tu WhatsApp conectado, {agent} empieza a atender. Toma unos 5 minutos.</span>
        </div>
        <Link href="/whatsapp" className="btn btn-lg sw-btn-wa">
          Conectar WhatsApp
        </Link>
      </section>

      <div className="sw-done__actions">
        <Link href="/agentes?probar=1" className="btn btn-soft">
          <NavIcon name="flask" size={15} /> Probar a {agent} en el simulador
        </Link>
        <Link href="/getting-started" className="btn btn-ghost">
          Omitir e ir a mi panel
        </Link>
      </div>
    </main>
  );
}
