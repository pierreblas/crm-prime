"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampaignDto, CampaignRecipient } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { duplicateCampaign, fetchCampaignRecipients, retryFailedCampaign, tagCampaignResponders } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { confirmDialog } from "@/lib/confirm";
import { STATUS_LABEL } from "./CampaignsManager";

type Filter = "all" | "replied" | "read" | "failed" | "pending";

const RECIPIENT_LABEL: Record<CampaignRecipient["status"], string> = {
  queued: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
};

/** Ficha de una difusión: embudo de resultados, destinatarios y qué hacer con ellos. */
export function CampaignDetail({ campaign: c, onClose }: { campaign: CampaignDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [tagName, setTagName] = useState(`Respondió: ${c.name}`.slice(0, 60));
  const running = c.status === "RUNNING";
  const { data: rows = [], isPending } = useQuery({
    queryKey: ["campaign-recipients", c.id],
    queryFn: () => fetchCampaignRecipients(c.id),
    refetchInterval: running ? 4000 : false,
  });

  // La API recalcula las métricas al cargar los destinatarios: refresca la tarjeta.
  useEffect(() => {
    if (rows.length) qc.invalidateQueries({ queryKey: ["campaigns"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["campaigns"] });
    qc.invalidateQueries({ queryKey: ["campaign-recipients", c.id] });
  };
  const retry = useMutation({
    mutationFn: () => retryFailedCampaign(c.id),
    onSuccess: (r) => {
      toast.success(r.queued ? `Reintentando ${r.queued} envío${r.queued === 1 ? "" : "s"}` : "No hay fallidos con permiso para reintentar");
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const tag = useMutation({
    mutationFn: () => tagCampaignResponders(c.id, tagName.trim()),
    onSuccess: (r) => toast.success(r.tagged ? `${r.tagged} contacto${r.tagged === 1 ? "" : "s"} con la etiqueta «${tagName.trim()}»` : "Ya tenían la etiqueta (o nadie respondió)"),
    onError: (e) => toast.error((e as Error).message),
  });
  const dup = useMutation({
    mutationFn: () => duplicateCampaign(c.id),
    onSuccess: () => {
      toast.success("Copia creada como borrador");
      refresh();
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const shown = useMemo(() => {
    switch (filter) {
      case "replied":
        return rows.filter((r) => r.replied);
      case "read":
        return rows.filter((r) => r.status === "read");
      case "failed":
        return rows.filter((r) => r.status === "failed");
      case "pending":
        return rows.filter((r) => r.status === "queued" || r.status === "sent");
      default:
        return rows;
    }
  }, [rows, filter]);

  const pct = (x: number) => (c.totalRecipients ? Math.round((x / c.totalRecipients) * 100) : 0);
  const funnel: { key: string; label: string; value: number; tone?: string }[] = [
    { key: "sent", label: "Enviados", value: c.sentCount },
    { key: "delivered", label: "Entregados", value: c.deliveredCount },
    { key: "read", label: "Leídos", value: c.readCount },
    { key: "replied", label: "Respondieron", value: c.repliedCount, tone: "ok" },
  ];

  const exportCsv = () => {
    const head = ["nombre", "telefono", "estado", "respondio", "error", "enviado"];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [head.join(","), ...rows.map((r) => [r.name ?? "", r.phone, RECIPIENT_LABEL[r.status], r.replied ? "sí" : "no", r.error ?? "", r.sentAt].map((v) => esc(String(v))).join(","))];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `difusion-${c.name.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // En un portal: el contenido de la página crea su propio contexto de apilado
  // y la ficha quedaría bajo la barra superior.
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="cd-backdrop" onClick={onClose} />
      <aside className="cd" role="dialog" aria-label={`Difusión ${c.name}`} data-campaign-detail>
        <header className="cd__head">
          <div style={{ minWidth: 0 }}>
            <h3>{c.name}</h3>
            <p>
              <span className={`cm-status is-${c.status.toLowerCase()}`}>{STATUS_LABEL[c.status]}</span> · {c.template.name}
              {c.startedAt ? ` · ${new Date(c.startedAt).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}` : ""}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <NavIcon name="x" size={15} />
          </button>
        </header>

        <div className="cd__body">
          <div className="cd-funnel" data-funnel>
            {funnel.map((f) => (
              <div key={f.key} className={`cd-funnel__step${f.tone ? ` is-${f.tone}` : ""}`}>
                <span className="cd-funnel__label">{f.label}</span>
                <strong>{f.value}</strong>
                <span className="cd-funnel__bar"><span style={{ width: `${pct(f.value)}%` }} /></span>
                <span className="cd-funnel__pct">{pct(f.value)}%</span>
              </div>
            ))}
            {c.failedCount > 0 && (
              <div className="cd-funnel__step is-bad">
                <span className="cd-funnel__label">Fallidos</span>
                <strong>{c.failedCount}</strong>
                <span className="cd-funnel__bar"><span style={{ width: `${pct(c.failedCount)}%` }} /></span>
                <span className="cd-funnel__pct">{pct(c.failedCount)}%</span>
              </div>
            )}
          </div>
          <p className="cd__note">De {c.totalRecipients} destinatarios. «Respondieron» cuenta a quien escribió en los 7 días siguientes al envío.</p>

          <div className="cd-actions">
            {c.repliedCount > 0 && (
              <div className="cd-action">
                <div>
                  <strong>Etiquetar a quienes respondieron</strong>
                  <span>Para seguir con ellos: un flujo, una etapa o la próxima difusión.</span>
                </div>
                <div className="cd-action__row">
                  <input className="field field-sm" value={tagName} maxLength={60} onChange={(e) => setTagName(e.target.value)} aria-label="Etiqueta" />
                  <button type="button" className="btn btn-primary btn-sm" disabled={!tagName.trim() || tag.isPending} onClick={() => tag.mutate()} data-tag-responders>
                    Etiquetar {c.repliedCount}
                  </button>
                </div>
              </div>
            )}
            {c.failedCount > 0 && !running && (
              <div className="cd-action">
                <div>
                  <strong>Reintentar los fallidos</strong>
                  <span>Solo a quien sigue con permiso. Revisa antes el motivo: un número mal escrito volverá a fallar.</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={retry.isPending}
                  onClick={() => void confirmDialog({ message: c.failedCount === 1 ? "Se volverá a enviar al destinatario que falló." : `Se volverá a enviar a los ${c.failedCount} destinatarios que fallaron.`, confirmLabel: "Reintentar" }).then((ok) => ok && retry.mutate())}
                  data-retry-failed
                >
                  Reintentar {c.failedCount}
                </button>
              </div>
            )}
          </div>

          <div className="cd-list__head">
            <div className="seg" role="tablist" aria-label="Filtrar destinatarios">
              {(
                [
                  ["all", `Todos ${rows.length}`],
                  ["replied", `Respondieron ${rows.filter((r) => r.replied).length}`],
                  ["read", "Leídos"],
                  ["pending", "Sin entregar"],
                  ["failed", `Fallidos ${rows.filter((r) => r.status === "failed").length}`],
                ] as [Filter, string][]
              ).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!rows.length}>
              <NavIcon name="arrow-down" size={13} /> CSV
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => dup.mutate()} disabled={dup.isPending} data-duplicate>
              <NavIcon name="copy" size={13} /> Duplicar
            </button>
          </div>

          {isPending ? (
            <div className="skeleton" style={{ height: 120, borderRadius: 10 }} />
          ) : shown.length === 0 ? (
            <p className="cd__note">{rows.length ? "Nadie en este filtro." : "Todavía no se ha enviado a nadie."}</p>
          ) : (
            <ul className="cd-list" data-recipients>
              {shown.map((r) => (
                <li key={r.conversationId} className={`cd-row is-${r.status}`}>
                  <span className="cd-row__who">
                    <strong>{r.name ?? r.phone}</strong>
                    {r.name && <small>{r.phone}</small>}
                    {r.error && <small className="cd-row__err" title={r.error}>{r.error}</small>}
                  </span>
                  <span className={`cd-pill is-${r.status}`}>{RECIPIENT_LABEL[r.status]}</span>
                  {r.replied && <span className="cd-pill is-replied">Respondió</span>}
                  <Link href={`/?c=${r.conversationId}`} className="cd-row__chat" title="Abrir el chat" aria-label="Abrir el chat">
                    <NavIcon name="message" size={13} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}
