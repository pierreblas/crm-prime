"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ImproveResult, ImproveRun, SimulatorEndReason } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { fetchImproveResults } from "@/lib/bff";
import { FINDING, VERDICT_LABEL } from "./ConversationSimulator";
import { whatsappFormat } from "./PlayReply";

const ENDED: Record<SimulatorEndReason, string> = {
  customer_done: "El cliente terminó",
  escalated: "Pasó a una persona",
  max_turns: "Llegó al tope de mensajes",
  error: "No se pudo simular",
};

/** Cómo se llama cada versión medida: la de partida y las propuestas. */
export function variantLabel(run: Pick<ImproveRun, "variants">, index: number): string {
  const proposals = run.variants.filter((v) => v.kind === "proposal").length;
  if (index === 0) return proposals ? "Antes" : "Hoy";
  return proposals > 1 ? `Propuesta ${index}` : "Propuesta";
}

/**
 * «Ver chats»: las conversaciones de un caso en una versión de la medición, con
 * lo que marcó el revisor arriba, igual que en el simulador.
 */
export function ImproveChats({
  botId,
  run,
  caseId,
  caseTitle,
  variant: initial,
  onBack,
}: {
  botId: string;
  run: ImproveRun;
  caseId: string;
  caseTitle: string;
  variant: number;
  onBack: () => void;
}) {
  // Solo las versiones que llegaron a medirse tienen conversaciones.
  const measured = run.variants.filter((v) => v.score && (v.score.conversations > 0 || v.score.failed > 0));
  const [variant, setVariant] = useState(measured.some((v) => v.index === initial) ? initial : (measured[0]?.index ?? 0));
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["improve-results", run.id, variant, caseId],
    queryFn: () => fetchImproveResults(botId, run.id, variant, caseId),
  });

  return (
    <div className="improve-chats" data-improve-chats>
      <div className="improve-chats__bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} data-improve-chats-back>
          <NavIcon name="arrow-left" size={13} /> Volver al resultado
        </button>
        {measured.length > 1 && (
          <div className="seg seg-sm" role="tablist" aria-label="Qué versión ver">
            {measured.map((v) => (
              <button key={v.index} type="button" role="tab" aria-selected={variant === v.index} onClick={() => setVariant(v.index)} data-improve-chats-variant={v.index}>
                {variantLabel(run, v.index)}
              </button>
            ))}
          </div>
        )}
      </div>
      <h3 className="improve-chats__title">{caseTitle}</h3>

      {isPending && <p className="improve-note">Cargando las conversaciones…</p>}
      {isError && (
        <p className="improve-note is-error" role="alert">
          {(error as Error).message}
        </p>
      )}
      {data && data.length === 0 && <p className="improve-note">No hay conversaciones de este caso en esta versión.</p>}
      {data?.map((r) => <Chat key={r.id} result={r} />)}
    </div>
  );
}

function Chat({ result: r }: { result: ImproveResult }) {
  return (
    <section className={`sim-run${r.error ? " is-error" : ""}`} data-improve-chat={r.verdict ?? "failed"}>
      <header className="sim-run__head">
        <strong>Conversación {r.repetition}</strong>
        <span className="sim-run__state">{r.ended ? ENDED[r.ended] : ""}</span>
        {r.verdict && <span className={`sim-verdict sim-verdict--${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span>}
      </header>
      {r.verdict && (
        <div className={`sim-review sim-review--${r.verdict}`}>
          {r.summary && <p className="sim-review__summary">{r.summary}</p>}
          {r.goal !== null && (
            <p className="improve-goal" data-improve-goal={r.goal}>
              <NavIcon name={r.goal ? "check" : "x"} size={13} />
              {r.goal ? "Llegó a buen fin" : "No llegó a buen fin"}
            </p>
          )}
          {r.findings.length > 0 && (
            <ul className="sim-review__list">
              {r.findings.map((f, k) => (
                <li key={k} className={`sim-finding sim-finding--${f.kind}`}>
                  <NavIcon name={FINDING[f.kind].icon} size={13} />
                  <span>
                    <b>{FINDING[f.kind].label}:</b> {f.note}
                    {f.quote && <q className="sim-finding__quote">{f.quote}</q>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {r.lines.map((line, i) =>
        line.who === "customer" ? (
          <div key={i} className="sim-msg sim-msg--customer">
            {line.text}
          </div>
        ) : (
          <div key={i} className="sim-msg-wrap">
            {line.handoff && (
              <span className="sim-flag">
                <NavIcon name="alert" size={13} />
                Pasa el chat a una persona: {line.handoff}
              </span>
            )}
            {line.text && <div className="sim-msg sim-msg--agent">{whatsappFormat(line.text)}</div>}
            {line.options.length > 0 && (
              <ul className="improve-options" aria-label="Opciones que ofreció">
                {line.options.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            )}
            {line.consulted.length > 0 && (
              <details className="improve-consulted">
                <summary>Lo que consultó ({line.consulted.length})</summary>
                <ul>
                  {line.consulted.map((c, k) => (
                    <li key={k}>{c}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ),
      )}
      {r.error && (
        <p className="sim-run__error" role="alert">
          {r.error}
        </p>
      )}
    </section>
  );
}
