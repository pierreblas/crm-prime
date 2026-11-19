"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CHAT_REVIEW_DAILY_MAX,
  CHAT_REVIEW_DAYS_OPTIONS,
  CHAT_REVIEW_MANUAL_DAYS,
  CHAT_REVIEW_MANUAL_MAX,
  type ChatReviewOverview,
  type ConversationReviewDto,
  type SimulationFindingKind,
  type SimulationVerdict,
} from "@crm/shared";
import { NavIcon, type IconName } from "@/components/NavIcons";
import { fetchChatReviews, runChatReviews, setChatReviewDaily, updateChatReview } from "@/lib/bff";
import { toast } from "@/lib/toast";

const VERDICT_LABEL: Record<SimulationVerdict, string> = { ok: "Bien", review: "Revisar", bad: "Mal" };
const FINDING: Record<SimulationFindingKind, { icon: IconName; label: string }> = {
  invented: { icon: "alert", label: "Inventó un dato" },
  unanswered: { icon: "question", label: "No respondió" },
  no_next_step: { icon: "arrow-right", label: "Sin siguiente paso" },
  handoff: { icon: "user", label: "Pasar a una persona" },
  tone: { icon: "message", label: "Forma" },
  good: { icon: "check", label: "Bien" },
};

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `hace ${Math.max(1, mins)} min`;
  if (mins < 60 * 24) return `hace ${Math.round(mins / 60)} h`;
  const days = Math.round(mins / (60 * 24));
  return days === 1 ? "ayer" : `hace ${days} días`;
}

/**
 * Revisión de chats: lo que la IA revisó de las conversaciones que atendió el
 * agente de verdad, con lo que hay que mirar primero («Mal»: inventó un dato;
 * «Revisar»: algo mejorable), la frase exacta y el enlace al chat. La pasada
 * diaria se activa aquí (viene apagada: gasta tokens) y se puede lanzar a mano.
 */
export function ChatReviewPanel() {
  const qc = useQueryClient();
  const [show, setShow] = useState<"open" | "all">("open");
  const [days, setDays] = useState<number>(CHAT_REVIEW_MANUAL_DAYS);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["chat-reviews", show],
    queryFn: () => fetchChatReviews(show),
    // Mientras corre una pasada, se refresca solo para ver el avance y lo que va saliendo.
    refetchInterval: (q) => (q.state.data?.running ? 4000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["chat-reviews"] });
  /**
   * El cambio se ve al momento (interruptor, «Marcar como vista») y luego se
   * confirma con el servidor: sin esto, el interruptor seguía en su estado
   * anterior hasta la recarga y un segundo toque volvía a mandar lo mismo.
   */
  const patchCache = (fn: (old: ChatReviewOverview, key: readonly unknown[]) => ChatReviewOverview) => {
    for (const [key, old] of qc.getQueriesData<ChatReviewOverview>({ queryKey: ["chat-reviews"] })) {
      if (old) qc.setQueryData(key, fn(old, key));
    }
  };

  const run = useMutation({
    mutationFn: () => runChatReviews(days),
    onSuccess: (r) => {
      if (!r.started) toast.info("Ya hay una revisión en marcha.");
      void refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const daily = useMutation({
    mutationFn: (enabled: boolean) => setChatReviewDaily(enabled),
    onMutate: (enabled) => patchCache((old) => ({ ...old, enabled })),
    onSuccess: (_r, enabled) => toast.success(enabled ? "Revisión diaria activada" : "Revisión diaria apagada"),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => void refresh(),
  });
  const mark = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "done" }) => updateChatReview(id, status),
    onMutate: ({ id, status }) =>
      patchCache((old, key) => {
        const target = old.reviews.find((r) => r.id === id);
        const counts = !!target && target.verdict !== "ok" && target.status !== status;
        const open = counts ? Math.max(0, old.open + (status === "done" ? -1 : 1)) : old.open;
        const reviews =
          key[1] === "open" && status === "done"
            ? old.reviews.filter((r) => r.id !== id)
            : old.reviews.map((r) => (r.id === id ? { ...r, status } : r));
        return { ...old, open, reviews };
      }),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => void refresh(),
  });

  const running = data?.running;
  return (
    <div className="chat-review" data-chat-review>
      <header className="chat-review__head">
        <div>
          <h2>Revisión de chats</h2>
          <p>
            La IA revisa las conversaciones que atendió tu agente, con lo que consultó en cada respuesta, y te marca las que hay que mirar: si
            inventó un dato, si no respondió lo que le preguntaron o si no propuso el siguiente paso.
          </p>
        </div>
      </header>

      <div className="chat-review__controls">
        <label className="chat-review__switch">
          <input
            type="checkbox"
            checked={!!data?.enabled}
            disabled={!data || daily.isPending}
            onChange={(e) => daily.mutate(e.target.checked)}
            data-chat-review-daily
          />
          <span className="chat-review__track" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Revisar cada día</strong>
            <small>
              Hasta {CHAT_REVIEW_DAILY_MAX} conversaciones con mensajes nuevos de la IA. Cada revisión gasta unos 5 mil tokens.
            </small>
          </span>
        </label>
        <div className="chat-review__run">
          <span className="chat-review__run-row">
            <select
              className="field"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              disabled={!!running}
              aria-label="Cuántos días hacia atrás revisar"
              data-chat-review-days
            >
              {CHAT_REVIEW_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  Últimos {d} días
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={!!running || run.isPending} onClick={() => run.mutate()} data-chat-review-run>
              <NavIcon name="sparkles" size={14} />
              {running ? `Revisando ${running.done} de ${running.total || "…"}` : "Revisar ahora"}
            </button>
          </span>
          <small>
            {data?.lastRunAt ? `Última revisión: ${ago(data.lastRunAt)}.` : "Todavía no se revisó nada."} Hasta {CHAT_REVIEW_MANUAL_MAX} conversaciones por vez.
          </small>
        </div>
      </div>

      <div className="seg seg-sm chat-review__tabs" role="tablist" aria-label="Qué revisiones ver">
        <button type="button" role="tab" aria-selected={show === "open"} className={show === "open" ? "is-active" : ""} onClick={() => setShow("open")} data-chat-review-tab="open">
          Para mirar{data ? ` · ${data.open}` : ""}
        </button>
        <button type="button" role="tab" aria-selected={show === "all"} className={show === "all" ? "is-active" : ""} onClick={() => setShow("all")} data-chat-review-tab="all">
          Todas
        </button>
      </div>

      {isPending && <p className="chat-review__empty">Cargando…</p>}
      {isError && <p className="chat-review__empty is-error">{(error as Error).message}</p>}
      {data && data.reviews.length === 0 && (
        <p className="chat-review__empty" data-chat-review-empty>
          {show === "open"
            ? running
              ? "Revisando… lo que haya que mirar aparecerá aquí."
              : "Nada para mirar. Las conversaciones que salieron bien están en «Todas»."
            : "Todavía no hay conversaciones revisadas. Pulsa «Revisar ahora» o activa la revisión diaria."}
        </p>
      )}

      <ul className="chat-review__list">
        {data?.reviews.map((r) => (
          <ReviewItem key={r.id} review={r} onMark={(status) => mark.mutate({ id: r.id, status })} busy={mark.isPending} />
        ))}
      </ul>
    </div>
  );
}

function ReviewItem({ review: r, onMark, busy }: { review: ConversationReviewDto; onMark: (status: "open" | "done") => void; busy: boolean }) {
  return (
    <li className={`chat-review__item sim-review sim-review--${r.verdict}${r.status === "done" ? " is-done" : ""}`} data-chat-review-item={r.verdict}>
      <div className="chat-review__item-head">
        <span className={`sim-verdict sim-verdict--${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span>
        <strong>{r.contactName}</strong>
        <span className="chat-review__meta">
          {r.channel}
          {r.agentName ? ` · ${r.agentName}` : ""} · {ago(r.lastMessageAt)}
        </span>
      </div>
      {r.summary && <p className="sim-review__summary">{r.summary}</p>}
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
      <div className="chat-review__actions">
        <Link href={`/?c=${r.conversationId}`} className="btn btn-sm" data-chat-review-open>
          <NavIcon name="inbox" size={13} /> Abrir chat
        </Link>
        {r.status === "open" ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onMark("done")} data-chat-review-done>
            <NavIcon name="check" size={13} /> Marcar como vista
          </button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onMark("open")}>
            Volver a «Para mirar»
          </button>
        )}
      </div>
    </li>
  );
}
