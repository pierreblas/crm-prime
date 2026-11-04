"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AI_BILLING_MODES,
  PLANS,
  PLAN_KEYS,
  QUOTE_CURRENCIES,
  QUOTE_ITEM_CATEGORIES,
  amountToCents,
  bpToPercent,
  computePricing,
  percentToBp,
  type ImplementationActualInput,
  type ImplementationAssessment,
  type ImplementationQuote,
  type PricingResultDto,
  type PricingSettings,
  type QuoteAction,
  type QuoteItemCategory,
  type QuotePublicView,
  type UpdateQuoteInput,
} from "@crm/shared";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { actOnImplementationQuote, addImplementationActual, removeImplementationActual, updateImplementationQuote } from "@/lib/bff";
import { date, fromDateInput, toDateInput } from "../platformFormat";
import { ACTION_LABEL, AI_MODE_LABEL, AI_MODE_NOTE, ALERT_LABEL, CATEGORY_LABEL, RISK_LABEL, STATUS_LABEL, STATUS_TONE, fmtHours, fmtMoney, fmtPct } from "./labels";

export type QuoteSection = "estimate" | "proposal" | "client" | "actuals";

interface ItemDraft {
  key: string;
  category: QuoteItemCategory;
  description: string;
  hours: string;
  hourly: string;
  third: string;
  other: string;
}

interface Draft {
  currency: ImplementationQuote["currency"];
  planKey: string;
  aiBillingMode: ImplementationQuote["aiBillingMode"];
  overheads: string;
  contingency: string;
  margin: string;
  rounding: string;
  proposed: string;
  diagnosisFee: string;
  diagnosisCredited: boolean;
  deliverables: string;
  assumptions: string;
  exclusions: string;
  clientRequirements: string;
  timelineNote: string;
  paymentTerms: string;
  externalCostsNote: string;
  taxNote: string;
  supportNote: string;
  validUntil: string | null;
  items: ItemDraft[];
}

let seq = 0;
const nextKey = () => `k${++seq}`;
const amount = (cents: number | null) => (cents === null ? "" : String(cents / 100));
const pct = (bp: number) => String(bpToPercent(bp));

function fromQuote(q: ImplementationQuote): Draft {
  return {
    currency: q.currency,
    planKey: q.planKey ?? "",
    aiBillingMode: q.aiBillingMode,
    overheads: amount(q.overheadsCents),
    contingency: pct(q.contingencyBp),
    margin: pct(q.targetMarginBp),
    rounding: amount(q.roundingCents),
    proposed: amount(q.proposedPriceCents),
    diagnosisFee: amount(q.diagnosisFeeCents),
    diagnosisCredited: q.diagnosisCredited,
    deliverables: q.deliverables,
    assumptions: q.assumptions,
    exclusions: q.exclusions,
    clientRequirements: q.clientRequirements,
    timelineNote: q.timelineNote,
    paymentTerms: q.paymentTerms,
    externalCostsNote: q.externalCostsNote,
    taxNote: q.taxNote,
    supportNote: q.supportNote,
    validUntil: q.validUntil,
    items: q.items.map((it) => ({
      key: nextKey(),
      category: it.category,
      description: it.description,
      hours: String(it.hours),
      hourly: amount(it.hourlyCostCents),
      third: amount(it.thirdPartyCents),
      other: amount(it.otherCents),
    })),
  };
}

const num = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Lo escrito → lo que va a la API. Devuelve los errores en palabras. */
function parseDraft(d: Draft): { input: UpdateQuoteInput; errors: string[] } {
  const errors: string[] = [];
  const cents = (s: string, label: string, required = false): number | null => {
    const c = amountToCents(s);
    if (c === null) {
      if (required || s.trim() !== "") errors.push(`${label}: importe no válido`);
      return null;
    }
    if (c < 0) errors.push(`${label}: no puede ser negativo`);
    return c;
  };
  const items = d.items.map((it, i) => {
    const hours = num(it.hours) ?? (it.hours.trim() === "" ? 0 : NaN);
    if (!Number.isFinite(hours) || hours < 0) errors.push(`Partida ${i + 1}: horas no válidas`);
    if (!it.description.trim()) errors.push(`Partida ${i + 1}: falta la descripción`);
    return {
      category: it.category,
      description: it.description.trim(),
      hours: Number.isFinite(hours) ? Math.round(hours * 100) / 100 : 0,
      hourlyCostCents: cents(it.hourly, `Partida ${i + 1}, costo por hora`) ?? 0,
      thirdPartyCents: cents(it.third, `Partida ${i + 1}, terceros`) ?? 0,
      otherCents: cents(it.other, `Partida ${i + 1}, otros`) ?? 0,
    };
  });
  const contingency = num(d.contingency);
  const margin = num(d.margin);
  if (contingency === null || contingency < 0) errors.push("Contingencia: porcentaje no válido");
  if (margin === null || margin < 0 || margin >= 99) errors.push("Margen objetivo: entre 0 y 99 %");
  const rounding = cents(d.rounding, "Redondeo", true) ?? 1;
  return {
    errors,
    input: {
      currency: d.currency,
      planKey: d.planKey === "" ? null : (d.planKey as UpdateQuoteInput["planKey"]),
      aiBillingMode: d.aiBillingMode,
      overheadsCents: cents(d.overheads, "Gastos de entrega") ?? 0,
      contingencyBp: percentToBp(contingency ?? 0),
      targetMarginBp: percentToBp(margin ?? 0),
      roundingCents: Math.max(1, rounding),
      proposedPriceCents: cents(d.proposed, "Precio propuesto"),
      diagnosisFeeCents: cents(d.diagnosisFee, "Diagnóstico pagado"),
      diagnosisCredited: d.diagnosisCredited,
      deliverables: d.deliverables,
      assumptions: d.assumptions,
      exclusions: d.exclusions,
      clientRequirements: d.clientRequirements,
      timelineNote: d.timelineNote,
      paymentTerms: d.paymentTerms,
      externalCostsNote: d.externalCostsNote,
      taxNote: d.taxNote,
      supportNote: d.supportNote,
      validUntil: d.validUntil,
      items,
    },
  };
}

/**
 * Pasos 3 y 4 del cotizador: la estimación con partidas y el motor en vivo, y
 * la propuesta con sus condiciones y el cambio de estado. En borrador se edita
 * y se guarda; después solo se lee, y cambiar algo es abrir una versión nueva.
 * Sobre la versión aceptada se registran las horas y costos reales.
 */
export function QuoteEditor({
  quote,
  assessment,
  settings,
  section,
  onQuote,
}: {
  quote: ImplementationQuote;
  assessment: ImplementationAssessment;
  settings: PricingSettings;
  section: QuoteSection;
  onQuote: (q: ImplementationQuote) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => fromQuote(quote));
  const [pending, setPending] = useState<{ action: QuoteAction; text: string } | null>(null);
  const editable = quote.editable;

  // Al cambiar de versión, o cuando la API devuelve la cotización guardada, se parte de ella.
  useEffect(() => {
    setDraft(fromQuote(quote));
    setPending(null);
  }, [quote.id, quote.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => parseDraft(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(parseDraft(fromQuote(quote)).input) !== JSON.stringify(parsed.input), [quote, parsed]);

  const live: { pricing: PricingResultDto | null; error: string | null } = useMemo(() => {
    if (!editable) return { pricing: quote.pricing, error: null };
    try {
      const i = parsed.input;
      return {
        pricing: computePricing({
          items: i.items ?? [],
          overheadsCents: i.overheadsCents ?? 0,
          contingencyBp: i.contingencyBp ?? 0,
          targetMarginBp: i.targetMarginBp ?? 0,
          roundingCents: i.roundingCents ?? 1,
          proposedPriceCents: i.proposedPriceCents ?? null,
        }),
        error: null,
      };
    } catch (e) {
      return { pricing: null, error: (e as Error).message };
    }
  }, [editable, parsed, quote.pricing]);

  const refresh = (q: ImplementationQuote) => {
    onQuote(q);
    void qc.invalidateQueries({ queryKey: ["platform", "impl"] });
  };

  const save = useMutation({
    mutationFn: () => updateImplementationQuote(quote.id, parsed.input),
    onSuccess: (q) => {
      refresh(q);
      toast.success("Cotización guardada");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const act = useMutation({
    mutationFn: async ({ action, text }: { action: QuoteAction; text?: string }) => {
      if (editable && dirty) await updateImplementationQuote(quote.id, parsed.input);
      const body = action === "send" ? { note: text } : { reason: text };
      return actOnImplementationQuote(quote.id, action, text ? body : {});
    },
    onSuccess: (q, v) => {
      refresh(q);
      setPending(null);
      toast.success(v.action === "revise" ? `Versión ${q.version} abierta en borrador` : STATUS_LABEL[q.status]);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pricing = live.pricing;
  const needsReason = (a: QuoteAction) => a === "reject" || (a === "approve" && !!pricing?.belowMinimum);

  const start = async (action: QuoteAction) => {
    if (action === "cancel") {
      const ok = await confirmDialog({ message: "¿Cancelar esta versión? No se podrá retomar; si hace falta, se abre una versión nueva.", danger: true, confirmLabel: "Cancelar cotización" });
      if (ok) act.mutate({ action });
      return;
    }
    if (action === "revise") {
      const ok = await confirmDialog({
        message: `Se abre la versión ${quote.version + 1} en borrador con todo copiado. ${quote.status === "ACCEPTED" ? "La versión aceptada se conserva como contrato." : "Esta versión queda como reemplazada."}`,
        confirmLabel: "Abrir versión nueva",
      });
      if (ok) act.mutate({ action });
      return;
    }
    if (action === "accept") {
      const ok = await confirmDialog({ message: `¿Registrar que el cliente aceptó ${quote.number} v${quote.version} por ${fmtMoney(quote.proposedPriceCents, quote.currency)}?`, confirmLabel: "Sí, aceptada" });
      if (ok) act.mutate({ action });
      return;
    }
    if (needsReason(action) || action === "send") {
      setPending({ action, text: "" });
      return;
    }
    act.mutate({ action });
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setItem = (key: string, patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));
  const addItems = (rows: Array<{ category: QuoteItemCategory; description: string; hours: number; hourlyCostCents: number }>) =>
    setDraft((d) => ({
      ...d,
      items: [...d.items, ...rows.map((r) => ({ key: nextKey(), category: r.category, description: r.description, hours: String(r.hours), hourly: amount(r.hourlyCostCents), third: "", other: "" }))],
    }));

  return (
    <>
      {/* Cabecera: estado, acciones y guardado. Igual en todos los apartados. */}
      <section className="pc-panel" data-quote-head>
        <div className="pc-head-row">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {quote.number} <span className="pc-muted" style={{ fontWeight: 500 }}>versión {quote.version}</span>
              <span className={`pc-badge is-${STATUS_TONE[quote.status]}`} data-quote-status={quote.status}>
                {STATUS_LABEL[quote.status]}
              </span>
              {quote.exceptionReason && (
                <span className="pc-danger" title={quote.exceptionReason}>
                  aprobada bajo mínimo
                </span>
              )}
            </h2>
            <span className="pc-org__meta">
              {quote.createdBy} · creada el {date(quote.createdAt)}
              {quote.approvedAt && ` · aprobada el ${date(quote.approvedAt)} por ${quote.approvedBy}`}
              {quote.sentAt && ` · enviada el ${date(quote.sentAt)}`}
              {quote.acceptedAt && ` · aceptada el ${date(quote.acceptedAt)}`}
              {quote.rejectedAt && ` · rechazada el ${date(quote.rejectedAt)}`}
              {quote.validUntil && ` · vigente hasta el ${date(quote.validUntil)}`}
            </span>
          </div>
          <div className="pc-actions" data-quote-actions>
            {editable && (
              <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || parsed.errors.length > 0 || save.isPending} onClick={() => save.mutate()} data-save-quote title={parsed.errors[0]}>
                {save.isPending ? "Guardando…" : dirty ? "Guardar borrador" : "Guardado"}
              </button>
            )}
            {quote.actions.map((a) => (
              <button
                key={a}
                type="button"
                className={`btn btn-sm ${a === "approve" || a === "submit" ? "btn-primary" : a === "cancel" || a === "reject" ? "btn-danger" : "btn-ghost"}`}
                disabled={act.isPending || (a === "submit" && parsed.errors.length > 0)}
                onClick={() => void start(a)}
                data-quote-action={a}
              >
                {ACTION_LABEL[a]}
              </button>
            ))}
          </div>
        </div>

        {pending && (
          <div className="pc-action-box" data-action-box={pending.action}>
            <span style={{ fontSize: 13 }}>
              {pending.action === "approve" && (
                <>
                  <b style={{ color: "var(--warning)" }}>Precio por debajo del mínimo recomendado</b> ({fmtMoney(pricing?.proposedPriceCents ?? null, draft.currency)} frente a {fmtMoney(pricing?.minimumPriceCents ?? null, draft.currency)}). Aprobarlo es una excepción: escribe el motivo, queda en el diario con tu correo.
                </>
              )}
              {pending.action === "reject" && "¿Por qué la rechazó el cliente? Sirve para ajustar las próximas estimaciones."}
              {pending.action === "send" && "¿Por dónde se envió? (opcional: correo, WhatsApp, reunión…)"}
            </span>
            <textarea className="pc-notes" style={{ minHeight: 60 }} value={pending.text} maxLength={2000} onChange={(e) => setPending({ ...pending, text: e.target.value })} aria-label="Motivo" autoFocus />
            <div className="pc-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>
                Volver
              </button>
              <button
                type="button"
                className={`btn btn-sm ${pending.action === "reject" ? "btn-danger" : "btn-primary"}`}
                disabled={act.isPending || (needsReason(pending.action) && pending.text.trim().length < 5)}
                onClick={() => act.mutate({ action: pending.action, text: pending.text.trim() || undefined })}
                data-confirm-action
              >
                {ACTION_LABEL[pending.action]}
              </button>
            </div>
          </div>
        )}

        {parsed.errors.length > 0 && (
          <ul className="pc-alerts-list" data-draft-errors>
            {parsed.errors.map((e) => (
              <li key={e}>
                <span className="pc-danger">corrige</span> {e}
              </li>
            ))}
          </ul>
        )}
      </section>

      {section === "estimate" && (
        <Estimate
          draft={draft}
          editable={editable}
          pricing={pricing}
          liveError={live.error}
          assessment={assessment}
          settings={settings}
          set={set}
          setItem={setItem}
          addItems={addItems}
          removeItem={(key) => set("items", draft.items.filter((it) => it.key !== key))}
        />
      )}
      {section === "proposal" && <Proposal draft={draft} editable={editable} quote={quote} set={set} />}
      {section === "client" && <ClientView quote={quote} dirty={dirty && editable} />}
      {section === "actuals" && <Actuals quote={quote} settings={settings} onQuote={refresh} />}
    </>
  );
}

// ── Paso 3: estimación ─────────────────────────────────────────

function Estimate({
  draft,
  editable,
  pricing,
  liveError,
  assessment,
  settings,
  set,
  setItem,
  addItems,
  removeItem,
}: {
  draft: Draft;
  editable: boolean;
  pricing: PricingResultDto | null;
  liveError: string | null;
  assessment: ImplementationAssessment;
  settings: PricingSettings;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  setItem: (key: string, patch: Partial<ItemDraft>) => void;
  addItems: (rows: Array<{ category: QuoteItemCategory; description: string; hours: number; hourlyCostCents: number }>) => void;
  removeItem: (key: string) => void;
}) {
  const cur = draft.currency;
  const subtotal = (it: ItemDraft) => {
    const h = num(it.hours) ?? 0;
    const hourly = amountToCents(it.hourly) ?? 0;
    return Math.round(h * hourly) + (amountToCents(it.third) ?? 0) + (amountToCents(it.other) ?? 0);
  };
  const rateOf = (key: string | null) => settings.rates.find((r) => r.key === key)?.hourlyCostCents ?? settings.hourlyCostCents;
  /** La tarifa cuyo costo coincide con lo escrito; "" si es un valor a mano. */
  const rateFor = (it: ItemDraft) => settings.rates.find((r) => r.hourlyCostCents === amountToCents(it.hourly))?.key ?? "";
  const applyTemplate = (key: string) => {
    const t = settings.templates.find((x) => x.key === key);
    if (!t) return;
    addItems(t.items.map((i) => ({ category: i.category, description: i.description, hours: i.hours, hourlyCostCents: rateOf(i.rateKey) })));
  };

  return (
    <>
      <section className="pc-panel pc-items" data-quote-items>
        <div className="pc-panel__head">
          <h2>Partidas de esfuerzo</h2>
          <span className="pc-muted" style={{ fontSize: 12.5 }}>Horas × costo interno por hora, más costos de terceros y otros directos de cada partida. Importes en {cur}.</span>
        </div>
        <div className="pc-table-wrap">
          <table className="pc-table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Descripción</th>
                <th className="num">Horas</th>
                <th>Tarifa</th>
                <th className="num">Costo/h</th>
                <th className="num">Terceros</th>
                <th className="num">Otros</th>
                <th className="num">Subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.items.map((it, i) => (
                <tr key={it.key} data-quote-item={i}>
                  <td style={{ width: 150 }}>
                    <select className="pc-select" value={it.category} disabled={!editable} onChange={(e) => setItem(it.key, { category: e.target.value as QuoteItemCategory })} aria-label={`Categoría ${i + 1}`}>
                      {QUOTE_ITEM_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="pc-input" value={it.description} maxLength={300} disabled={!editable} onChange={(e) => setItem(it.key, { description: e.target.value })} aria-label={`Descripción ${i + 1}`} />
                  </td>
                  <td className="num n">
                    <input className="pc-input" inputMode="decimal" value={it.hours} disabled={!editable} onChange={(e) => setItem(it.key, { hours: e.target.value })} aria-label={`Horas ${i + 1}`} />
                  </td>
                  <td style={{ width: 150 }}>
                    <select className="pc-select" value={rateFor(it)} disabled={!editable} onChange={(e) => e.target.value && setItem(it.key, { hourly: amount(rateOf(e.target.value)) })} aria-label={`Tarifa ${i + 1}`}>
                      <option value="">A mano</option>
                      {settings.rates.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num n">
                    <input className="pc-input" inputMode="decimal" value={it.hourly} disabled={!editable} onChange={(e) => setItem(it.key, { hourly: e.target.value })} aria-label={`Costo por hora ${i + 1}`} />
                  </td>
                  <td className="num n">
                    <input className="pc-input" inputMode="decimal" value={it.third} placeholder="0" disabled={!editable} onChange={(e) => setItem(it.key, { third: e.target.value })} aria-label={`Terceros ${i + 1}`} />
                  </td>
                  <td className="num n">
                    <input className="pc-input" inputMode="decimal" value={it.other} placeholder="0" disabled={!editable} onChange={(e) => setItem(it.key, { other: e.target.value })} aria-label={`Otros ${i + 1}`} />
                  </td>
                  <td className="num">{fmtMoney(subtotal(it), cur)}</td>
                  <td>
                    {editable && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeItem(it.key)} aria-label={`Quitar partida ${i + 1}`}>
                        Quitar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {draft.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="pc-muted" style={{ textAlign: "center", padding: 18 }}>
                    Sin partidas todavía. Añade una o parte de una plantilla.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="pc-actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addItems([{ category: "CONFIGURATION", description: "", hours: 1, hourlyCostCents: settings.hourlyCostCents }])} data-add-item>
              + Partida
            </button>
            {settings.templates.length > 0 && (
              <>
                <span className="pc-muted" style={{ fontSize: 12 }}>Plantillas:</span>
                <span className="pc-ref">
                  {settings.templates.map((t) => (
                    <button key={t.key} type="button" className="pc-chip" onClick={() => applyTemplate(t.key)} title={`${t.description || t.name} · ${t.items.reduce((a, i) => a + i.hours, 0)} h en ${t.items.length} partidas`} data-template-chip={t.key}>
                      + {t.name}
                    </button>
                  ))}
                </span>
              </>
            )}
          </div>
        )}
      </section>

      <div className="pc-grid2">
        <section className="pc-panel" data-quote-params>
          <div className="pc-panel__head">
            <h2>Parámetros</h2>
          </div>
          <div className="pc-form">
            <label>
              Gastos de entrega ({cur})
              <input className="pc-input" inputMode="decimal" value={draft.overheads} placeholder="0" disabled={!editable} onChange={(e) => set("overheads", e.target.value)} aria-label="Gastos de entrega" />
            </label>
            <label>
              Contingencia (%)
              <input className="pc-input" inputMode="decimal" value={draft.contingency} disabled={!editable} onChange={(e) => set("contingency", e.target.value)} aria-label="Contingencia" />
            </label>
            <label>
              Margen bruto objetivo (%)
              <input className="pc-input" inputMode="decimal" value={draft.margin} disabled={!editable} onChange={(e) => set("margin", e.target.value)} aria-label="Margen objetivo" />
            </label>
            <label title="El mínimo se redondea hacia arriba a este múltiplo. Nunca baja.">
              Redondeo del mínimo ({cur})
              <input className="pc-input" inputMode="decimal" value={draft.rounding} disabled={!editable} onChange={(e) => set("rounding", e.target.value)} aria-label="Redondeo" />
            </label>
            <label className="full">
              Precio propuesto al cliente ({cur}) · pago único por la implementación
              <input className="pc-input" inputMode="decimal" value={draft.proposed} placeholder="Sin fijar" disabled={!editable} onChange={(e) => set("proposed", e.target.value)} aria-label="Precio propuesto" style={{ fontSize: 16, fontWeight: 600 }} />
            </label>
          </div>
          {settings.referenceOffers.length > 0 && (
            <p className="pc-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
              Ofertas de referencia internas («desde»):{" "}
              {settings.referenceOffers.map((o, i) => (
                <span key={o.key}>
                  {i > 0 && " · "}
                  {o.name} {fmtMoney(o.fromCents, settings.currency)}
                </span>
              ))}
              . Son hipótesis de trabajo, no precios públicos.
            </p>
          )}
        </section>

        <section className="pc-panel" data-quote-result>
          <div className="pc-panel__head">
            <h2>Resultado</h2>
            {pricing && <span className="pc-muted" style={{ fontSize: 12.5 }}>{fmtHours(pricing.totalHours)} estimadas</span>}
          </div>
          {liveError && <p style={{ color: "var(--danger)", margin: 0 }}>{liveError}</p>}
          {pricing && (
            <>
              <div className="pc-summary">
                <div>
                  <span>Costo laboral</span>
                  <b>{fmtMoney(pricing.laborCents, cur)}</b>
                </div>
                <div>
                  <span>Externos y entrega</span>
                  <b>{fmtMoney(pricing.externalCents, cur)}</b>
                </div>
                <div>
                  <span>Contingencia</span>
                  <b>{fmtMoney(pricing.contingencyCents, cur)}</b>
                </div>
                <div>
                  <span>Costo presupuestado</span>
                  <b>{fmtMoney(pricing.budgetedCostCents, cur)}</b>
                </div>
                <div className="is-key" title={`Sin redondear: ${fmtMoney(pricing.minimumRawCents, cur)}`}>
                  <span>Mínimo recomendado</span>
                  <b data-minimum>{fmtMoney(pricing.minimumPriceCents, cur)}</b>
                </div>
                <div className={pricing.belowMinimum ? "is-bad" : undefined}>
                  <span>Precio propuesto</span>
                  <b data-proposed>{fmtMoney(pricing.proposedPriceCents, cur)}</b>
                </div>
                <div className={pricing.expectedMarginBp !== null && pricing.expectedMarginBp < percentToBp(num(draft.margin) ?? 0) ? "is-bad" : undefined}>
                  <span>Margen esperado</span>
                  <b data-margin>{fmtPct(pricing.expectedMarginBp)}</b>
                </div>
                <div>
                  <span>Contribución esperada</span>
                  <b>{fmtMoney(pricing.expectedContributionCents, cur)}</b>
                </div>
              </div>
              <ul className="pc-alerts-list" data-pricing-alerts>
                {pricing.alerts.map((a) => (
                  <li key={a}>
                    <span className={a === "below_minimum" || a === "negative_contribution" ? "pc-danger" : "pc-warn"}>{a === "below_minimum" ? "bajo mínimo" : "aviso"}</span>
                    {ALERT_LABEL[a]}
                  </li>
                ))}
                {assessment.riskFlags.map((r) => (
                  <li key={r}>
                    <span className="pc-warn">riesgo</span>
                    {RISK_LABEL[r]}
                  </li>
                ))}
                {pricing.alerts.length === 0 && assessment.riskFlags.length === 0 && (
                  <li>
                    <span className="pc-ok">✓</span> Sin avisos: el precio cubre el mínimo con el margen objetivo.
                  </li>
                )}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}

// ── Paso 4: propuesta ──────────────────────────────────────────

function Proposal({ draft, editable, quote, set }: { draft: Draft; editable: boolean; quote: ImplementationQuote; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void }) {
  const planPrice = draft.planKey ? (PLANS[draft.planKey as (typeof PLAN_KEYS)[number]]?.priceUsd ?? 0) : null;
  return (
    <>
      <section className="pc-panel" data-quote-terms>
        <div className="pc-panel__head">
          <h2>Lo que se cobra, por separado</h2>
          <span className="pc-muted" style={{ fontSize: 12.5 }}>Implementación (pago único), mensualidad del plan, IA, cargos de Meta y soporte nunca se mezclan en una sola cifra.</span>
        </div>
        <div className="pc-form">
          <label>
            Moneda
            <select className="pc-input" value={draft.currency} disabled={!editable} onChange={(e) => set("currency", e.target.value as Draft["currency"])} aria-label="Moneda">
              {QUOTE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label title="Mensualidad aparte. Se guarda el precio del momento; cambiar el catálogo público no altera esta cotización.">
            Plan mensual del SaaS
            <select className="pc-input" value={draft.planKey} disabled={!editable} onChange={(e) => set("planKey", e.target.value)} aria-label="Plan mensual">
              <option value="">Sin plan en la propuesta</option>
              {PLAN_KEYS.map((k) => (
                <option key={k} value={k}>
                  {PLANS[k].name} · USD {PLANS[k].priceUsd ?? 0}/mes
                </option>
              ))}
            </select>
            {draft.planKey && !editable && quote.planPriceCentsSnapshot !== null && (
              <span className="pc-muted" style={{ fontSize: 11.5 }}>Congelado al cotizar: USD {(quote.planPriceCentsSnapshot / 100).toFixed(2)}/mes{planPrice !== null && Math.round(planPrice * 100) !== quote.planPriceCentsSnapshot ? ` (hoy USD ${planPrice})` : ""}</span>
            )}
          </label>
          <label>
            Inteligencia artificial
            <select className="pc-input" value={draft.aiBillingMode} disabled={!editable} onChange={(e) => set("aiBillingMode", e.target.value as Draft["aiBillingMode"])} aria-label="Modo de IA">
              {AI_BILLING_MODES.map((m) => (
                <option key={m} value={m}>
                  {AI_MODE_LABEL[m]}
                </option>
              ))}
            </select>
            <span className="pc-muted" style={{ fontSize: 11.5 }}>{AI_MODE_NOTE[draft.aiBillingMode]}</span>
          </label>
          <label>
            Diagnóstico pagado ({draft.currency})
            <input className="pc-input" inputMode="decimal" value={draft.diagnosisFee} placeholder="sin diagnóstico de pago" disabled={!editable} onChange={(e) => set("diagnosisFee", e.target.value)} aria-label="Diagnóstico pagado" />
            <label className="pc-check" style={{ color: "var(--text)" }}>
              <input type="checkbox" checked={draft.diagnosisCredited} disabled={!editable} onChange={(e) => set("diagnosisCredited", e.target.checked)} />
              Acreditarlo en esta implementación (una sola vez, como línea de descuento)
            </label>
          </label>
          <label>
            Vigencia de la propuesta
            <input type="date" className="pc-input" key={draft.validUntil ?? "none"} defaultValue={toDateInput(draft.validUntil)} disabled={!editable} onChange={(e) => set("validUntil", fromDateInput(e.target.value))} aria-label="Vigencia" />
          </label>
          <label>
            Plazo orientativo
            <input className="pc-input" value={draft.timelineNote} maxLength={1000} placeholder="2–3 semanas desde el acceso a las cuentas (no es garantía)" disabled={!editable} onChange={(e) => set("timelineNote", e.target.value)} aria-label="Plazo" />
          </label>
          <label className="full">
            Condiciones de pago
            <input className="pc-input" value={draft.paymentTerms} maxLength={2000} disabled={!editable} onChange={(e) => set("paymentTerms", e.target.value)} aria-label="Condiciones de pago" />
          </label>
          <label className="full">
            Cargos de terceros (Meta/WhatsApp y otros)
            <input className="pc-input" value={draft.externalCostsNote} maxLength={2000} placeholder="Las conversaciones de WhatsApp las cobra Meta según país y tipo de mensaje; no están incluidas." disabled={!editable} onChange={(e) => set("externalCostsNote", e.target.value)} aria-label="Cargos de terceros" />
          </label>
          <label>
            Impuestos
            <input className="pc-input" value={draft.taxNote} maxLength={500} placeholder="Precios sin IGV / incluyen IGV" disabled={!editable} onChange={(e) => set("taxNote", e.target.value)} aria-label="Impuestos" />
          </label>
          <label>
            Soporte posterior (opcional)
            <input className="pc-input" value={draft.supportNote} maxLength={2000} placeholder="30 días de acompañamiento incluidos; después, bolsa de horas aparte." disabled={!editable} onChange={(e) => set("supportNote", e.target.value)} aria-label="Soporte" />
          </label>
        </div>
      </section>

      <section className="pc-panel" data-quote-texts>
        <div className="pc-panel__head">
          <h2>Alcance de la propuesta</h2>
          <span className="pc-muted" style={{ fontSize: 12.5 }}>Esto sí lo lee el cliente. Sin costos internos, sin promesas de IA ilimitada.</span>
        </div>
        <div className="pc-form">
          <label className="full">
            Entregables
            <textarea className="pc-notes" value={draft.deliverables} maxLength={6000} disabled={!editable} onChange={(e) => set("deliverables", e.target.value)} placeholder="Uno por línea: número conectado, agente configurado con la base de conocimiento, embudo con 4 etapas…" aria-label="Entregables" />
          </label>
          <label>
            Supuestos
            <textarea className="pc-notes" value={draft.assumptions} maxLength={6000} disabled={!editable} onChange={(e) => set("assumptions", e.target.value)} placeholder="El cliente tiene acceso de administrador a su Meta Business…" aria-label="Supuestos" />
          </label>
          <label>
            Exclusiones
            <textarea className="pc-notes" value={draft.exclusions} maxLength={6000} disabled={!editable} onChange={(e) => set("exclusions", e.target.value)} placeholder="No incluye migración del CRM anterior ni integraciones no listadas…" aria-label="Exclusiones" />
          </label>
          <label className="full">
            Lo que necesitamos del cliente
            <textarea className="pc-notes" value={draft.clientRequirements} maxLength={4000} disabled={!editable} onChange={(e) => set("clientRequirements", e.target.value)} placeholder="Accesos, catálogo de productos, horarios, responsable de aprobar respuestas…" aria-label="Requisitos del cliente" />
          </label>
        </div>
      </section>
    </>
  );
}

// ── Vista del cliente ──────────────────────────────────────────

/** Solo lo público. La hoja imprimible (/platform/propuesta/:id) parte del mismo objeto. */
function ClientView({ quote, dirty }: { quote: ImplementationQuote; dirty: boolean }) {
  const view: QuotePublicView = quote.publicView;
  const deliverable = quote.status === "APPROVED" || quote.status === "SENT" || quote.status === "ACCEPTED";
  return (
    <section className="pc-panel" data-client-view>
      <div className="pc-panel__head">
        <h2>Así lo ve el cliente</h2>
        <div className="pc-actions">
          <span className="pc-muted" style={{ fontSize: 12.5 }}>
            {dirty ? "Hay cambios sin guardar: esta vista es la última guardada." : "Sin horas, costos internos, márgenes ni mínimos."}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => window.open(`/platform/propuesta/${encodeURIComponent(quote.id)}`, "_blank", "noopener")}
            title={deliverable ? "Abre la hoja para imprimir o guardar como PDF" : "Sin aprobar, la hoja sale con marca de borrador"}
            data-open-print
          >
            Imprimir / PDF
          </button>
        </div>
      </div>
      <div className="pc-doc">
        <p className="pc-muted" style={{ fontSize: 12 }}>
          Propuesta {view.number} · versión {view.version}
          {view.validUntil ? ` · válida hasta el ${date(view.validUntil)}` : ""}
        </p>
        <h3 style={{ marginTop: 4 }}>{view.title}</h3>
        <p>
          Para <b>{view.clientName}</b>
        </p>
        {view.objective && (
          <>
            <h3>Objetivo</h3>
            <p>{view.objective}</p>
          </>
        )}
        <h3>Qué incluye</h3>
        {view.deliverables ? <p>{view.deliverables}</p> : null}
        {view.lines.length > 0 && (
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            {view.lines.map((l, i) => (
              <li key={i}>
                <span className="pc-muted">{CATEGORY_LABEL[l.category]} · </span>
                {l.description}
              </li>
            ))}
          </ul>
        )}
        {view.exclusions && (
          <>
            <h3>Qué no incluye</h3>
            <p>{view.exclusions}</p>
          </>
        )}
        {view.assumptions && (
          <>
            <h3>Supuestos</h3>
            <p>{view.assumptions}</p>
          </>
        )}
        {view.clientRequirements && (
          <>
            <h3>Lo que necesitamos de ustedes</h3>
            <p>{view.clientRequirements}</p>
          </>
        )}
        {view.timelineNote && (
          <>
            <h3>Plazo orientativo</h3>
            <p>{view.timelineNote}</p>
          </>
        )}

        <h3>Inversión</h3>
        <table>
          <tbody>
            <tr>
              <td>Implementación (pago único)</td>
              <td className="num">{fmtMoney(view.implementationPriceCents, view.currency)}</td>
            </tr>
            {view.diagnosisCreditCents !== null && (
              <tr>
                <td>Descuento: diagnóstico ya pagado</td>
                <td className="num">− {fmtMoney(view.diagnosisCreditCents, view.currency)}</td>
              </tr>
            )}
            <tr>
              <td>
                <b>Total de la implementación</b>
              </td>
              <td className="num">
                <b data-client-total>{fmtMoney(view.totalDueCents, view.currency)}</b>
              </td>
            </tr>
            <tr>
              <td>Plan mensual de Driony (aparte)</td>
              <td className="num">{view.plan ? `${view.plan.name} · USD ${(view.plan.monthlyCents / 100).toFixed(0)}/mes` : "Por definir"}</td>
            </tr>
            <tr>
              <td>Inteligencia artificial</td>
              <td className="num">{AI_MODE_LABEL[view.aiBillingMode]}</td>
            </tr>
          </tbody>
        </table>
        <p className="pc-muted" style={{ fontSize: 12.5, marginTop: 8 }}>{AI_MODE_NOTE[view.aiBillingMode]}</p>
        {view.externalCostsNote && <p className="pc-muted" style={{ fontSize: 12.5 }}>{view.externalCostsNote}</p>}
        {view.taxNote && <p className="pc-muted" style={{ fontSize: 12.5 }}>{view.taxNote}</p>}
        {view.supportNote && (
          <>
            <h3>Soporte</h3>
            <p>{view.supportNote}</p>
          </>
        )}
        <h3>Condiciones</h3>
        <p>{view.paymentTerms || "—"}</p>
        <p className="pc-muted" style={{ fontSize: 12.5 }}>
          Cualquier cambio de alcance se cotiza como una versión nueva de esta propuesta.{view.validUntil ? ` Vigente hasta el ${date(view.validUntil)}.` : ""}
        </p>
      </div>
    </section>
  );
}

// ── Horas y costos reales ──────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

function Actuals({ quote, settings, onQuote }: { quote: ImplementationQuote; settings: PricingSettings; onQuote: (q: ImplementationQuote) => void }) {
  const cur = quote.currency;
  const [form, setForm] = useState({ category: "CONFIGURATION" as QuoteItemCategory, description: "", hours: "", hourly: amount(settings.hourlyCostCents), cost: "", workedOn: today(), note: "" });
  const add = useMutation({
    mutationFn: (input: ImplementationActualInput) => addImplementationActual(quote.id, input),
    onSuccess: (q) => {
      onQuote(q);
      setForm((f) => ({ ...f, description: "", hours: "", cost: "", note: "" }));
      toast.success("Registrado");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (actualId: string) => removeImplementationActual(quote.id, actualId),
    onSuccess: onQuote,
    onError: (e) => toast.error((e as Error).message),
  });
  const s = quote.actualsSummary;
  const hours = num(form.hours);
  const hourly = amountToCents(form.hourly);
  const cost = form.cost.trim() === "" ? 0 : amountToCents(form.cost);
  const valid = quote.status === "ACCEPTED" && form.description.trim().length > 0 && hours !== null && hours >= 0 && hourly !== null && hourly >= 0 && cost !== null && cost >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.workedOn);
  const deviation = (real: number, budget: number) => (budget > 0 ? `${real > budget ? "+" : ""}${Math.round(((real - budget) / budget) * 100)} %` : "—");

  return (
    <>
      <section className="pc-panel" data-actuals-summary>
        <div className="pc-panel__head">
          <h2>Presupuesto frente a real</h2>
          <span className="pc-muted" style={{ fontSize: 12.5 }}>
            {quote.status === "ACCEPTED" ? "Lo que se registra aquí nunca sale al cliente; sirve para afinar las próximas estimaciones." : "Las horas y costos reales se registran sobre la versión aceptada."}
          </span>
        </div>
        <div className="pc-summary">
          <div>
            <span>Horas presupuestadas</span>
            <b>{fmtHours(s.budgetedHours)}</b>
          </div>
          <div className={s.hours > s.budgetedHours ? "is-bad" : undefined}>
            <span>Horas reales</span>
            <b data-real-hours>
              {fmtHours(s.hours)} <small className="pc-muted">{deviation(s.hours, s.budgetedHours)}</small>
            </b>
          </div>
          <div>
            <span>Costo presupuestado</span>
            <b>{fmtMoney(s.budgetedCents, cur)}</b>
          </div>
          <div className={s.totalCents > s.budgetedCents ? "is-bad" : undefined}>
            <span>Costo real</span>
            <b data-real-cost>
              {fmtMoney(s.totalCents, cur)} <small className="pc-muted">{deviation(s.totalCents, s.budgetedCents)}</small>
            </b>
          </div>
          <div>
            <span>Margen esperado</span>
            <b>{fmtPct(quote.pricing.expectedMarginBp)}</b>
          </div>
          <div className={`is-key${s.realMarginBp !== null && s.realMarginBp < quote.targetMarginBp ? " is-bad" : ""}`}>
            <span>Margen real</span>
            <b data-real-margin>{fmtPct(s.realMarginBp)}</b>
          </div>
        </div>
      </section>

      <section className="pc-panel pc-items" data-actuals>
        <div className="pc-panel__head">
          <h2>Registros</h2>
          <span className="pc-muted" style={{ fontSize: 12.5 }}>Horas × costo interno por hora, más costos externos pagados de verdad.</span>
        </div>
        {quote.actuals.length === 0 ? (
          <p className="pc-empty">Nada registrado todavía.</p>
        ) : (
          <table className="pc-table is-compact">
            <thead>
              <tr>
                <th>Día</th>
                <th>Categoría</th>
                <th>Qué se hizo</th>
                <th className="num">Horas</th>
                <th className="num">Costo/h</th>
                <th className="num">Externos</th>
                <th className="num">Total</th>
                <th>Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {quote.actuals.map((a) => (
                <tr key={a.id} data-actual-row>
                  <td>{a.workedOn}</td>
                  <td>{CATEGORY_LABEL[a.category]}</td>
                  <td className="wrap">{a.description}</td>
                  <td className="num">{fmtHours(a.hours)}</td>
                  <td className="num">{fmtMoney(a.hourlyCostCents, cur)}</td>
                  <td className="num">{fmtMoney(a.costCents, cur)}</td>
                  <td className="num">{fmtMoney(Math.round(a.hours * a.hourlyCostCents) + a.costCents, cur)}</td>
                  <td className="wrap pc-muted" title={a.createdBy}>
                    {a.note || "—"}
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={remove.isPending} onClick={() => void confirmDialog({ message: "¿Quitar este registro?", danger: true }).then((ok) => ok && remove.mutate(a.id))}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {quote.status === "ACCEPTED" && (
          <form
            className="pc-form"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) add.mutate({ category: form.category, description: form.description.trim(), hours: Math.round((hours ?? 0) * 100) / 100, hourlyCostCents: hourly ?? 0, costCents: cost ?? 0, workedOn: form.workedOn, note: form.note.trim() });
            }}
            data-actual-form
          >
            <label>
              Día
              <input type="date" className="pc-input" value={form.workedOn} onChange={(e) => setForm({ ...form, workedOn: e.target.value })} aria-label="Día del trabajo" />
            </label>
            <label>
              Categoría
              <select className="pc-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as QuoteItemCategory })} aria-label="Categoría del registro">
                {QUOTE_ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ gridColumn: "span 2" }}>
              Qué se hizo
              <input className="pc-input" value={form.description} maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} aria-label="Qué se hizo" />
            </label>
            <label>
              Horas
              <input className="pc-input" inputMode="decimal" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} aria-label="Horas reales" />
            </label>
            <label>
              Costo/h ({cur})
              <input className="pc-input" inputMode="decimal" value={form.hourly} onChange={(e) => setForm({ ...form, hourly: e.target.value })} aria-label="Costo por hora real" />
            </label>
            <label>
              Costos externos ({cur})
              <input className="pc-input" inputMode="decimal" value={form.cost} placeholder="0" onChange={(e) => setForm({ ...form, cost: e.target.value })} aria-label="Costos externos reales" />
            </label>
            <label>
              Nota
              <input className="pc-input" value={form.note} maxLength={1000} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Nota del registro" />
            </label>
            <div className="full" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={!valid || add.isPending} data-add-actual>
                Registrar
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
