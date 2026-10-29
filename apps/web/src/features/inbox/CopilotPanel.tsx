"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CopilotSummary } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useLocale, useT } from "@/i18n/I18nProvider";
import { copilotAsk, copilotSummary, fetchContactMemory, refreshContactMemory } from "@/lib/bff";
import { PROVIDER_LABEL, useAiStatus } from "@/features/copilot/useAiStatus";

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Copiloto de la conversación: resumen, preguntas sobre el cliente y su
 * memoria. Con la clave de IA de la empresa o la IA incluida en su plan; sin IA, se explica cómo
 * activarlo en vez de mostrar botones que fallarían.
 */
export function CopilotPanel({
  conversationId,
  onUseText,
}: {
  conversationId: string;
  /** Carga un texto en el cuadro de mensaje (p. ej. una respuesta del copiloto). */
  onUseText: (text: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: status } = useAiStatus();
  const ready = !!status?.ready;

  const [summary, setSummary] = useState<CopilotSummary | null>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  const memory = useQuery({
    queryKey: ["contact-memory", conversationId],
    queryFn: () => fetchContactMemory(conversationId),
  });

  const summarize = useMutation({
    mutationFn: () => copilotSummary(conversationId),
    onSuccess: setSummary,
  });

  const ask = useMutation({
    mutationFn: (q: string) => copilotAsk(conversationId, { question: q, history: turns.slice(-8) }),
    onSuccess: (r, q) => {
      setTurns((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: r.answer }]);
      setQuestion("");
    },
  });

  const refresh = useMutation({
    mutationFn: () => refreshContactMemory(conversationId),
    onSuccess: (m) => queryClient.setQueryData(["contact-memory", conversationId], m),
  });

  const mem = memory.data;

  return (
    <section className="copilot" aria-label={t("inbox.copilotTitle")}>
      <header className="copilot__head">
        <span className="copilot__title">
          <NavIcon name="sparkles" size={14} />
          {t("inbox.copilotTitle")}
        </span>
        {status && ready && (
          <span className="copilot__key">
            {status.source === "included"
              ? t("inbox.copilotIncluded")
              : t("inbox.copilotOwnKey", { provider: PROVIDER_LABEL[status.provider] ?? status.provider })}
          </span>
        )}
      </header>

      {status && !ready && (
        <div className="copilot__nokey">
          <span>{status.included?.exhausted ? t("inbox.copilotIncludedExhausted") : t("inbox.copilotNoKey")}</span>
          <Link href="/settings?tab=ai" className="btn btn-ghost btn-sm">
            {t("inbox.copilotConfigure")}
          </Link>
        </div>
      )}

      {/* Resumen */}
      <div className="copilot__block">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!ready || summarize.isPending}
          onClick={() => summarize.mutate()}
        >
          <NavIcon name="note" size={13} />
          {summarize.isPending ? t("inbox.copilotSummarizing") : t("inbox.copilotSummarize")}
        </button>
        {summary && (
          <div className="copilot__summary">
            <p>{summary.summary}</p>
            {summary.points.length > 0 && (
              <ul>
                {summary.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {summary.nextStep && (
              <p className="copilot__next">
                <strong>{t("inbox.copilotNextStep")}:</strong> {summary.nextStep}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Preguntar */}
      <div className="copilot__block">
        {turns.length > 0 && (
          <div className="copilot__chat">
            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="copilot__q">
                  {turn.content}
                </div>
              ) : (
                <div key={i} className="copilot__a">
                  <div style={{ whiteSpace: "pre-wrap" }}>{turn.content}</div>
                  <button type="button" className="copilot__use" onClick={() => onUseText(turn.content)}>
                    <NavIcon name="reply" size={12} />
                    {t("inbox.copilotUseAnswer")}
                  </button>
                </div>
              ),
            )}
          </div>
        )}
        <form
          className="copilot__ask"
          onSubmit={(e) => {
            e.preventDefault();
            const q = question.trim();
            if (q.length >= 2) ask.mutate(q);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("inbox.copilotAskPlaceholder")}
            aria-label={t("inbox.copilotAskPlaceholder")}
            disabled={!ready || ask.isPending}
            className="field field-sm"
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!ready || ask.isPending || question.trim().length < 2}>
            {ask.isPending ? t("inbox.copilotThinking") : t("inbox.copilotAsk")}
          </button>
        </form>
      </div>

      {/* Memoria del cliente */}
      <div className="copilot__block">
        <div className="copilot__memhead">
          <strong>{t("inbox.copilotMemory")}</strong>
          <button
            type="button"
            className="copilot__use"
            disabled={!ready || refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <NavIcon name="clock" size={12} />
            {refresh.isPending ? t("inbox.copilotThinking") : t("inbox.copilotMemoryRefresh")}
          </button>
        </div>
        {mem && (mem.summary || mem.facts.length > 0) ? (
          <div className="copilot__memory">
            {mem.summary && <p>{mem.summary}</p>}
            {mem.facts.length > 0 && (
              <ul>
                {mem.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
            {mem.updatedAt && (
              <span className="copilot__muted">
                {t("inbox.copilotMemoryUpdated", {
                  date: new Date(mem.updatedAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                })}
              </span>
            )}
          </div>
        ) : (
          <p className="copilot__muted">{t("inbox.copilotMemoryEmpty")}</p>
        )}
      </div>
    </section>
  );
}
