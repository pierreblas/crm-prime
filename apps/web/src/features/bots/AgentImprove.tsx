"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COUNTRIES,
  estimateImprovementTokens,
  formatTokens,
  IMPROVE_DEFAULT_REPETITIONS,
  IMPROVE_DEFAULT_TURNS,
  IMPROVE_MAX_CASES,
  IMPROVE_MAX_ROUNDS,
  IMPROVE_REPETITION_OPTIONS,
  IMPROVE_TURN_OPTIONS,
  type AgentTestCase,
  type ImproveOverview,
  type ImproveRun,
  type ImproveScore,
  type ImproveVariant,
  type PromptVersion,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useAiStatus } from "@/features/copilot/useAiStatus";
import {
  applyImprovement,
  cancelImproveRun,
  createTestCase,
  deleteTestCase,
  fetchChatReviews,
  fetchImprove,
  HttpError,
  restorePromptVersion,
  startImproveRun,
  updateTestCase,
} from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { loadTester, testerContact } from "./AgentPlayground";
import { CaseForm, CaseFromChatDialog } from "./CaseFromChat";
import { VERDICT_LABEL } from "./ConversationSimulator";
import { ImproveChats, variantLabel } from "./ImproveChats";
import { diffLines } from "./promptDiff";

const SOURCE: Record<AgentTestCase["source"], string> = { preset: "simulado", custom: "tuyo", chat: "de un chat real" };
/** Qué instrucciones guarda cada versión anterior: las que había justo antes de ese cambio. */
const VERSION_SOURCE: Record<PromptVersion["source"], string> = {
  manual: "antes de editarlas a mano",
  improve: "antes de aplicar una mejora",
  restore: "antes de restaurar otra versión",
};
/** Sin saber cuánto miden las instrucciones del agente, unas de tamaño medio. */
const TYPICAL_PROMPT_CHARS = 3500;
const DISMISSED_KEY = "driony.improve.dismissed";

const when = (iso: string) => new Date(iso).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * «Mejorar agente»: una batería de casos de prueba, una medición que corre en
 * el servidor (cada caso varias veces, sobre el simulador) y, si se pide, una
 * propuesta de cambio en las instrucciones medida con los mismos casos. La IA
 * propone y mide; el agente solo cambia cuando el dueño pulsa «Aplicar».
 */
export function AgentImprove({
  botId,
  botName,
  promptChars,
  onClose,
  onPromptChanged,
}: {
  botId: string;
  botName: string;
  /** Largo de las instrucciones guardadas: afina la estimación de tokens. */
  promptChars?: number;
  onClose: () => void;
  /** Las instrucciones del agente cambiaron (se aplicó una propuesta o se restauró una versión). */
  onPromptChanged: () => void;
}) {
  const titleId = useId();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["improve", botId],
    queryFn: () => fetchImprove(botId),
    // Mientras mide, pregunta por el avance; la medición sigue aunque se cierre la ventana.
    refetchInterval: (q) => (q.state.data?.run?.status === "running" ? 3000 : false),
  });
  const [chats, setChats] = useState<{ caseId: string; title: string; variant: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Con una confirmación o el diálogo de un caso encima, Esc es para ellos.
      if (e.key !== "Escape" || document.querySelector(".confirm-backdrop--top")) return;
      if (chats) setChats(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chats, onClose]);

  // En <body>: dentro de la página quedaría bajo la cabecera de la app.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog improve" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} data-improve>
        <header className="improve__head">
          <h2 id={titleId}>Mejorar agente · {botName}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar" data-improve-close>
            <NavIcon name="x" size={16} />
          </button>
        </header>

        <div className="improve__body">
          {/* En el cuerpo y no en la cabecera fija: en el móvil se va al desplazar y deja sitio. */}
          <p className="improve__lead">
            Mide cómo atiende con casos de prueba, deja que la IA proponga cambios en sus instrucciones y compara el antes y el después. Todo es simulado: no se envía
            nada por WhatsApp y el agente solo cambia si pulsas «Aplicar».
          </p>
          {isPending && <p className="improve-note is-loading">Cargando…</p>}
          {isError && (
            <p className="improve-note is-error" role="alert">
              {(error as Error).message}
            </p>
          )}
          {data &&
            (chats && data.run ? (
              <ImproveChats botId={botId} run={data.run} caseId={chats.caseId} caseTitle={chats.title} variant={chats.variant} onBack={() => setChats(null)} />
            ) : (
              <>
                <Cases botId={botId} botName={botName} cases={data.cases} />
                <Setup botId={botId} overview={data} promptChars={promptChars ?? TYPICAL_PROMPT_CHARS} />
                <Result
                  botId={botId}
                  botName={botName}
                  run={data.run}
                  onChats={(caseId, title, variant) => setChats({ caseId, title, variant })}
                  onPromptChanged={onPromptChanged}
                />
                <Versions botId={botId} botName={botName} versions={data.versions} onPromptChanged={onPromptChanged} />
              </>
            ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Para cambiar lo que ya se ve sin esperar a la siguiente consulta. */
function useOverview(botId: string) {
  const qc = useQueryClient();
  const key = ["improve", botId];
  return {
    patch: (fn: (o: ImproveOverview) => ImproveOverview) => qc.setQueryData<ImproveOverview>(key, (o) => (o ? fn(o) : o)),
    refresh: () => qc.invalidateQueries({ queryKey: key }),
  };
}

// ── 1. Casos de prueba ────────────────────────────────────────
function Cases({ botId, botName, cases }: { botId: string; botName: string; cases: AgentTestCase[] }) {
  const overview = useOverview(botId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [fromChat, setFromChat] = useState<string | null>(null);
  const active = cases.filter((c) => c.isActive).length;
  const full = active >= IMPROVE_MAX_CASES;
  const fail = (e: unknown) => toast.error((e as Error).message);

  const toggle = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => updateTestCase(botId, v.id, { isActive: v.isActive }),
    // Se ve al momento; si el servidor dice que no, se vuelve a lo que hay.
    onMutate: (v) => overview.patch((o) => ({ ...o, cases: o.cases.map((c) => (c.id === v.id ? { ...c, isActive: v.isActive } : c)) })),
    onError: (e) => {
      fail(e);
      void overview.refresh();
    },
  });
  const create = useMutation({
    mutationFn: (v: { title: string; brief: string }) => createTestCase(botId, v),
    onSuccess: (c) => {
      overview.patch((o) => ({ ...o, cases: [...o.cases, c] }));
      setAdding(false);
    },
    onError: fail,
  });
  const edit = useMutation({
    mutationFn: (v: { id: string; title: string; brief: string }) => updateTestCase(botId, v.id, { title: v.title, brief: v.brief }),
    onSuccess: (c) => {
      overview.patch((o) => ({ ...o, cases: o.cases.map((x) => (x.id === c.id ? c : x)) }));
      setEditing(null);
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTestCase(botId, id),
    onSuccess: (_r, id) => overview.patch((o) => ({ ...o, cases: o.cases.filter((c) => c.id !== id) })),
    onError: fail,
  });

  return (
    <section className="improve-sec" aria-labelledby="improve-cases" data-improve-section="cases">
      <div className="improve-sec__head">
        <h3 id="improve-cases">
          <span className="improve-sec__step">1.</span> Casos de prueba
        </h3>
        <span className="improve-sec__count" data-improve-active>
          {active} de {cases.length} marcados{full ? ` · tope de ${IMPROVE_MAX_CASES} por medición` : ""}
        </span>
      </div>
      <p className="improve-sec__lead">Cada caso es un cliente que una IA interpreta contra tu agente. Marca los que quieras medir.</p>

      <ul className="improve-cases">
        {cases.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="improve-cases__form">
              <CaseForm
                initial={c}
                saving={edit.isPending}
                saveLabel="Guardar"
                onSave={(v) => edit.mutate({ id: c.id, ...v })}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={c.id} className={`improve-case${c.isActive ? " is-on" : ""}`} data-improve-case={c.source}>
              <label className="improve-case__main">
                <input type="checkbox" checked={c.isActive} disabled={!c.isActive && full} onChange={(e) => toggle.mutate({ id: c.id, isActive: e.target.checked })} />
                <span className="improve-case__text">
                  <strong>{c.title}</strong>
                  <span>{c.brief}</span>
                </span>
              </label>
              <span className="improve-case__source">{SOURCE[c.source]}</span>
              {c.source !== "preset" && (
                <span className="improve-case__actions">
                  <button type="button" className="btn btn-ghost btn-icon" onClick={() => setEditing(c.id)} aria-label={`Editar «${c.title}»`} title="Editar">
                    <NavIcon name="pencil" size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    disabled={remove.isPending}
                    onClick={() =>
                      void confirmDialog({ message: `¿Borrar el caso «${c.title}»?`, confirmLabel: "Borrar", danger: true }).then((ok) => ok && remove.mutate(c.id))
                    }
                    aria-label={`Borrar «${c.title}»`}
                    title="Borrar"
                  >
                    <NavIcon name="x" size={13} />
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>

      {adding ? (
        <div className="improve-cases__form">
          <CaseForm saving={create.isPending} saveLabel="Añadir caso" onSave={(v) => create.mutate(v)} onCancel={() => setAdding(false)} />
        </div>
      ) : picking ? (
        <ChatPicker
          botId={botId}
          onPick={(conversationId) => {
            setPicking(false);
            setFromChat(conversationId);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <div className="improve-sec__actions">
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)} data-improve-new-case>
            <NavIcon name="plus" size={13} /> Nuevo caso
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)} data-improve-from-chat>
            <NavIcon name="inbox" size={13} /> Añadir desde un chat real
          </button>
        </div>
      )}
      {fromChat && <CaseFromChatDialog botId={botId} botName={botName} conversationId={fromChat} onClose={() => setFromChat(null)} />}
    </section>
  );
}

/** Los chats reales de este agente que la revisión marcó «Revisar» o «Mal»: de ahí salen los mejores casos. */
function ChatPicker({ botId, onPick, onCancel }: { botId: string; onPick: (conversationId: string) => void; onCancel: () => void }) {
  const { data, isPending, isError, error } = useQuery({ queryKey: ["chat-reviews", "all"], queryFn: () => fetchChatReviews("all") });
  // Un chat puede tener varias revisiones: vale la más reciente (vienen de nueva a antigua).
  const mine = useMemo(() => {
    const seen = new Set<string>();
    return (data?.reviews ?? []).filter((r) => {
      if (r.agentConfigId !== botId || r.verdict === "ok" || seen.has(r.conversationId)) return false;
      seen.add(r.conversationId);
      return true;
    });
  }, [data, botId]);
  return (
    <div className="improve-picker" data-improve-picker>
      <div className="improve-picker__head">
        <strong>Elige el chat</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {isPending && <p className="improve-note is-loading">Cargando los chats revisados…</p>}
      {isError && (
        <p className="improve-note is-error" role="alert">
          {(error as Error).message}
        </p>
      )}
      {data && mine.length === 0 && (
        <p className="improve-note">
          Este agente no tiene chats marcados «Revisar» o «Mal». Lanza la revisión en «Revisión de chats» (debajo de la lista de agentes) y vuelve.
        </p>
      )}
      <ul className="improve-picker__list">
        {mine.map((r) => (
          <li key={r.id}>
            <span className={`sim-verdict sim-verdict--${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span>
            <span className="improve-picker__text">
              <strong>{r.contactName}</strong>
              <span>{r.summary}</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => onPick(r.conversationId)} data-improve-pick>
              Usar este chat
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 2. Qué hacer ──────────────────────────────────────────────
function Setup({ botId, overview: data, promptChars }: { botId: string; overview: ImproveOverview; promptChars: number }) {
  const overview = useOverview(botId);
  const { data: ai } = useAiStatus();
  const [repetitions, setRepetitions] = useState<number>(IMPROVE_DEFAULT_REPETITIONS);
  const [turns, setTurns] = useState<number>(IMPROVE_DEFAULT_TURNS);
  const [mode, setMode] = useState<"measure" | "improve">("improve");
  const [rounds, setRounds] = useState(1);
  // El cliente de «Probar como» (nombre y país): el mismo para toda la medición.
  const [tester, setTester] = useState<ReturnType<typeof loadTester> | null>(null);
  useEffect(() => setTester(loadTester()), []);

  const run = data.run;
  const start = useMutation({
    mutationFn: () => {
      const contact = tester ? testerContact(tester) : undefined;
      return startImproveRun(botId, {
        caseIds: data.cases.filter((c) => c.isActive).map((c) => c.id),
        repetitions,
        turns,
        rounds: mode === "improve" ? rounds : 0,
        ...(contact ? { contact } : {}),
      });
    },
    onSuccess: (r) => overview.patch((o) => ({ ...o, run: r, busy: true })),
    onError: (e) => {
      toast.error((e as Error).message);
      void overview.refresh();
    },
  });

  if (run?.status === "running") return <Progress botId={botId} run={run} />;

  const active = data.cases.filter((c) => c.isActive).length;
  const usedRounds = mode === "improve" ? rounds : 0;
  const conversations = active * repetitions * (1 + usedRounds);
  const estimate = estimateImprovementTokens(promptChars, active, repetitions, turns, usedRounds);
  const tooMany = active > IMPROVE_MAX_CASES;
  const paidBy = ai?.source === "included" ? "Salen de tus tokens de IA de Driony." : ai?.source === "own" ? "Los cobra tu proveedor de IA, con tu clave." : "";
  const country = tester?.country ? COUNTRIES.find((c) => c.code === tester.country)?.name : null;
  const seg = (label: string, options: readonly number[], value: number, set: (n: number) => void, name: string) => (
    <div className="improve-setup__choice">
      <span className="label">{label}</span>
      <div className="seg seg-sm" role="group" aria-label={label} data-improve-seg={name}>
        {options.map((n) => (
          <button key={n} type="button" className={value === n ? "is-active" : ""} aria-pressed={value === n} onClick={() => set(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section className="improve-sec" aria-labelledby="improve-setup" data-improve-section="setup">
      <div className="improve-sec__head">
        <h3 id="improve-setup">
          <span className="improve-sec__step">2.</span> Qué hacer
        </h3>
      </div>

      <div className="improve-setup">
        <div className="improve-setup__row">
          {seg("Repeticiones por caso", IMPROVE_REPETITION_OPTIONS, repetitions, setRepetitions, "repetitions")}
          {seg("Mensajes del cliente por chat", IMPROVE_TURN_OPTIONS, turns, setTurns, "turns")}
        </div>
        <p className="improve-setup__why">Una sola respuesta engaña: el mismo agente contesta distinto cada vez. Con 3 repeticiones ya se ve si un cambio mejora de verdad.</p>

        <fieldset className="improve-setup__modes">
          <legend className="label">Qué medir</legend>
          <label className={`improve-mode${mode === "measure" ? " is-on" : ""}`}>
            <input type="radio" name="improve-mode" checked={mode === "measure"} onChange={() => setMode("measure")} />
            <span>
              <strong>Solo medir cómo atiende hoy</strong>
              <span>Para saber de dónde partes, o para comprobar un cambio que hiciste a mano.</span>
            </span>
          </label>
          <label className={`improve-mode${mode === "improve" ? " is-on" : ""}`}>
            <input type="radio" name="improve-mode" checked={mode === "improve"} onChange={() => setMode("improve")} />
            <span>
              <strong>Medir y proponer mejoras</strong>
              <span>La IA lee lo que falló, propone cambios en las instrucciones y los mide con los mismos casos.</span>
            </span>
          </label>
          {mode === "improve" &&
            seg(
              "Vueltas de mejora",
              Array.from({ length: IMPROVE_MAX_ROUNDS }, (_, i) => i + 1),
              rounds,
              setRounds,
              "rounds",
            )}
        </fieldset>

        <div className="sim__cost" role="status" data-improve-estimate>
          <NavIcon name="sparkles" size={15} />
          <span>
            {active ? (
              <>
                Gastará unos <strong>{formatTokens(estimate)}</strong> tokens ({usedRounds > 1 ? "hasta " : ""}
                {plural(conversations, "conversación", "conversaciones")}
                {usedRounds ? ` y ${plural(usedRounds, "propuesta", "propuestas")}` : ""}). Es una estimación: al terminar verás lo gastado de verdad. {paidBy}
              </>
            ) : (
              "Marca al menos un caso de prueba."
            )}
          </span>
        </div>

        <div className="improve-setup__foot">
          <span className="improve-setup__tester">
            {tester && (tester.name.trim() || country)
              ? `Cliente de prueba: ${tester.name.trim() || "sin nombre"}${country ? ` · ${country}` : ""}. Se cambia en «Probar conversación».`
              : "Sin cliente de prueba: los precios salen en la moneda por defecto. Se elige en «Probar conversación»."}
          </span>
          <button type="button" className="btn btn-primary" disabled={!active || tooMany || data.busy || start.isPending} onClick={() => start.mutate()} data-improve-start>
            <NavIcon name="play" size={15} />
            {start.isPending ? "Empezando…" : mode === "improve" ? "Medir y proponer" : "Medir"}
          </button>
        </div>
        {tooMany && (
          <p className="improve-note is-error" role="alert">
            Marca como mucho {IMPROVE_MAX_CASES} casos por medición.
          </p>
        )}
        {data.busy && <p className="improve-note">Hay una medición en marcha en otro agente. Cuando termine podrás empezar esta.</p>}
      </div>
    </section>
  );
}

function Progress({ botId, run }: { botId: string; run: ImproveRun }) {
  const overview = useOverview(botId);
  const stop = useMutation({
    mutationFn: () => cancelImproveRun(botId, run.id),
    onSuccess: (r) => overview.patch((o) => ({ ...o, run: r, busy: r.status === "running" })),
    onError: (e) => toast.error((e as Error).message),
  });
  const measuring = run.variants.find((v) => v.status === "running");
  const phase = measuring
    ? measuring.index === 0
      ? "Midiendo cómo atiende hoy"
      : `Midiendo la propuesta${run.rounds > 1 ? ` ${measuring.index}` : ""}`
    : run.variants[0]?.status === "done"
      ? "Redactando la propuesta de mejora"
      : "Empezando";
  const pct = run.total ? Math.min(100, Math.round((run.done / run.total) * 100)) : 0;
  return (
    <section className="improve-sec" aria-labelledby="improve-progress" data-improve-section="progress">
      <div className="improve-sec__head">
        <h3 id="improve-progress">
          <span className="improve-sec__step">2.</span> Midiendo
        </h3>
      </div>
      <div className="improve-progress">
        <div className="improve-progress__top">
          <strong className="improve-progress__phase" role="status" data-improve-phase>
            {stop.isSuccess ? "Deteniendo" : phase}…
          </strong>
          <button type="button" className="btn btn-danger btn-sm" disabled={stop.isPending || stop.isSuccess} onClick={() => stop.mutate()} data-improve-stop>
            Detener
          </button>
        </div>
        <div className="improve-progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done} aria-label="Conversaciones medidas">
          <span style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <p className="improve-progress__meta" data-improve-progress>
          <span>
            {run.done} de {run.rounds > 1 ? "hasta " : ""}
            {run.total} conversaciones
          </span>
          <span>{formatTokens(run.tokens)} tokens gastados</span>
        </p>
        <p className="improve-progress__hint">Puedes cerrar esta ventana: la medición sigue en el servidor y al volver verás el resultado.</p>
      </div>
    </section>
  );
}

// ── 3. Resultado ──────────────────────────────────────────────
const COUNTS: { label: string; get: (s: ImproveScore) => number; outOf: boolean; higherIsBetter: boolean }[] = [
  { label: "Atendió bien", get: (s) => s.ok, outOf: true, higherIsBetter: true },
  { label: "Inventó un dato", get: (s) => s.invented, outOf: false, higherIsBetter: false },
  { label: "Llegó a buen fin", get: (s) => s.goal, outOf: true, higherIsBetter: true },
];

const RUN_NOTE: Partial<Record<ImproveRun["status"], string>> = {
  cancelled: "Medición detenida: se enseña lo que llegó a medirse.",
  interrupted: "La medición se interrumpió porque el servidor se reinició: se enseña lo que llegó a medirse. Vuelve a lanzarla.",
};

function Result({
  botId,
  botName,
  run,
  onChats,
  onPromptChanged,
}: {
  botId: string;
  botName: string;
  run: ImproveRun | null;
  onChats: (caseId: string, title: string, variant: number) => void;
  onPromptChanged: () => void;
}) {
  const overview = useOverview(botId);
  const [picked, setPicked] = useState<number | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  // «Descartar» esconde la propuesta de esta medición en este navegador; el agente no cambia en ningún caso.
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY));
    } catch {
      /* sin almacenamiento: se ve siempre */
    }
  }, []);
  const dismiss = (id: string | null) => {
    setDismissed(id);
    try {
      if (id) localStorage.setItem(DISMISSED_KEY, id);
      else localStorage.removeItem(DISMISSED_KEY);
    } catch {
      /* vale para esta visita */
    }
  };

  const base = run?.variants[0];
  const proposals = run?.variants.filter((v) => v.kind === "proposal") ?? [];
  const measured = proposals.filter((v) => v.status === "done" && v.score);
  const hidden = !!run && dismissed === run.id && measured.length > 0;
  const shown: ImproveVariant | null = hidden
    ? null
    : (measured.find((v) => v.index === picked) ?? measured.find((v) => v.index === run?.best) ?? measured.at(-1) ?? null);

  const apply = useMutation({
    mutationFn: async (variant: number) => {
      if (!run) return null;
      const sure = await confirmDialog({
        title: "Aplicar al agente",
        message: run.agentChanged
          ? `Las instrucciones de ${botName} cambiaron desde que empezó esta medición. Si aplicas la propuesta, ese cambio se pierde (queda en «Versiones anteriores»). ¿Aplicar de todas formas?`
          : `Las instrucciones de ${botName} pasan a ser las de la propuesta. Las de ahora quedan en «Versiones anteriores» y puedes restaurarlas.`,
        confirmLabel: "Aplicar",
        danger: run.agentChanged,
      });
      if (!sure) return null;
      try {
        return await applyImprovement(botId, run.id, variant, run.agentChanged);
      } catch (e) {
        // Cambió mientras la ventana estaba abierta: el servidor no lo pisa sin preguntar.
        if (!(e instanceof HttpError) || e.status !== 409 || run.agentChanged) throw e;
        const force = await confirmDialog({ message: `${e.message} ¿Aplicar de todas formas?`, confirmLabel: "Aplicar de todas formas", danger: true });
        return force ? applyImprovement(botId, run.id, variant, true) : null;
      }
    },
    onSuccess: (r) => {
      if (!r) return;
      toast.success(`Instrucciones aplicadas a ${botName}`);
      void overview.refresh();
      onPromptChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const diff = useMemo(() => (showPrompt && base && shown ? diffLines(base.prompt, shown.prompt) : []), [showPrompt, base, shown]);

  if (!run) {
    return (
      <section className="improve-sec" aria-labelledby="improve-result" data-improve-section="result">
        <div className="improve-sec__head">
          <h3 id="improve-result">
            <span className="improve-sec__step">3.</span> Resultado
          </h3>
        </div>
        <p className="improve-note">Todavía no hay ninguna medición de este agente. Marca los casos y pulsa «Medir».</p>
      </section>
    );
  }

  const baseScore = base?.score ?? null;
  const failedProposals = proposals.filter((v) => v.status === "failed");
  const caseScore = (v: ImproveVariant | null | undefined, caseId: string) => v?.score?.cases.find((c) => c.caseId === caseId) ?? null;
  const applied = shown && run.appliedVariant === shown.index;

  return (
    <section className="improve-sec" aria-labelledby="improve-result" data-improve-section="result" data-improve-run={run.status}>
      <div className="improve-sec__head">
        <h3 id="improve-result">
          <span className="improve-sec__step">3.</span> Resultado
        </h3>
        <span className="improve-sec__count">
          {plural(run.cases.length, "caso", "casos")} × {plural(run.repetitions, "repetición", "repeticiones")} · {formatTokens(run.tokens)} tokens · {when(run.createdAt)}
        </span>
      </div>

      {run.status === "failed" && (
        <p className="improve-note is-error" role="alert">
          La medición falló: {run.error ?? "no se pudo medir."}
        </p>
      )}
      {RUN_NOTE[run.status] && <p className="improve-note">{RUN_NOTE[run.status]}</p>}
      {!baseScore && run.status === "running" && <p className="improve-note is-loading">Aquí verás los conteos en cuanto termine la primera tanda de conversaciones.</p>}

      {baseScore && base && (
        <>
          {measured.length > 1 && !hidden && (
            <div className="seg seg-sm improve-result__pick" role="tablist" aria-label="Qué propuesta comparar">
              {measured.map((v) => (
                <button key={v.index} type="button" role="tab" aria-selected={shown?.index === v.index} onClick={() => setPicked(v.index)}>
                  {variantLabel(run, v.index)}
                  {run.best === v.index ? " · la mejor" : ""}
                </button>
              ))}
            </div>
          )}

          <table className="improve-table" data-improve-counts>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Qué se cuenta</span>
                </th>
                <th scope="col">{variantLabel(run, 0)}</th>
                {shown && <th scope="col">{variantLabel(run, shown.index)}</th>}
              </tr>
            </thead>
            <tbody>
              {COUNTS.map((row) => {
                const before = row.get(baseScore);
                const after = shown?.score ? row.get(shown.score) : null;
                const delta = after === null ? 0 : after - before;
                const tone = !delta ? "" : delta > 0 === row.higherIsBetter ? " is-better" : " is-worse";
                return (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.outOf ? `${before} de ${baseScore.conversations}` : before}</td>
                    {shown?.score && after !== null && (
                      <td className={tone.trim()}>
                        {row.outOf ? `${after} de ${shown.score.conversations}` : after}
                        {delta !== 0 && <span className="improve-table__delta">{delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {baseScore.failed + (shown?.score?.failed ?? 0) > 0 && (
            <p className="improve-note">
              {plural(baseScore.failed + (shown?.score?.failed ?? 0), "conversación no se pudo simular y no cuenta", "conversaciones no se pudieron simular y no cuentan")}.
            </p>
          )}

          {shown && <Verdict base={baseScore} variant={shown} repetitions={run.repetitions} />}

          <table className="improve-table improve-table--cases" data-improve-by-case>
            <caption>Atendió bien, por caso</caption>
            <thead>
              <tr>
                <th scope="col">Caso</th>
                <th scope="col">{variantLabel(run, 0)}</th>
                {shown && <th scope="col">{variantLabel(run, shown.index)}</th>}
                <th scope="col">
                  <span className="sr-only">Conversaciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {run.cases.map((c) => {
                const b = caseScore(base, c.id);
                const p = caseScore(shown, c.id);
                return (
                  <tr key={c.id}>
                    <th scope="row">{c.title}</th>
                    <td>
                      <CaseCount score={b} />
                    </td>
                    {shown && (
                      <td className={b && p && p.ok !== b.ok ? (p.ok > b.ok ? "is-better" : "is-worse") : ""}>
                        <CaseCount score={p} />
                      </td>
                    )}
                    <td>
                      <button type="button" className="improve-link" onClick={() => onChats(c.id, c.title, shown?.index ?? 0)} data-improve-see-chats>
                        ver chats
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {hidden && (
            <p className="improve-note" data-improve-dismissed>
              Descartaste la propuesta de esta medición.{" "}
              <button type="button" className="improve-link" onClick={() => dismiss(null)}>
                Volver a verla
              </button>
            </p>
          )}

          {shown && (
            <>
              <div className="improve-changes" data-improve-changes>
                <h4>Qué cambió ({shown.changes.length})</h4>
                {shown.changes.length ? (
                  <ul>
                    {shown.changes.map((c, i) => (
                      <li key={i}>
                        <span>{c.what}</span>
                        <small>
                          Por: {c.why}
                          {c.caseTitle ? ` (${c.caseTitle})` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="improve-note">La IA no detalló los cambios: míralos en las instrucciones propuestas.</p>
                )}
              </div>

              {applied && (
                <p className="improve-note is-ok" data-improve-applied>
                  <NavIcon name="check" size={14} /> Aplicada al agente{run.appliedAt ? ` el ${when(run.appliedAt)}` : ""}. Las instrucciones de antes están en «Versiones anteriores».
                </p>
              )}
              {!applied && run.agentChanged && (
                <p className="improve-note is-warn" role="status">
                  <NavIcon name="alert" size={14} /> Las instrucciones del agente cambiaron desde esta medición: si aplicas la propuesta, ese cambio se pierde.
                </p>
              )}

              <div className="improve-result__actions">
                <button type="button" className="btn btn-sm" aria-expanded={showPrompt} onClick={() => setShowPrompt((v) => !v)} data-improve-show-prompt>
                  <NavIcon name="expand" size={13} /> {showPrompt ? "Ocultar las instrucciones propuestas" : "Ver las instrucciones propuestas"}
                </button>
                {!applied && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss(run.id)} data-improve-dismiss>
                      Descartar
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm${shown.comparison === "better" ? " btn-primary" : ""}`}
                      disabled={apply.isPending || run.status === "running"}
                      title={run.status === "running" ? "Espera a que termine la medición" : undefined}
                      onClick={() => apply.mutate(shown.index)}
                      data-improve-apply
                    >
                      <NavIcon name="check" size={13} /> {apply.isPending ? "Aplicando…" : "Aplicar al agente"}
                    </button>
                  </>
                )}
              </div>

              {showPrompt && (
                <div className="improve-diff" data-improve-diff>
                  <p className="improve-diff__legend">
                    <span className="is-added">+ {plural(diff.filter((l) => l.kind === "added").length, "línea añadida", "líneas añadidas")}</span>
                    <span className="is-removed">− {plural(diff.filter((l) => l.kind === "removed").length, "línea quitada", "líneas quitadas")}</span>
                  </p>
                  <div className="improve-diff__text">
                    {diff.map((l, i) => (
                      <div key={i} className={`improve-diff__line is-${l.kind}`}>
                        <span className="improve-diff__mark" aria-hidden="true">
                          {l.kind === "added" ? "+" : l.kind === "removed" ? "−" : ""}
                        </span>
                        {l.kind === "removed" ? <del>{l.text || " "}</del> : l.kind === "added" ? <ins>{l.text || " "}</ins> : <span>{l.text || " "}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {failedProposals.length > 0 && (
        <ul className="improve-discarded" data-improve-discarded>
          {failedProposals.map((v) => (
            <li key={v.index}>
              <NavIcon name="alert" size={13} />
              <span>
                <b>{proposals.length > 1 ? `Vuelta ${v.index}: ` : ""}no hubo propuesta.</b> {v.error ?? "La IA no devolvió una propuesta válida."}
              </span>
            </li>
          ))}
        </ul>
      )}
      {run.status === "done" && run.rounds > 0 && proposals.length === 0 && baseScore && (
        <p className="improve-note is-ok">
          <NavIcon name="check" size={14} /> No se propuso nada: con estos casos el agente ya atiende bien y llega a buen fin en todas.
        </p>
      )}
    </section>
  );
}

function CaseCount({ score }: { score: { ok: number; conversations: number; invented: number } | null }) {
  if (!score || !score.conversations) return <span aria-label="Sin medir">—</span>;
  return (
    <>
      {score.ok}/{score.conversations}
      {score.invented > 0 && <span className="improve-table__invented">inventó {score.invented}</span>}
    </>
  );
}

/** La frase que dice si la propuesta vale la pena, con el motivo. */
function Verdict({ base, variant, repetitions }: { base: ImproveScore; variant: ImproveVariant; repetitions: number }) {
  const score = variant.score;
  if (!score || !variant.comparison) return null;
  const more = repetitions < 5 ? " o repite con más repeticiones" : "";
  const text =
    variant.comparison === "better"
      ? { icon: "check" as const, title: "Mejora clara.", body: "La propuesta atiende mejor los mismos casos y no inventa más que antes." }
      : variant.comparison === "worse"
        ? score.invented > base.invented
          ? { icon: "alert" as const, title: "Peor: inventa más datos que antes.", body: "No la apliques." }
          : { icon: "alert" as const, title: "Peor que antes.", body: "No la apliques." }
        : { icon: "minus" as const, title: "Sin diferencia clara.", body: `La diferencia es pequeña para las repeticiones hechas y puede ser azar: no la apliques${more}.` };
  return (
    <p className={`improve-verdict is-${variant.comparison}`} role="status" data-improve-verdict={variant.comparison}>
      <NavIcon name={text.icon} size={15} />
      <span>
        <strong>{text.title}</strong> {text.body}
      </span>
    </p>
  );
}

// ── Versiones anteriores ──────────────────────────────────────
function Versions({ botId, botName, versions, onPromptChanged }: { botId: string; botName: string; versions: PromptVersion[]; onPromptChanged: () => void }) {
  const overview = useOverview(botId);
  const restore = useMutation({
    mutationFn: async (v: PromptVersion) => {
      const sure = await confirmDialog({
        title: "Restaurar esta versión",
        message: `Las instrucciones de ${botName} vuelven a ser las del ${when(v.createdAt)} (${VERSION_SOURCE[v.source]}). Las de ahora quedan guardadas aquí.`,
        confirmLabel: "Restaurar",
      });
      return sure ? restorePromptVersion(botId, v.id) : null;
    },
    onSuccess: (o) => {
      if (!o) return;
      overview.patch(() => o);
      toast.success("Versión restaurada");
      onPromptChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <section className="improve-sec" aria-labelledby="improve-versions" data-improve-section="versions">
      <div className="improve-sec__head">
        <h3 id="improve-versions">Versiones anteriores de las instrucciones</h3>
      </div>
      {versions.length === 0 ? (
        <p className="improve-note">Todavía no hay ninguna. Cada vez que cambian las instrucciones (a mano o al aplicar una mejora) se guarda aquí la versión anterior.</p>
      ) : (
        <ul className="improve-versions">
          {versions.map((v) => (
            <li key={v.id}>
              <span className="improve-versions__when">{when(v.createdAt)}</span>
              <span className="improve-versions__text">
                <strong>{VERSION_SOURCE[v.source]}</strong>
                <span>{v.preview}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={restore.isPending} onClick={() => restore.mutate(v)} data-improve-restore>
                Restaurar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
