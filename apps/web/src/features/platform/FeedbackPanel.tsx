"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_STATUS_LABEL,
  feedbackKinds,
  feedbackStatuses,
  type FeedbackKind,
  type FeedbackStatus,
  type PlatformFeedback,
} from "@crm/shared";
import { toast } from "@/lib/toast";
import { fetchPlatformFeedback, updatePlatformFeedback } from "@/lib/bff";
import { dateTime } from "./platformFormat";

/** Consola › Feedback: lo que las empresas nos escriben desde el «?» de su panel. */
export function FeedbackPanel({ onOpenOrg }: { onOpenOrg: (id: string) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<FeedbackKind | "all">("all");
  const [status, setStatus] = useState<FeedbackStatus | "open">("open");
  const list = useQuery({
    queryKey: ["platform", "feedback", kind, status],
    queryFn: () => fetchPlatformFeedback({ kind: kind === "all" ? undefined : kind, status }),
  });
  const update = useMutation({
    mutationFn: ({ id, s }: { id: string; s: FeedbackStatus }) => updatePlatformFeedback(id, { status: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform", "feedback"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const d = list.data;

  return (
    <section className="pc-panel" data-feedback-panel>
      <div className="pc-panel__head">
        <h2>Feedback de las empresas</h2>
        <span className="pc-muted" style={{ fontSize: 12.5 }}>
          {d ? `${d.newCount} sin leer · ${d.opinions} opiniones${d.avgRating !== null ? ` · media ${d.avgRating.toFixed(1)} ★` : ""}` : "Errores, sugerencias y opiniones enviados desde el «?» del panel."}
        </span>
      </div>
      <div className="pc-filters">
        <label>
          Tipo{" "}
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind | "all")}>
            <option value="all">Todos</option>
            {feedbackKinds.map((k) => (
              <option key={k} value={k}>{FEEDBACK_KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label>
          Estado{" "}
          <select className="field" value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus | "open")}>
            <option value="open">Por atender (nuevos y vistos)</option>
            {feedbackStatuses.map((s) => (
              <option key={s} value={s}>{FEEDBACK_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
      </div>
      {list.isError && <p style={{ color: "var(--danger)" }}>No se pudo cargar el feedback.</p>}
      {list.isPending && <div className="skeleton" style={{ height: 80 }} />}
      {d && d.items.length === 0 && <p className="pc-empty">Nada con estos filtros.</p>}
      {d && d.items.length > 0 && (
        <ul className="pc-feedback">
          {d.items.map((f) => (
            <FeedbackItem key={f.id} f={f} onOpenOrg={onOpenOrg} busy={update.isPending} onStatus={(s) => update.mutate({ id: f.id, s })} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedbackItem({ f, onOpenOrg, onStatus, busy }: { f: PlatformFeedback; onOpenOrg: (id: string) => void; onStatus: (s: FeedbackStatus) => void; busy: boolean }) {
  return (
    <li className={`pc-feedback__item is-${f.kind}${f.status === "new" ? " is-new" : ""}`} data-feedback-id={f.id}>
      <div className="pc-feedback__meta">
        <span className={`pc-feedback__kind is-${f.kind}`}>{FEEDBACK_KIND_LABEL[f.kind]}</span>
        {f.rating !== null && <span className="pc-feedback__stars" aria-label={`${f.rating} de 5`}>{"★".repeat(f.rating)}<span>{"★".repeat(5 - f.rating)}</span></span>}
        <button type="button" className="pc-th" style={{ color: "var(--accent-text)" }} onClick={() => onOpenOrg(f.orgId)}>
          {f.orgName}
        </button>
        <span className="pc-muted">{f.userName ?? f.userEmail ?? "—"}</span>
        <span className="pc-muted" title={f.createdAt}>{dateTime(f.createdAt)}</span>
        {f.pagePath && <code className="pc-feedback__page" title={f.userAgent ?? undefined}>{f.pagePath}</code>}
      </div>
      {f.message ? <p className="pc-feedback__msg">{f.message}</p> : <p className="pc-feedback__msg pc-muted">Sin comentario.</p>}
      <div className="pc-feedback__actions">
        <span className="pc-muted">{FEEDBACK_STATUS_LABEL[f.status]}</span>
        {f.status !== "seen" && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onStatus("seen")}>Marcar visto</button>
        )}
        {f.status !== "done" ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onStatus("done")}>Resuelto</button>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onStatus("new")}>Reabrir</button>
        )}
      </div>
    </li>
  );
}
