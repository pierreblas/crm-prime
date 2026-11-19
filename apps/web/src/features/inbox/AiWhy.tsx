"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AiRunTrace } from "@crm/shared";
import { fetchAiRunTrace } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";
import type { Translator } from "@/i18n/translate";
import { ToolTrace } from "@/features/bots/PlayReply";

/**
 * «¿Por qué respondió esto?» en la bandeja: un enlace junto a una respuesta de
 * la IA que despliega qué entendió del mensaje, qué consultó (y qué encontró en
 * cada consulta), qué acciones hizo y si pasó el chat. Lo mismo que se ve en
 * «Probar conversación», pero con un cliente de verdad. Se carga al abrirlo.
 */
export function AiWhy({ conversationId, runId, align = "end" }: { conversationId: string; runId: string; align?: "start" | "end" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="ai-why" data-align={align}>
      <button
        type="button"
        className="ai-why__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-ai-why={runId}
      >
        <NavIcon name="sparkles" size={11} /> {t("inbox.aiWhy")}
      </button>
      {open && <AiWhyPanel conversationId={conversationId} runId={runId} />}
    </div>
  );
}

function AiWhyPanel({ conversationId, runId }: { conversationId: string; runId: string }) {
  const t = useT();
  const { data, isPending, isError } = useQuery({
    queryKey: ["ai-run-trace", runId],
    queryFn: () => fetchAiRunTrace(conversationId, runId),
    // Una respuesta ya escrita no cambia (salvo sus acciones al enviarse): sin recargas solas.
    staleTime: 60_000,
  });
  if (isPending) return <div className="ai-why__panel">{t("inbox.aiWhyLoading")}</div>;
  if (isError || !data) return <div className="ai-why__panel ai-why__panel--error">{t("inbox.aiWhyError")}</div>;
  return <TraceView trace={data} />;
}

function TraceView({ trace }: { trace: AiRunTrace }) {
  const t = useT();
  const c = trace.classification;
  const statusLabel = (s: string) =>
    s === "PENDING_APPROVAL" ? t("inbox.aiWhyPending") : s === "REJECTED" ? t("inbox.aiWhyRejected") : s === "ERROR" ? t("inbox.aiWhyFailed") : null;
  return (
    <div className="ai-why__panel" role="region" aria-label={t("inbox.aiWhyTitle")} data-ai-why-panel>
      <strong className="ai-why__title">
        {t("inbox.aiWhyTitle")}
        {trace.agentName ? ` · ${trace.agentName}` : ""}
      </strong>
      {c && (
        <p className="ai-why__line">
          <span className="ai-why__label">{t("inbox.aiWhyUnderstood")}:</span> {c.intent} · {sentimentLabel(c.sentiment, t)}
          {c.urgency === "high" ? ` · ${t("inbox.aiUrgent")}` : ""}
          {trace.confidence != null ? ` · ${t("inbox.aiWhyConfidence", { value: trace.confidence })}` : ""}
        </p>
      )}
      <span className="ai-why__label">{t("inbox.aiWhyLookedUp")}</span>
      {trace.steps.length ? (
        <ToolTrace calls={trace.steps} statusLabel={statusLabel} label={t("inbox.aiWhyLookedUp")} />
      ) : (
        <p className="ai-why__warn" data-ai-why-nothing>
          <NavIcon name="alert" size={12} /> {t("inbox.aiWhyNothing")}
        </p>
      )}
      {trace.escalationReason && (
        <p className="ai-why__line ai-why__handoff">
          <NavIcon name="user" size={12} /> {t("inbox.aiWhyHandoff")}: {trace.escalationReason}
        </p>
      )}
      <p className="ai-why__meta">
        {trace.model} · {trace.inputTokens + trace.outputTokens} tok
        {trace.costUsd > 0 ? ` · $${trace.costUsd.toFixed(4)}` : ""}
        {trace.latencyMs != null ? ` · ${t("inbox.aiWhySeconds", { value: (trace.latencyMs / 1000).toFixed(1) })}` : ""}
      </p>
    </div>
  );
}

/** El ánimo del cliente, con palabras (también lo usa la sugerencia del copiloto). */
export function sentimentLabel(s: string, t: Translator): string {
  if (s === "negative") return t("inbox.sentimentNegative");
  if (s === "positive") return t("inbox.sentimentPositive");
  return t("inbox.sentimentNeutral");
}
