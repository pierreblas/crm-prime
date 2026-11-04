"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PRICING_SETTINGS,
  QUOTE_CURRENCIES,
  QUOTE_ITEM_CATEGORIES,
  amountToCents,
  bpToPercent,
  percentToBp,
  type PricingSettings,
  type PricingTemplate,
  type QuoteItemCategory,
} from "@crm/shared";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { fetchPricingSettings, updatePricingSettings } from "@/lib/bff";
import { dateTime } from "../platformFormat";
import { CATEGORY_LABEL, fmtMoney } from "./labels";

/** Importes en texto mientras se editan; se convierten al guardar. */
interface Draft {
  currency: PricingSettings["currency"];
  hourly: string;
  contingency: string;
  margin: string;
  rounding: string;
  validityDays: string;
  diagnosisFee: string;
  paymentTerms: string;
  rates: Array<{ key: string; name: string; hourly: string }>;
  templates: Array<{ key: string; name: string; description: string; items: Array<{ category: QuoteItemCategory; description: string; hours: string; rateKey: string }> }>;
  referenceOffers: Array<{ key: string; name: string; from: string }>;
}

const amount = (c: number | null) => (c === null ? "" : String(c / 100));
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || `k${Date.now().toString(36)}`;

function toDraft(s: PricingSettings): Draft {
  return {
    currency: s.currency,
    hourly: amount(s.hourlyCostCents),
    contingency: String(bpToPercent(s.contingencyBp)),
    margin: String(bpToPercent(s.targetMarginBp)),
    rounding: amount(s.roundingCents),
    validityDays: String(s.validityDays),
    diagnosisFee: amount(s.diagnosisFeeCents),
    paymentTerms: s.paymentTerms,
    rates: s.rates.map((r) => ({ key: r.key, name: r.name, hourly: amount(r.hourlyCostCents) })),
    templates: s.templates.map((t) => ({ key: t.key, name: t.name, description: t.description, items: t.items.map((i) => ({ category: i.category, description: i.description, hours: String(i.hours), rateKey: i.rateKey ?? "" })) })),
    referenceOffers: s.referenceOffers.map((o) => ({ key: o.key, name: o.name, from: amount(o.fromCents) })),
  };
}

function fromDraft(d: Draft): { settings: PricingSettings | null; errors: string[] } {
  const errors: string[] = [];
  const cents = (s: string, label: string): number => {
    const c = amountToCents(s);
    if (c === null || c < 0) {
      errors.push(`${label}: importe no válido`);
      return 0;
    }
    return c;
  };
  const num = (s: string, label: string, min: number, max: number): number => {
    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) {
      errors.push(`${label}: entre ${min} y ${max}`);
      return min;
    }
    return n;
  };
  const rateKeys = new Set(d.rates.map((r) => r.key));
  const settings: PricingSettings = {
    currency: d.currency,
    hourlyCostCents: cents(d.hourly, "Costo por hora"),
    contingencyBp: percentToBp(num(d.contingency, "Contingencia", 0, 100)),
    targetMarginBp: percentToBp(num(d.margin, "Margen objetivo", 0, 99)),
    roundingCents: Math.max(1, cents(d.rounding, "Redondeo")),
    validityDays: Math.round(num(d.validityDays, "Vigencia", 1, 365)),
    diagnosisFeeCents: d.diagnosisFee.trim() === "" ? null : cents(d.diagnosisFee, "Diagnóstico pagado"),
    paymentTerms: d.paymentTerms.trim(),
    rates: d.rates.map((r, i) => {
      if (!r.name.trim()) errors.push(`Tarifa ${i + 1}: falta el nombre`);
      return { key: r.key, name: r.name.trim(), hourlyCostCents: cents(r.hourly, `Tarifa ${r.name || i + 1}`) };
    }),
    templates: d.templates.map((t, i) => {
      if (!t.name.trim()) errors.push(`Plantilla ${i + 1}: falta el nombre`);
      return {
        key: t.key,
        name: t.name.trim(),
        description: t.description.trim(),
        items: t.items.map((it, j) => {
          if (!it.description.trim()) errors.push(`Plantilla ${t.name || i + 1}, partida ${j + 1}: falta la descripción`);
          if (it.rateKey && !rateKeys.has(it.rateKey)) errors.push(`Plantilla ${t.name || i + 1}, partida ${j + 1}: tarifa inexistente`);
          return { category: it.category, description: it.description.trim(), hours: num(it.hours, `Horas de «${it.description || j + 1}»`, 0, 10000), rateKey: it.rateKey || null };
        }),
      };
    }),
    referenceOffers: d.referenceOffers.map((o, i) => {
      if (!o.name.trim()) errors.push(`Oferta ${i + 1}: falta el nombre`);
      return { key: o.key, name: o.name.trim(), fromCents: cents(o.from, `Oferta ${o.name || i + 1}`) };
    }),
  };
  return { settings: errors.length ? null : settings, errors };
}

/**
 * Consola › Implementaciones › Ajustes: tarifas internas, plantillas y
 * referencias. Son hipótesis de trabajo del cotizador, no precios públicos; se
 * guardan en una fila JSON y cada cambio queda en el diario.
 */
export function PricingSettingsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["platform", "impl", "settings"], queryFn: fetchPricingSettings });
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (q.data) setDraft(toDraft(q.data.settings));
  }, [q.data]);

  const parsed = useMemo(() => (draft ? fromDraft(draft) : { settings: null, errors: [] }), [draft]);
  const dirty = useMemo(() => !!draft && !!q.data && JSON.stringify(parsed.settings) !== JSON.stringify(q.data.settings), [draft, q.data, parsed]);

  const save = useMutation({
    mutationFn: (s: PricingSettings) => updatePricingSettings(s),
    onSuccess: (dto) => {
      qc.setQueryData(["platform", "impl", "settings"], dto);
      void qc.invalidateQueries({ queryKey: ["platform", "audit"] });
      toast.success("Ajustes guardados");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isError) return <p style={{ color: "var(--danger)" }}>{(q.error as Error).message}</p>;
  if (!draft || !q.data) return <div className="skeleton" style={{ height: 160 }} />;
  const d = draft;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...d, [k]: v });

  return (
    <>
      <section className="pc-panel" data-settings-panel>
        <div className="pc-head-row">
          <div>
            <h2>Ajustes del cotizador</h2>
            <span className="pc-org__meta">
              {q.data.updatedAt ? `Guardados por ${q.data.updatedBy} el ${dateTime(q.data.updatedAt)}` : "Nunca guardados: valen los valores de código."} · Son hipótesis internas; no aparecen en la web pública ni en las propuestas.
            </span>
          </div>
          <div className="pc-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                void confirmDialog({ message: "¿Volver a los valores de código? Se pierde lo editado hasta que guardes.", confirmLabel: "Restablecer" }).then((ok) => ok && setDraft(toDraft(DEFAULT_PRICING_SETTINGS)))
              }
            >
              Valores de código
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || !parsed.settings || save.isPending} onClick={() => parsed.settings && save.mutate(parsed.settings)} data-save-settings title={parsed.errors[0]}>
              {save.isPending ? "Guardando…" : dirty ? "Guardar ajustes" : "Guardado"}
            </button>
          </div>
        </div>
        {parsed.errors.length > 0 && (
          <ul className="pc-alerts-list">
            {parsed.errors.map((e) => (
              <li key={e}>
                <span className="pc-danger">corrige</span> {e}
              </li>
            ))}
          </ul>
        )}
        <div className="pc-form" style={{ marginTop: 14 }}>
          <label>
            Moneda por defecto
            <select className="pc-input" value={d.currency} onChange={(e) => set("currency", e.target.value as Draft["currency"])} aria-label="Moneda por defecto">
              {QUOTE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Costo por hora por defecto ({d.currency})
            <input className="pc-input" inputMode="decimal" value={d.hourly} onChange={(e) => set("hourly", e.target.value)} aria-label="Costo por hora por defecto" />
          </label>
          <label>
            Contingencia (%)
            <input className="pc-input" inputMode="decimal" value={d.contingency} onChange={(e) => set("contingency", e.target.value)} aria-label="Contingencia por defecto" />
          </label>
          <label>
            Margen bruto objetivo (%)
            <input className="pc-input" inputMode="decimal" value={d.margin} onChange={(e) => set("margin", e.target.value)} aria-label="Margen por defecto" />
          </label>
          <label>
            Redondeo del mínimo ({d.currency})
            <input className="pc-input" inputMode="decimal" value={d.rounding} onChange={(e) => set("rounding", e.target.value)} aria-label="Redondeo por defecto" />
          </label>
          <label>
            Vigencia de la propuesta (días)
            <input className="pc-input" inputMode="numeric" value={d.validityDays} onChange={(e) => set("validityDays", e.target.value)} aria-label="Vigencia por defecto" />
          </label>
          <label>
            Diagnóstico pagado ({d.currency}, vacío = sin diagnóstico de pago)
            <input className="pc-input" inputMode="decimal" value={d.diagnosisFee} onChange={(e) => set("diagnosisFee", e.target.value)} aria-label="Diagnóstico pagado por defecto" />
          </label>
          <label className="full">
            Condiciones de pago por defecto
            <input className="pc-input" value={d.paymentTerms} maxLength={2000} onChange={(e) => set("paymentTerms", e.target.value)} aria-label="Condiciones de pago por defecto" />
          </label>
        </div>
      </section>

      <div className="pc-grid2">
        <section className="pc-panel" data-settings-rates>
          <div className="pc-panel__head">
            <h2>Tarifas internas por rol</h2>
            <span className="pc-muted" style={{ fontSize: 12.5 }}>Costo integral por hora, no el salario nominal.</span>
          </div>
          <table className="pc-table is-compact pc-items">
            <thead>
              <tr>
                <th>Rol</th>
                <th className="num">Costo/h ({d.currency})</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.rates.map((r, i) => (
                <tr key={r.key}>
                  <td>
                    <input className="pc-input" value={r.name} maxLength={80} onChange={(e) => set("rates", d.rates.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Tarifa ${i + 1}`} />
                  </td>
                  <td className="num n">
                    <input className="pc-input" inputMode="decimal" value={r.hourly} onChange={(e) => set("rates", d.rates.map((x, j) => (j === i ? { ...x, hourly: e.target.value } : x)))} aria-label={`Costo por hora de ${r.name}`} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("rates", d.rates.filter((_, j) => j !== i))}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.rates.length < 20 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => set("rates", [...d.rates, { key: slug(`rol-${d.rates.length + 1}-${Date.now().toString(36)}`), name: "", hourly: d.hourly }])}>
              + Tarifa
            </button>
          )}
        </section>

        <section className="pc-panel" data-settings-offers>
          <div className="pc-panel__head">
            <h2>Ofertas de referencia («desde»)</h2>
            <span className="pc-muted" style={{ fontSize: 12.5 }}>Orientan al comercial; no fijan el precio ni salen al cliente.</span>
          </div>
          <table className="pc-table is-compact pc-items">
            <thead>
              <tr>
                <th>Oferta</th>
                <th className="num">Desde ({d.currency})</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.referenceOffers.map((o, i) => (
                <tr key={o.key}>
                  <td>
                    <input className="pc-input" value={o.name} maxLength={80} onChange={(e) => set("referenceOffers", d.referenceOffers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Oferta ${i + 1}`} />
                  </td>
                  <td className="num n">
                    <input className="pc-input" inputMode="decimal" value={o.from} onChange={(e) => set("referenceOffers", d.referenceOffers.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} aria-label={`Desde de ${o.name}`} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("referenceOffers", d.referenceOffers.filter((_, j) => j !== i))}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.referenceOffers.length < 10 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => set("referenceOffers", [...d.referenceOffers, { key: slug(`oferta-${Date.now().toString(36)}`), name: "", from: "" }])}>
              + Oferta
            </button>
          )}
        </section>
      </div>

      <section className="pc-panel" data-settings-templates>
        <div className="pc-panel__head">
          <h2>Plantillas de partidas</h2>
          <span className="pc-muted" style={{ fontSize: 12.5 }}>Un clic en el estimador añade todas las partidas de la plantilla, valoradas con su tarifa. Luego se editan.</span>
        </div>
        {d.templates.map((t, ti) => (
          <TemplateEditor
            key={t.key}
            t={t}
            rates={d.rates}
            currency={d.currency}
            defaultHourly={d.hourly}
            onChange={(next) => set("templates", d.templates.map((x, j) => (j === ti ? next : x)))}
            onRemove={() => set("templates", d.templates.filter((_, j) => j !== ti))}
          />
        ))}
        {d.templates.length < 10 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("templates", [...d.templates, { key: slug(`plantilla-${Date.now().toString(36)}`), name: "", description: "", items: [] }])}>
            + Plantilla
          </button>
        )}
      </section>
    </>
  );
}

function TemplateEditor({
  t,
  rates,
  currency,
  defaultHourly,
  onChange,
  onRemove,
}: {
  t: Draft["templates"][number];
  rates: Draft["rates"];
  currency: string;
  defaultHourly: string;
  onChange: (t: Draft["templates"][number]) => void;
  onRemove: () => void;
}) {
  const hourlyOf = (rateKey: string) => amountToCents(rates.find((r) => r.key === rateKey)?.hourly ?? defaultHourly) ?? 0;
  const total = t.items.reduce((acc, it) => acc + Math.round((Number(it.hours.replace(",", ".")) || 0) * hourlyOf(it.rateKey)), 0);
  const hours = t.items.reduce((acc, it) => acc + (Number(it.hours.replace(",", ".")) || 0), 0);
  const setItem = (i: number, patch: Partial<Draft["templates"][number]["items"][number]>) => onChange({ ...t, items: t.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="pc-packs" data-template={t.key}>
      <div className="pc-form">
        <label>
          Nombre
          <input className="pc-input" value={t.name} maxLength={80} onChange={(e) => onChange({ ...t, name: e.target.value })} aria-label="Nombre de la plantilla" />
        </label>
        <label className="full" style={{ gridColumn: "span 2" }}>
          Descripción
          <input className="pc-input" value={t.description} maxLength={300} onChange={(e) => onChange({ ...t, description: e.target.value })} aria-label="Descripción de la plantilla" />
        </label>
      </div>
      <table className="pc-table is-compact pc-items" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Categoría</th>
            <th>Descripción</th>
            <th className="num">Horas</th>
            <th>Tarifa</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {t.items.map((it, i) => (
            <tr key={i}>
              <td style={{ width: 150 }}>
                <select className="pc-select" value={it.category} onChange={(e) => setItem(i, { category: e.target.value as QuoteItemCategory })} aria-label={`Categoría ${i + 1} de ${t.name}`}>
                  {QUOTE_ITEM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input className="pc-input" value={it.description} maxLength={300} onChange={(e) => setItem(i, { description: e.target.value })} aria-label={`Descripción ${i + 1} de ${t.name}`} />
              </td>
              <td className="num n">
                <input className="pc-input" inputMode="decimal" value={it.hours} onChange={(e) => setItem(i, { hours: e.target.value })} aria-label={`Horas ${i + 1} de ${t.name}`} />
              </td>
              <td style={{ width: 170 }}>
                <select className="pc-select" value={it.rateKey} onChange={(e) => setItem(i, { rateKey: e.target.value })} aria-label={`Tarifa ${i + 1} de ${t.name}`}>
                  <option value="">Por defecto</option>
                  {rates.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name || r.key}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...t, items: t.items.filter((_, j) => j !== i) })}>
                  Quitar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pc-actions" style={{ marginTop: 8, justifyContent: "space-between" }}>
        <span className="pc-muted" style={{ fontSize: 12.5 }}>
          {hours.toLocaleString("es")} h · costo laboral {fmtMoney(total, currency)}
        </span>
        <span className="pc-actions">
          {t.items.length < 40 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...t, items: [...t.items, { category: "CONFIGURATION", description: "", hours: "1", rateKey: "" }] })}>
              + Partida
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
            Quitar plantilla
          </button>
        </span>
      </div>
    </div>
  );
}

export type { PricingTemplate };
