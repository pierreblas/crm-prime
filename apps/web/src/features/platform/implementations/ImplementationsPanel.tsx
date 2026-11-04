"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_PRICING_SETTINGS, type ImplementationAssessment, type ImplementationAssessmentRow } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { archiveImplementation, createImplementationQuote, fetchImplementation, fetchImplementationQuote, fetchImplementations, fetchPricingSettings } from "@/lib/bff";
import { date, relative } from "../platformFormat";
import { AssessmentForm } from "./AssessmentForm";
import { CrmLinkBar } from "./CrmLink";
import { PricingSettingsPanel } from "./PricingSettingsPanel";
import { QuoteEditor, type QuoteSection } from "./QuoteEditor";
import { BAND_LABEL, BAND_TONE, RISK_LABEL, STAGE_LABEL, STAGE_TONE, STATUS_LABEL, STATUS_TONE, fmtMoney, fmtPct } from "./labels";

type View = { kind: "list" } | { kind: "settings" } | { kind: "new" } | { kind: "detail"; id: string; quoteId: string | null };

/**
 * Consola › Implementaciones: el cotizador interno. Lista de diagnósticos,
 * ajustes (tarifas y plantillas), alta en pasos y la ficha de cada uno con su
 * estimación, su propuesta, la vista del cliente, las horas reales y las
 * versiones. Todo vive en la consola: ninguna empresa lo ve, y nada de aquí
 * toca sus planes ni sus datos.
 */
export function ImplementationsPanel({ onOpenOrg }: { onOpenOrg: (id: string) => void }) {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "new") {
    return (
      <>
        <Crumbs onBack={() => setView({ kind: "list" })} title="Nuevo diagnóstico" />
        <AssessmentForm onCancel={() => setView({ kind: "list" })} onSaved={(a) => setView({ kind: "detail", id: a.id, quoteId: null })} />
      </>
    );
  }
  if (view.kind === "detail") {
    return <AssessmentDetail id={view.id} quoteId={view.quoteId} onBack={() => setView({ kind: "list" })} onPickQuote={(quoteId) => setView({ kind: "detail", id: view.id, quoteId })} onOpenOrg={onOpenOrg} />;
  }
  return (
    <>
      <div className="pc-tabs">
        <div className="seg" role="tablist" aria-label="Cotizador">
          <button type="button" role="tab" aria-selected={view.kind === "list"} onClick={() => setView({ kind: "list" })}>
            Diagnósticos
          </button>
          <button type="button" role="tab" aria-selected={view.kind === "settings"} onClick={() => setView({ kind: "settings" })} data-impl-settings-tab>
            Ajustes
          </button>
        </div>
      </div>
      {view.kind === "settings" ? (
        <PricingSettingsPanel />
      ) : (
        <ImplementationsList onNew={() => setView({ kind: "new" })} onOpen={(id) => setView({ kind: "detail", id, quoteId: null })} onOpenOrg={onOpenOrg} />
      )}
    </>
  );
}

function Crumbs({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="pc-actions" style={{ gap: 6 }}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} data-back>
        ← Implementaciones
      </button>
      <span className="pc-muted">/</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
    </div>
  );
}

// ── Lista ───────────────────────────────────────────────────────

function ImplementationsList({ onNew, onOpen, onOpenOrg }: { onNew: () => void; onOpen: (id: string) => void; onOpenOrg: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const list = useQuery({ queryKey: ["platform", "impl", "list", search, archived], queryFn: () => fetchImplementations(search, archived), placeholderData: keepPreviousData });
  const rows = list.data ?? [];

  const totals = useMemo(() => {
    const t = { open: 0, sent: 0, accepted: 0, acceptedCents: 0, lost: 0, expired: 0 };
    for (const r of rows) {
      if (r.stage === "quoting" || r.stage === "review" || r.stage === "approved") t.open++;
      if (r.stage === "sent") t.sent++;
      if (r.stage === "accepted") {
        t.accepted++;
        if (r.latestQuote?.currency === "USD") t.acceptedCents += r.latestQuote.proposedPriceCents ?? 0;
      }
      if (r.stage === "rejected" || r.stage === "cancelled") t.lost++;
      if (r.stage === "expired") t.expired++;
    }
    const decided = t.accepted + t.lost + t.expired;
    return { ...t, winRate: decided > 0 ? Math.round((t.accepted / decided) * 10000) : null };
  }, [rows]);

  return (
    <>
      <section className="pc-summary" aria-label="Resumen de implementaciones" data-impl-summary>
        <div>
          <span>{archived ? "Archivados" : "Diagnósticos"}</span>
          <b>{list.data ? rows.length : "…"}</b>
        </div>
        <div>
          <span>En cotización o revisión</span>
          <b>{list.data ? totals.open : "…"}</b>
        </div>
        <div>
          <span>Enviadas al cliente</span>
          <b>{list.data ? totals.sent : "…"}</b>
        </div>
        <div className="is-key">
          <span>Aceptadas</span>
          <b>{list.data ? `${totals.accepted} · ${fmtMoney(totals.acceptedCents, "USD")}` : "…"}</b>
        </div>
        <div>
          <span>Aceptadas sobre decididas</span>
          <b>{list.data ? fmtPct(totals.winRate) : "…"}</b>
        </div>
        <div className={totals.expired > 0 ? "is-bad" : undefined}>
          <span>Vencidas sin respuesta</span>
          <b>{list.data ? totals.expired : "…"}</b>
        </div>
      </section>

      <section className="pc-panel" data-impl-list>
        <div className="pc-panel__head">
          <h2>
            Implementaciones <span className="pc-muted" style={{ fontWeight: 500, fontSize: 13 }}>· cotizador interno</span>
          </h2>
          <div className="pc-filters">
            <label className="pc-search">
              <NavIcon name="search" size={15} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cliente, título, número o sector" aria-label="Buscar implementaciones" />
            </label>
            <label className="pc-check" style={{ fontSize: 12.5, color: "var(--muted)" }}>
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} data-show-archived />
              Archivados
            </label>
            <button type="button" className="btn btn-primary btn-sm" onClick={onNew} data-new-assessment>
              Nuevo diagnóstico
            </button>
          </div>
        </div>
        {list.isError && <p style={{ color: "var(--danger)" }}>No se pudieron cargar los diagnósticos.</p>}
        {list.isPending && <div className="skeleton" style={{ height: 80 }} />}
        {list.data && rows.length === 0 && (
          <p className="pc-empty">
            {archived ? "Nada archivado." : search ? "Ninguno coincide." : "Todavía no hay diagnósticos. El primero empieza con «Nuevo diagnóstico»: cliente y objetivo, alcance, estimación y propuesta."}
          </p>
        )}
        {rows.length > 0 && (
          <div className="pc-table-wrap">
            <table className="pc-table" data-impl-table>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente y proyecto</th>
                  <th>Etapa</th>
                  <th>Complejidad</th>
                  <th className="num">Propuesto</th>
                  <th className="num">Mínimo</th>
                  <th>Vigencia</th>
                  <th>Responsable</th>
                  <th>Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.id} r={r} onOpen={() => onOpen(r.id)} onOpenOrg={onOpenOrg} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Row({ r, onOpen, onOpenOrg }: { r: ImplementationAssessmentRow; onOpen: () => void; onOpenOrg: (id: string) => void }) {
  const q = r.latestQuote;
  const cur = q?.currency ?? "USD";
  return (
    <tr data-impl-row={r.id}>
      <td>
        <button type="button" className="pc-th" onClick={onOpen} style={{ color: "var(--accent-text)", fontWeight: 600 }}>
          {r.quoteNumber ?? "sin cotizar"}
        </button>
        {q && <small> · v{q.version}</small>}
      </td>
      <td>
        <div className="pc-org">
          <button type="button" className="pc-org__name pc-th" onClick={onOpen} style={{ textAlign: "left" }} title="Abrir">
            {r.clientName}
          </button>
          <span className="pc-org__meta" title={r.title}>
            {r.title}
            {r.orgId && (
              <>
                {" · "}
                <button type="button" className="pc-th" style={{ color: "var(--accent-text)" }} onClick={() => onOpenOrg(r.orgId!)}>
                  {r.orgSlug ?? "empresa"}
                </button>
              </>
            )}
            {r.crm && (
              <span title={`CRM propio: ${r.crm.title} · ${r.crm.pipelineName} › ${r.crm.stageName}`}>
                {" · "}CRM: {r.crm.discarded ? "descartada" : r.crm.stageName}
              </span>
            )}
          </span>
        </div>
      </td>
      <td>
        <span className={`pc-badge is-${STAGE_TONE[r.stage]}`}>{STAGE_LABEL[r.stage]}</span>
      </td>
      <td>
        <span className={`pc-badge is-${BAND_TONE[r.complexityBand]}`} title={r.riskFlags.map((f) => RISK_LABEL[f]).join(" · ") || "Sin señales de riesgo"}>
          {BAND_LABEL[r.complexityBand]} · {r.complexityScore}
        </span>
        {r.riskFlags.length > 0 && <small> · {r.riskFlags.length} {r.riskFlags.length === 1 ? "riesgo" : "riesgos"}</small>}
      </td>
      <td className="num">
        {q ? (
          <span className={q.belowMinimum ? "pc-danger" : undefined} title={q.belowMinimum ? "Por debajo del mínimo recomendado" : undefined}>
            {fmtMoney(q.proposedPriceCents, cur)}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="num">{q ? fmtMoney(q.minimumPriceCents, cur) : "—"}</td>
      <td>{q?.validUntil ? date(q.validUntil) : "—"}</td>
      <td className="pc-muted">{r.ownerEmail}</td>
      <td title={r.updatedAt}>{relative(r.updatedAt)}</td>
    </tr>
  );
}

// ── Ficha ───────────────────────────────────────────────────────

type DetailTab = "diagnosis" | "estimate" | "proposal" | "client" | "actuals" | "versions";

function AssessmentDetail({
  id,
  quoteId,
  onBack,
  onPickQuote,
  onOpenOrg,
}: {
  id: string;
  quoteId: string | null;
  onBack: () => void;
  onPickQuote: (quoteId: string) => void;
  onOpenOrg: (id: string) => void;
}) {
  const qc = useQueryClient();
  const a = useQuery({ queryKey: ["platform", "impl", id], queryFn: () => fetchImplementation(id) });
  const settings = useQuery({ queryKey: ["platform", "impl", "settings"], queryFn: fetchPricingSettings, staleTime: 60_000 });
  const selectedId = quoteId ?? a.data?.quotes[0]?.id ?? null;
  const q = useQuery({ queryKey: ["platform", "impl", "quote", selectedId], queryFn: () => fetchImplementationQuote(selectedId!), enabled: !!selectedId });
  const [tab, setTab] = useState<DetailTab | null>(null);
  const hasQuote = (a.data?.quotes.length ?? 0) > 0;

  // Al abrir: si ya hay cotización se entra por la estimación; si no, por el diagnóstico.
  useEffect(() => {
    if (tab === null && a.data) setTab(a.data.quotes.length > 0 ? "estimate" : "diagnosis");
  }, [a.data, tab]);

  const createQuote = useMutation({
    mutationFn: () => createImplementationQuote(id),
    onSuccess: (quote) => {
      qc.setQueryData(["platform", "impl", "quote", quote.id], quote);
      void qc.invalidateQueries({ queryKey: ["platform", "impl"] });
      onPickQuote(quote.id);
      setTab("estimate");
      toast.success(`Cotización ${quote.number} abierta en borrador`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => archiveImplementation(id, archived),
    onSuccess: (next) => {
      qc.setQueryData(["platform", "impl", id], next);
      void qc.invalidateQueries({ queryKey: ["platform", "impl"] });
      toast.success(next.archivedAt ? "Diagnóstico archivado" : "Diagnóstico restaurado");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const d = a.data;
  const current: DetailTab = tab ?? "diagnosis";
  const accepted = q.data?.status === "ACCEPTED";

  return (
    <>
      <Crumbs onBack={onBack} title={d ? `${d.quoteNumber ? `${d.quoteNumber} · ` : ""}${d.clientName}` : "Cargando…"} />
      {a.isError && <p style={{ color: "var(--danger)" }}>{(a.error as Error).message}</p>}
      {d && (
        <>
          <section className="pc-panel" data-assessment-head>
            <div className="pc-head-row">
              <div>
                <h2 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {d.title}
                  <span className={`pc-badge is-${STAGE_TONE[d.stage]}`} data-stage={d.stage}>
                    {STAGE_LABEL[d.stage]}
                  </span>
                  {d.archivedAt && <span className="pc-badge is-muted">archivado</span>}
                </h2>
                <span className="pc-org__meta">
                  {d.clientName}
                  {d.clientContact && ` · ${d.clientContact}`}
                  {d.sector && ` · ${d.sector}`}
                  {d.orgId ? (
                    <>
                      {" · "}
                      <button type="button" className="pc-th" style={{ color: "var(--accent-text)" }} onClick={() => onOpenOrg(d.orgId!)}>
                        {d.orgName ?? d.orgSlug}
                      </button>
                    </>
                  ) : (
                    " · prospecto sin cuenta"
                  )}
                  {` · ${d.ownerEmail} · creado el ${date(d.createdAt)}`}
                </span>
              </div>
              <div className="pc-actions">
                <span className={`pc-badge is-${BAND_TONE[d.complexityBand]}`} title="Complejidad orientativa">
                  Complejidad {BAND_LABEL[d.complexityBand].toLowerCase()} · {d.complexityScore}
                </span>
                {!hasQuote && (
                  <button type="button" className="btn btn-primary btn-sm" disabled={createQuote.isPending} onClick={() => createQuote.mutate()} data-create-quote>
                    {createQuote.isPending ? "Abriendo…" : "Abrir cotización"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={archive.isPending}
                  data-archive
                  onClick={() =>
                    void confirmDialog({
                      message: d.archivedAt ? "¿Restaurar este diagnóstico al listado?" : "¿Archivar este diagnóstico? Sale del listado; no se borra nada y se puede restaurar.",
                      confirmLabel: d.archivedAt ? "Restaurar" : "Archivar",
                    }).then((ok) => ok && archive.mutate(!d.archivedAt))
                  }
                >
                  {d.archivedAt ? "Restaurar" : "Archivar"}
                </button>
              </div>
            </div>
            {d.riskFlags.length > 0 && (
              <div className="pc-ref" style={{ marginTop: 8 }}>
                {d.riskFlags.map((f) => (
                  <span key={f} className="pc-warn">
                    {RISK_LABEL[f]}
                  </span>
                ))}
              </div>
            )}
            <CrmLinkBar
              a={d}
              crmReady={!!settings.data?.settings.crmOrgId}
              onChanged={(next) => {
                qc.setQueryData(["platform", "impl", id], next);
                void qc.invalidateQueries({ queryKey: ["platform", "impl", "list"] });
                void qc.invalidateQueries({ queryKey: ["platform", "audit"] });
              }}
            />
          </section>

          <div className="pc-tabs">
            <div className="seg" role="tablist" aria-label="Apartados">
              {(
                [
                  ["diagnosis", "1–2 · Diagnóstico", true],
                  ["estimate", "3 · Estimación", hasQuote],
                  ["proposal", "4 · Propuesta y aprobación", hasQuote],
                  ["client", "Vista del cliente", hasQuote],
                  ["actuals", "Real", accepted],
                  ["versions", `Versiones · ${d.quotes.length}`, true],
                ] as [DetailTab, string, boolean][]
              ).map(([k, label, enabled]) => (
                <button key={k} type="button" role="tab" aria-selected={current === k} disabled={!enabled} onClick={() => setTab(k)} data-detail-tab={k} title={k === "actuals" && !enabled ? "Las horas reales se registran sobre la versión aceptada" : undefined}>
                  {label}
                </button>
              ))}
            </div>
            {hasQuote && d.quotes.length > 1 && q.data && (
              <span className="pc-muted" style={{ fontSize: 12.5 }}>
                Viendo la versión {q.data.version}
                {d.quotes[0] && d.quotes[0].id !== q.data.id && (
                  <>
                    {" · "}
                    <button type="button" className="pc-th" style={{ color: "var(--accent-text)" }} onClick={() => onPickQuote(d.quotes[0]!.id)}>
                      ir a la última (v{d.quotes[0].version})
                    </button>
                  </>
                )}
              </span>
            )}
          </div>

          {current === "diagnosis" && <AssessmentForm key={d.updatedAt} initial={d} onSaved={() => void qc.invalidateQueries({ queryKey: ["platform", "impl", id] })} />}

          {(current === "estimate" || current === "proposal" || current === "client" || current === "actuals") &&
            (q.data ? (
              <QuoteEditor
                quote={q.data}
                assessment={d}
                settings={settings.data?.settings ?? DEFAULT_PRICING_SETTINGS}
                section={current as QuoteSection}
                onQuote={(quote) => {
                  qc.setQueryData(["platform", "impl", "quote", quote.id], quote);
                  if (quote.id !== selectedId) onPickQuote(quote.id);
                }}
              />
            ) : q.isError ? (
              <p style={{ color: "var(--danger)" }}>{(q.error as Error).message}</p>
            ) : (
              <div className="skeleton" style={{ height: 160 }} />
            ))}

          {current === "versions" && <Versions a={d} selectedId={selectedId} onPick={(qid) => (onPickQuote(qid), setTab("estimate"))} />}
        </>
      )}
      {!d && !a.isError && <div className="skeleton" style={{ height: 160 }} />}
    </>
  );
}

function Versions({ a, selectedId, onPick }: { a: ImplementationAssessment; selectedId: string | null; onPick: (quoteId: string) => void }) {
  return (
    <section className="pc-panel" data-versions>
      <div className="pc-panel__head">
        <h2>Versiones de {a.quoteNumber ?? "la cotización"}</h2>
        <span className="pc-muted" style={{ fontSize: 12.5 }}>Lo aprobado no se edita: cada cambio es una versión nueva, y la anterior queda tal cual.</span>
      </div>
      {a.quotes.length === 0 ? (
        <p className="pc-empty">Todavía sin cotización.</p>
      ) : (
        <table className="pc-table is-compact">
          <thead>
            <tr>
              <th>Versión</th>
              <th>Estado</th>
              <th className="num">Propuesto</th>
              <th className="num">Mínimo</th>
              <th>Vigencia</th>
              <th>Aprobada</th>
              <th>Enviada</th>
              <th>Aceptada</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {a.quotes.map((v) => (
              <tr key={v.id} data-version-row={v.version}>
                <td>
                  <b>v{v.version}</b>
                  {v.id === selectedId && <small> · abierta</small>}
                </td>
                <td>
                  <span className={`pc-badge is-${STATUS_TONE[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                </td>
                <td className="num">
                  <span className={v.belowMinimum ? "pc-danger" : undefined}>{fmtMoney(v.proposedPriceCents, v.currency)}</span>
                </td>
                <td className="num">{fmtMoney(v.minimumPriceCents, v.currency)}</td>
                <td>{v.validUntil ? date(v.validUntil) : "—"}</td>
                <td>{v.approvedAt ? date(v.approvedAt) : "—"}</td>
                <td>{v.sentAt ? date(v.sentAt) : "—"}</td>
                <td>{v.acceptedAt ? date(v.acceptedAt) : "—"}</td>
                <td>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(v.id)}>
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
