"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CORRECTION_NOTE_MAX,
  estimateCorrectionTokens,
  estimateImprovementTokens,
  formatTokens,
  IMPROVE_MAX_CASES,
  type AgentCorrection,
  type ConversationReviewDto,
  type CorrectionChat,
  type CorrectionOutcome,
  type ImproveComparison,
} from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { applyCorrection, discardCorrection, fetchCorrection, fetchImproveRun, HttpError, measureCorrection, startCorrection } from "@/lib/bff";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { whatsappFormat } from "./PlayReply";
import { diffLines } from "./promptDiff";

/** Si no se sabe cuánto miden las instrucciones, lo habitual. */
const TYPICAL_PROMPT_CHARS = 5000;
/** La medición con los casos del agente: una vez cada uno y conversaciones cortas, para que no salga cara. */
const MEASURE_REPETITIONS = 1;
const MEASURE_TURNS = 4;

const OUTCOME: Record<CorrectionOutcome, { label: string; tone: "ok" | "review" | "bad" | "muted"; icon: IconName }> = {
  pending: { label: "Sin probar", tone: "muted", icon: "minus" },
  fixed: { label: "Arreglado", tone: "ok", icon: "check" },
  not_fixed: { label: "Sigue fallando", tone: "bad", icon: "alert" },
  today_ok: { label: "Hoy ya responde bien", tone: "ok", icon: "check" },
  data: { label: "Falta un dato", tone: "review", icon: "question" },
  system: { label: "No es de sus instrucciones", tone: "review", icon: "alert" },
  error: { label: "No se pudo repetir", tone: "muted", icon: "alert" },
};

const COMPARISON: Record<ImproveComparison, { icon: IconName; title: string; body: string }> = {
  better: { icon: "check", title: "Mejora clara.", body: "Con el cambio atiende mejor tus casos y no inventa más que antes." },
  same: { icon: "minus", title: "Sin diferencia clara.", body: "En tus otros casos responde igual de bien: el cambio no los estropea." },
  worse: { icon: "alert", title: "Peor en tus otros casos.", body: "Arregla este chat pero estropea otros: mejor no lo apliques." },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * «Corregir al agente»: con uno o varios chats revisados (y lo que el dueño
 * diga que debió hacer) sale un cambio en sus instrucciones, probado en el
 * momento exacto en que falló. El agente solo cambia al pulsar «Aplicar».
 */
export function CorrectAgentDialog({
  botId,
  botName,
  promptChars,
  reviews,
  correctionId,
  onClose,
  onChanged,
  onPromptChanged,
}: {
  botId: string;
  botName: string;
  promptChars?: number;
  /** Los chats elegidos, para una corrección nueva. */
  reviews: ConversationReviewDto[];
  /** Una corrección que ya existe, para volver a verla. */
  correctionId?: string | null;
  onClose: () => void;
  /** Empezó, terminó, se aplicó o se descartó: el panel se refresca. */
  onChanged: () => void;
  onPromptChanged: () => void;
}) {
  const titleId = useId();
  const [id, setId] = useState<string | null>(correctionId ?? null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["correction", id],
    queryFn: () => fetchCorrection(botId, id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2500 : false),
  });
  const status = data?.status;
  useEffect(() => {
    if (status) onChanged();
    // Solo cuando cambia el estado: `onChanged` es nueva en cada pintado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".confirm-backdrop--top")) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog correct" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} data-correct={status ?? "new"}>
        <header className="correct__head">
          <h2 id={titleId}>Corregir al agente · {botName}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar" data-correct-close>
            <NavIcon name="x" size={16} />
          </button>
        </header>
        <div className="correct__body">
          {!id ? (
            <Compose botId={botId} promptChars={promptChars ?? TYPICAL_PROMPT_CHARS} reviews={reviews} onStarted={(c) => setId(c.id)} onCancel={onClose} />
          ) : isPending ? (
            <p className="improve-note is-loading">Cargando…</p>
          ) : isError ? (
            <p className="improve-note is-error" role="alert">
              {(error as Error).message}
            </p>
          ) : data.status === "running" ? (
            <Running correction={data} />
          ) : (
            <Result correction={data} onClose={onClose} onPromptChanged={onPromptChanged} onRetry={reviews.length ? () => setId(null) : null} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Antes de empezar ─────────────────────────────────────────
function Compose({
  botId,
  promptChars,
  reviews,
  onStarted,
  onCancel,
}: {
  botId: string;
  promptChars: number;
  reviews: ConversationReviewDto[];
  onStarted: (c: AgentCorrection) => void;
  onCancel: () => void;
}) {
  const noteId = useId();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  // En un chat que salió bien no hay nada marcado: hay que decir qué debió hacer.
  const needsNote = reviews.some((r) => r.verdict === "ok");
  const start = useMutation({
    mutationFn: () => startCorrection(botId, { reviewIds: reviews.map((r) => r.id), note: note.trim() }),
    onSuccess: (c) => {
      qc.setQueryData(["correction", c.id], c);
      onStarted(c);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const ready = reviews.length > 0 && (!needsNote || note.trim().length > 0) && !start.isPending;
  return (
    <form
      className="correct__compose"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) start.mutate();
      }}
    >
      <p className="correct__lead">
        {reviews.length > 1
          ? `Sale un solo cambio que cubre estos ${reviews.length} chats. Se prueba en el momento exacto en que falló cada uno. `
          : "Se busca qué cambiar en sus instrucciones y se prueba en el momento exacto en que falló. "}
        No se envía nada, y el agente solo cambia si pulsas «Aplicar».
      </p>
      <ul className="correct__chosen">
        {reviews.map((r) => (
          <li key={r.id}>
            <strong>{r.contactName}</strong>
            <span>{r.summary || r.findings.find((f) => f.kind !== "good")?.note || "Sin fallos marcados"}</span>
          </li>
        ))}
      </ul>
      <div>
        <label className="label" htmlFor={noteId}>
          ¿Qué debió hacer? {needsNote ? "" : "(opcional)"}
        </label>
        <textarea
          id={noteId}
          className="field"
          rows={3}
          value={note}
          maxLength={CORRECTION_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej.: No repetir la presentación si ya la recibió; preguntarle cómo quiere pagar."
          autoFocus
          data-correct-note
        />
        <p className="improve-form__hint">
          Con tus palabras: manda sobre lo que marcó la revisión. Sirve para cualquier cliente, así que no pongas nombres ni teléfonos.
          {needsNote ? " En un chat que salió bien hace falta que lo escribas." : ""}
        </p>
      </div>
      <div className="correct__foot">
        <span className="correct__cost">
          Gastará unos <strong>{formatTokens(estimateCorrectionTokens(promptChars, reviews.length))}</strong> tokens; hasta el doble si el primer cambio no basta.
        </span>
        <span className="correct__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!ready} data-correct-start>
            <NavIcon name="sparkles" size={13} /> {start.isPending ? "Empezando…" : "Corregir al agente"}
          </button>
        </span>
      </div>
    </form>
  );
}

function Running({ correction: c }: { correction: AgentCorrection }) {
  const share = c.total ? Math.min(0.97, c.done / c.total) : 0;
  return (
    <div className="correct__running" role="status" data-correct-running>
      <p className="improve-note is-loading">
        {c.done < c.chats.length ? "Repitiendo cada chat con las instrucciones de hoy…" : c.done <= c.chats.length ? "Buscando qué cambiar en sus instrucciones…" : "Probando el cambio en cada chat…"}
      </p>
      <div className="correct__bar" aria-hidden="true">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <p className="improve-note">Tarda uno o dos minutos. Puedes cerrar esta ventana: el resultado queda en el chat, en «Ver corrección».</p>
    </div>
  );
}

// ── El resultado ─────────────────────────────────────────────
function Result({ correction: c, onClose, onPromptChanged, onRetry }: { correction: AgentCorrection; onClose: () => void; onPromptChanged: () => void; onRetry: (() => void) | null }) {
  const qc = useQueryClient();
  const set = (next: AgentCorrection) => qc.setQueryData(["correction", c.id], next);
  const [showAll, setShowAll] = useState(false);
  const diff = useMemo(() => (c.prompt ? diffLines(c.basePrompt, c.prompt) : []), [c.basePrompt, c.prompt]);
  const shownDiff = showAll ? diff : diff.filter((l) => l.kind !== "same");
  const tested = c.chats.filter((x) => x.outcome === "fixed" || x.outcome === "not_fixed");
  const fixed = tested.filter((x) => x.outcome === "fixed").length;

  const apply = useMutation({
    mutationFn: async () => {
      const sure = await confirmDialog({
        title: "Aplicar al agente",
        message: c.agentChanged
          ? `Las instrucciones de ${c.botName} cambiaron desde que empezó esta corrección. Si la aplicas, ese cambio se pierde (queda en «Versiones anteriores»). ¿Aplicar de todas formas?`
          : fixed < tested.length
            ? `Con el cambio, ${plural(tested.length - fixed, "chat sigue fallando", "chats siguen fallando")}. ¿Aplicarlo de todas formas? Las instrucciones de ahora quedan en «Versiones anteriores».`
            : `${c.botName} empieza a responder con este cambio. Las instrucciones de ahora quedan en «Mejorar › Versiones anteriores» y puedes restaurarlas.`,
        confirmLabel: "Aplicar",
        danger: c.agentChanged || fixed < tested.length,
      });
      if (!sure) return null;
      try {
        return await applyCorrection(c.botId, c.id, c.agentChanged);
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 409 || c.agentChanged) throw e;
        const force = await confirmDialog({ message: `${e.message} ¿Aplicar de todas formas?`, confirmLabel: "Aplicar de todas formas", danger: true });
        return force ? applyCorrection(c.botId, c.id, true) : null;
      }
    },
    onSuccess: (next) => {
      if (!next) return;
      set(next);
      toast.success(`Corrección aplicada a ${c.botName}`);
      void qc.invalidateQueries({ queryKey: ["improve", c.botId] });
      onPromptChanged();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const discard = useMutation({
    mutationFn: () => discardCorrection(c.botId, c.id),
    onSuccess: (next) => {
      set(next);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="correct__result">
      <Headline correction={c} fixed={fixed} tested={tested.length} />

      {c.note && (
        <p className="correct__asked">
          <b>Lo que pediste:</b> {c.note}
        </p>
      )}

      {c.changes.length > 0 && (
        <section className="correct__sec" data-correct-changes>
          <div className="correct__sec-head">
            <h3>Qué cambia en sus instrucciones</h3>
            <button type="button" className="improve-link" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              {showAll ? "Ver solo lo que cambia" : "Ver las instrucciones enteras"}
            </button>
          </div>
          <ul className="correct__changes">
            {c.changes.map((x, i) => (
              <li key={i}>
                {x.what}
                {x.why && <small>Por: {x.why}</small>}
              </li>
            ))}
          </ul>
          <div className="improve-diff">
            <div className="improve-diff__text">
              {shownDiff.map((l, i) => (
                <div key={i} className={`improve-diff__line is-${l.kind}`}>
                  <span className="improve-diff__mark" aria-hidden="true">
                    {l.kind === "added" ? "+" : l.kind === "removed" ? "−" : ""}
                  </span>
                  {l.kind === "removed" ? <del>{l.text || " "}</del> : l.kind === "added" ? <ins>{l.text || " "}</ins> : <span>{l.text || " "}</span>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="correct__sec">
        <h3>{c.chats.length > 1 ? "Cada chat" : "El chat"}</h3>
        <ul className="correct__chats">
          {c.chats.map((x) => (
            <Chat key={x.id} chat={x} />
          ))}
        </ul>
      </section>

      {c.status === "ready" && <Measure correction={c} />}

      {c.status === "applied" && (
        <p className="improve-note is-ok" data-correct-applied>
          <NavIcon name="check" size={14} /> Aplicada. La situación de cada chat queda en los casos de prueba de «Mejorar», y las instrucciones de antes en «Versiones anteriores».
        </p>
      )}
      {c.status === "ready" && c.agentChanged && (
        <p className="improve-note is-warn" role="status">
          <NavIcon name="alert" size={14} /> Las instrucciones del agente cambiaron desde esta corrección: si la aplicas, ese cambio se pierde.
        </p>
      )}

      <div className="correct__foot">
        <span className="correct__cost">{formatTokens(c.tokens)} tokens gastados</span>
        <span className="correct__actions">
          {onRetry && c.status !== "applied" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry} data-correct-retry>
              Probar de otra forma
            </button>
          )}
          {c.status === "ready" ? (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={discard.isPending || apply.isPending} onClick={() => discard.mutate()} data-correct-discard>
                Descartar
              </button>
              <button type="button" className={`btn btn-sm${fixed === tested.length ? " btn-primary" : ""}`} disabled={apply.isPending || discard.isPending} onClick={() => apply.mutate()} data-correct-apply>
                <NavIcon name="check" size={13} /> {apply.isPending ? "Aplicando…" : "Aplicar al agente"}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Cerrar
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/** En una frase, cómo fue. */
function Headline({ correction: c, fixed, tested }: { correction: AgentCorrection; fixed: number; tested: number }) {
  const h: { tone: string; icon: IconName; title: string; body: string } =
    c.status === "failed"
      ? { tone: "worse", icon: "alert", title: "No se pudo corregir.", body: c.error ?? "Vuelve a intentarlo." }
      : c.status === "nothing"
        ? c.chats.some((x) => x.outcome === "data" || x.outcome === "system")
          ? { tone: "same", icon: "question", title: "No es de sus instrucciones.", body: "Un cambio en ellas no lo arregla: mira abajo qué falta." }
          : { tone: "better", icon: "check", title: "Hoy ya respondería bien.", body: "Con las instrucciones de ahora no falla en ese momento: no hace falta tocar nada. Si quieres que responda de otra forma, escribe qué debió hacer." }
        : c.status === "discarded"
          ? { tone: "same", icon: "minus", title: "Descartada.", body: "El agente no cambió." }
          : fixed === tested
            ? { tone: "better", icon: "check", title: tested > 1 ? `Arreglado en los ${tested} chats.` : "Arreglado.", body: "En el mismo momento, con el cambio ya responde bien." }
            : fixed > 0
              ? { tone: "same", icon: "minus", title: `Arreglado en ${fixed} de ${tested} chats.`, body: "En los demás sigue fallando: míralos antes de aplicar." }
              : { tone: "worse", icon: "alert", title: "El cambio no lo arregla.", body: "Escribe qué debió hacer el agente y prueba de otra forma." };
  return (
    <p className={`improve-verdict is-${h.tone}`} role="status" data-correct-headline={h.tone}>
      <NavIcon name={h.icon} size={15} />
      <span>
        <strong>{h.title}</strong> {h.body}
      </span>
    </p>
  );
}

function Chat({ chat: x }: { chat: CorrectionChat }) {
  const o = OUTCOME[x.outcome];
  const same = (a: string | null, b: string | null) => !!a && !!b && a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
  return (
    <li className="correct__chat" data-correct-chat={x.outcome}>
      <div className="correct__chat-head">
        <strong>{x.contactName}</strong>
        <span className={`correct__chip is-${o.tone}`}>
          <NavIcon name={o.icon} size={12} /> {o.label}
        </span>
        <Link href={`/?c=${x.conversationId}`} className="improve-link">
          abrir chat
        </Link>
      </div>
      {x.problem && <p className="correct__problem">{x.problem}</p>}
      {x.customer && (
        <dl className="correct__talk">
          <Turn label="Cliente" side="customer" text={x.customer} />
          {x.before && <Turn label="Respondió" side="before" text={x.before} />}
          {x.today && !same(x.today, x.before) && <Turn label="Hoy respondería" side={x.outcome === "today_ok" ? "after" : "before"} text={x.today} />}
          {x.after && <Turn label="Con el cambio" side={x.outcome === "fixed" ? "after" : "before"} text={x.after} />}
        </dl>
      )}
      {x.note && <p className="correct__note">{x.note}</p>}
      {(x.outcome === "data" || x.missing) && (
        <p className="correct__links">
          <NavIcon name="question" size={12} /> {x.missing ? `Le faltó un dato: ${x.missing.replace(/\.$/, "")}. ` : ""}Ponlo en{" "}
          <Link className="improve-link" href="/products">
            Productos
          </Link>{" "}
          (si es de un producto) o en{" "}
          <Link className="improve-link" href="/knowledge">
            Conocimiento
          </Link>
          .
        </p>
      )}
    </li>
  );
}

function Turn({ label, side, text }: { label: string; side: "customer" | "before" | "after"; text: string }) {
  return (
    <div className={`correct__turn is-${side}`}>
      <dt>{label}</dt>
      <dd>{whatsappFormat(text)}</dd>
    </div>
  );
}

// ── Comprobar que no estropea otros casos ────────────────────
function Measure({ correction: c }: { correction: AgentCorrection }) {
  const qc = useQueryClient();
  const { data: run } = useQuery({
    queryKey: ["improve-run", c.runId],
    queryFn: () => fetchImproveRun(c.botId, c.runId!),
    enabled: !!c.runId,
    refetchInterval: (q) => (!q.state.data || q.state.data.status === "running" ? 4000 : false),
  });
  const cases = Math.min(c.activeCases, IMPROVE_MAX_CASES);
  const estimate = estimateImprovementTokens(c.basePrompt.length, cases * 2, MEASURE_REPETITIONS, MEASURE_TURNS, 0);
  const start = useMutation({
    mutationFn: () => measureCorrection(c.botId, c.id, MEASURE_REPETITIONS),
    onSuccess: (r) => qc.setQueryData(["correction", c.id], { ...c, runId: r.id }),
    onError: (e) => toast.error((e as Error).message),
  });
  if (!c.runId) {
    return (
      <section className="correct__sec correct__measure">
        <div>
          <h3>¿Estropea otros casos?</h3>
          <p className="improve-note">
            {cases
              ? `Antes de aplicarlo puedes medir ${plural(cases, "caso marcado", "casos marcados")} de «Mejorar», con las instrucciones de hoy y con las corregidas. Gastará unos ${formatTokens(estimate)} tokens y tarda varios minutos. Es opcional.`
              : "Este agente no tiene casos marcados en «Mejorar»: con ellos podrías comprobar que el cambio no estropea otras conversaciones."}
          </p>
        </div>
        {cases > 0 && (
          <button type="button" className="btn btn-sm" disabled={start.isPending} onClick={() => start.mutate()} data-correct-measure>
            <NavIcon name="flask" size={13} /> {start.isPending ? "Empezando…" : "Medir con mis casos"}
          </button>
        )}
      </section>
    );
  }
  const base = run?.variants[0]?.score;
  const mine = run?.variants.find((v) => v.kind === "proposal");
  const verdict = mine?.comparison ? COMPARISON[mine.comparison] : null;
  return (
    <section className="correct__sec" data-correct-run={run?.status ?? "running"}>
      <h3>¿Estropea otros casos?</h3>
      {!run || run.status === "running" ? (
        <p className="improve-note is-loading" role="status">
          Midiendo… {run ? `${run.done} de ${run.total} conversaciones` : ""}
        </p>
      ) : verdict && base && mine?.score ? (
        <>
          <p className={`improve-verdict is-${mine.comparison}`} role="status">
            <NavIcon name={verdict.icon} size={15} />
            <span>
              <strong>{verdict.title}</strong> {verdict.body}
            </span>
          </p>
          <p className="improve-note">
            Atendió bien: {base.ok} de {base.conversations} hoy, {mine.score.ok} de {mine.score.conversations} con el cambio. Inventó un dato: {base.invented} y {mine.score.invented}. Los chats están en «Mejorar».
          </p>
        </>
      ) : (
        <p className="improve-note is-error" role="alert">
          {run.error ?? "La medición no terminó."}
        </p>
      )}
    </section>
  );
}
