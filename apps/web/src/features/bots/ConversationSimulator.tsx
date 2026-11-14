"use client";

import { useEffect, useRef, useState } from "react";
import {
  SIMULATOR_MAX_BATCH,
  SIMULATOR_SCENARIOS,
  SIMULATOR_TURN_OPTIONS,
  estimateSimulationTokens,
  formatTokens,
  type PlaygroundReply,
  type PlaygroundTurn,
  type SimulatorEndReason,
  type SimulatorScenario,
} from "@crm/shared";
import { simulateAgentTurn } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { useAiStatus } from "@/features/copilot/useAiStatus";

type Line = { who: "customer"; text: string } | { who: "agent"; text: string | null; meta: PlaygroundReply };

interface Run {
  key: string;
  scenario: SimulatorScenario;
  lines: Line[];
  /** «waiting» aún no empezó; «running» en curso; el resto, cómo terminó. */
  state: "waiting" | "running" | SimulatorEndReason | "stopped";
  error: string | null;
  tokens: number;
}

const END_LABEL: Record<Run["state"], string> = {
  waiting: "En espera",
  running: "En curso",
  customer_done: "El cliente terminó",
  escalated: "Pasó a una persona",
  max_turns: "Llegó al tope de mensajes",
  error: "No se pudo simular",
  stopped: "Detenida",
};

const CUSTOM_KEY = "custom";
/** Sin saber cuánto mide el prompt del agente, uno de tamaño medio. */
const TYPICAL_PROMPT_CHARS = 3500;

/**
 * Simulador de conversaciones: una IA hace de cliente (según el escenario) y el
 * agente responde con su configuración real, como en «Probar agente». Nada se
 * envía ni se aplica. Las conversaciones corren una detrás de otra y paso a
 * paso, así se ven en vivo y se pueden detener: cada paso gasta tokens.
 */
export function ConversationSimulator({ botId, promptChars }: { botId?: string; promptChars?: number }) {
  const { data: ai } = useAiStatus();
  const [picked, setPicked] = useState<string[]>(SIMULATOR_SCENARIOS.slice(0, 2).map((s) => s.id));
  const [custom, setCustom] = useState("");
  const [turns, setTurns] = useState<number>(SIMULATOR_TURN_OPTIONS[1]);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  // Al cerrar el cajón a medias, la simulación no sigue gastando por detrás.
  useEffect(() => () => void (stop.current = true), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [runs]);

  const customOk = custom.trim().length >= 10;
  const chosen: { key: string; scenario: SimulatorScenario }[] = [
    ...SIMULATOR_SCENARIOS.filter((s) => picked.includes(s.id)).map((s) => ({ key: s.id, scenario: { title: s.title, brief: s.brief } })),
    ...(picked.includes(CUSTOM_KEY) && customOk ? [{ key: CUSTOM_KEY, scenario: { title: "Tu escenario", brief: custom.trim() } }] : []),
  ];
  const full = picked.length >= SIMULATOR_MAX_BATCH;
  const estimate = chosen.length * estimateSimulationTokens(promptChars ?? TYPICAL_PROMPT_CHARS, turns);
  const paidBy =
    ai?.source === "included"
      ? "Salen de tus tokens de IA de Driony."
      : ai?.source === "own"
        ? "Los cobra tu proveedor de IA, con tu clave."
        : "";

  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length >= SIMULATOR_MAX_BATCH ? p : [...p, key]));

  async function start() {
    if (!chosen.length || busy) return;
    stop.current = false;
    setBusy(true);
    const plan: Run[] = chosen.map((c) => ({ key: c.key, scenario: c.scenario, lines: [], state: "waiting", error: null, tokens: 0 }));
    setRuns(plan);
    const patch = (key: string, fn: (r: Run) => Run) => setRuns((all) => (all ?? []).map((r) => (r.key === key ? fn(r) : r)));

    for (const run of plan) {
      if (stop.current) {
        patch(run.key, (r) => ({ ...r, state: "stopped" }));
        continue;
      }
      patch(run.key, (r) => ({ ...r, state: "running" }));
      const history: PlaygroundTurn[] = [];
      let state: Run["state"] = "running";
      let error: string | null = null;
      while (state === "running") {
        if (stop.current) {
          state = "stopped";
          break;
        }
        try {
          const step = await simulateAgentTurn({ botId, scenario: run.scenario, history, maxTurns: turns });
          const added: Line[] = [];
          if (step.customer) {
            added.push({ who: "customer", text: step.customer });
            history.push({ role: "user", content: step.customer });
          }
          if (step.agent) {
            added.push({ who: "agent", text: step.agent.reply, meta: step.agent });
            // Sin texto (pasó el chat a una persona) no hay nada que añadir a lo hablado.
            if (step.agent.reply) history.push({ role: "assistant", content: step.agent.reply });
          }
          patch(run.key, (r) => ({ ...r, lines: [...r.lines, ...added], tokens: r.tokens + step.tokens }));
          if (step.ended) {
            state = step.ended;
            error = step.error;
          } else if (!step.agent?.reply) {
            // Sin respuesta y sin motivo de cierre: no tiene sentido seguir preguntando.
            state = "error";
            error = "El agente no respondió.";
          }
        } catch (e) {
          state = "error";
          error = (e as Error).message;
        }
      }
      const finalState = state;
      const finalError = error;
      patch(run.key, (r) => ({ ...r, state: finalState, error: finalError }));
    }
    setBusy(false);
  }

  // ── Elegir escenarios ───────────────────────────────────────
  if (!runs) {
    return (
      <div className="sim" data-sim="setup">
        <p className="sim__lead">
          Una IA hace de cliente y tu agente le responde con su configuración real. No se envía nada por WhatsApp ni se
          cambia ningún contacto.
        </p>

        <fieldset className="sim__list">
          <legend className="label">
            Qué clientes simular ({picked.length} de {SIMULATOR_MAX_BATCH})
          </legend>
          {SIMULATOR_SCENARIOS.map((s) => {
            const on = picked.includes(s.id);
            return (
              <label key={s.id} className={`sim__option${on ? " is-on" : ""}`}>
                <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(s.id)} />
                <span className="sim__option-main">
                  <strong>{s.title}</strong>
                  <span>{s.brief}</span>
                </span>
              </label>
            );
          })}
          <label className={`sim__option${picked.includes(CUSTOM_KEY) ? " is-on" : ""}`}>
            <input type="checkbox" checked={picked.includes(CUSTOM_KEY)} disabled={!picked.includes(CUSTOM_KEY) && full} onChange={() => toggle(CUSTOM_KEY)} />
            <span className="sim__option-main">
              <strong>Otro: descríbelo tú</strong>
              <span>Quién es el cliente y qué quiere, con tus palabras.</span>
            </span>
          </label>
          {picked.includes(CUSTOM_KEY) && (
            <textarea
              className="field sim__custom"
              rows={3}
              maxLength={600}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Ej.: una mamá que pregunta por ortodoncia para su hijo de 12 años y quiere pagar en cuotas."
              aria-label="Describe al cliente"
              aria-invalid={!customOk && custom.length > 0}
              autoFocus
            />
          )}
        </fieldset>

        {/* Lo que cuesta y el botón quedan siempre a la vista, por larga que sea la lista. */}
        <div className="sim__foot">
        <div className="sim__turns">
          <span className="label">Mensajes del cliente por conversación</span>
          <div className="seg seg-sm" role="group" aria-label="Mensajes del cliente por conversación">
            {SIMULATOR_TURN_OPTIONS.map((n) => (
              <button key={n} type="button" className={turns === n ? "is-active" : ""} aria-pressed={turns === n} onClick={() => setTurns(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="sim__cost" role="status" data-sim-estimate>
          <NavIcon name="sparkles" size={15} />
          <span>
            {chosen.length ? (
              <>
                Gastará unos <strong>{formatTokens(estimate)}</strong> tokens ({chosen.length} {chosen.length === 1 ? "conversación" : "conversaciones"} de {turns} mensajes). Es una
                estimación: al terminar verás lo gastado de verdad. {paidBy}
              </>
            ) : (
              "Elige al menos un cliente para simular."
            )}
          </span>
        </div>

        <button type="button" className="btn btn-primary" disabled={!chosen.length || busy} onClick={() => void start()} data-sim-start>
          <NavIcon name="play" size={15} />
          {chosen.length > 1 ? `Simular ${chosen.length} conversaciones` : "Simular la conversación"}
        </button>
        </div>
      </div>
    );
  }

  // ── Conversaciones ──────────────────────────────────────────
  const spent = runs.reduce((sum, r) => sum + r.tokens, 0);
  return (
    <div className="sim" data-sim="runs">
      <div className="sim__bar">
        <span className="sim__spent" data-sim-spent>
          {busy ? "Gastado hasta ahora" : "Gastó"}: <strong>{formatTokens(spent)}</strong> tokens
        </span>
        {busy ? (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => (stop.current = true)} data-sim-stop>
            Detener
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRuns(null)} data-sim-again>
            Otra simulación
          </button>
        )}
      </div>

      {runs.map((run) => (
        <section key={run.key} className={`sim-run is-${run.state}`} data-sim-run={run.state}>
          <header className="sim-run__head">
            <strong>{run.scenario.title}</strong>
            <span className="sim-run__state">{END_LABEL[run.state]}</span>
          </header>
          {run.lines.map((line, i) =>
            line.who === "customer" ? (
              <div key={i} className="sim-msg sim-msg--customer">
                {line.text}
              </div>
            ) : (
              <div key={i} className="sim-msg-wrap">
                {line.meta.escalate && (
                  <span className="sim-flag">
                    <NavIcon name="alert" size={13} />
                    Pasa el chat a una persona{line.meta.escalationReason ? `: ${line.meta.escalationReason}` : ""}
                  </span>
                )}
                {line.text && <div className="sim-msg sim-msg--agent">{line.text}</div>}
                {line.meta.simulatedActions.length > 0 && (
                  <ul className="sim-actions" aria-label="Acciones que haría (no aplicadas)">
                    {line.meta.simulatedActions.map((a, k) => (
                      <li key={k}>{a}</li>
                    ))}
                  </ul>
                )}
                {line.meta.toolsUsed.length > 0 && <span className="sim-meta">usó: {line.meta.toolsUsed.join(", ")}</span>}
              </div>
            ),
          )}
          {run.state === "running" && <div className="sim-msg sim-msg--pending">Escribiendo…</div>}
          {run.error && (
            <p className="sim-run__error" role="alert">
              {run.error}
            </p>
          )}
          {run.state !== "waiting" && run.state !== "running" && run.tokens > 0 && <span className="sim-meta">{formatTokens(run.tokens)} tokens</span>}
        </section>
      ))}
      <div ref={bottom} />
    </div>
  );
}
