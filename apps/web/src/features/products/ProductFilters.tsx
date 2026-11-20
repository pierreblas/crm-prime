"use client";

import { useEffect, useState } from "react";
import {
  MANUAL_SOURCE,
  formatFieldValue,
  formatMoney,
  formatRange,
  isListFieldType,
  parseRange,
  type ProductFieldDto,
  type ProductListQuery,
  type ProductSourceDto,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { DebouncedInput } from "@/components/DebouncedInput";
import { FilterGroup } from "@/components/Filters";

type Update = (change: (q: ProductListQuery) => ProductListQuery) => void;

/** Pone o quita los valores de un campo en la consulta. */
function withField(q: ProductListQuery, key: string, values: string[]): ProductListQuery {
  const fields = { ...q.fields };
  const clean = values.map((v) => v.trim()).filter(Boolean);
  if (clean.length) fields[key] = clean;
  else delete fields[key];
  return { ...q, fields };
}

export const MANUAL_SOURCE_LABEL = "Creados a mano o importados";

// ── Panel de filtros ────────────────────────────────────────

export function ProductFiltersPanel({
  query,
  fields,
  sources,
  currencies,
  update,
}: {
  query: ProductListQuery;
  fields: ProductFieldDto[];
  sources: ProductSourceDto[];
  currencies: string[];
  update: Update;
}) {
  return (
    <div className="flt-panel flt-panel--wide prod-filters" data-product-filters>
      <FilterGroup label="Origen">
        <select
          className="field field-sm"
          value={query.source ?? ""}
          onChange={(e) => update((q) => ({ ...q, source: e.target.value || null }))}
          aria-label="Filtrar por origen"
        >
          <option value="">Cualquier origen</option>
          <option value={MANUAL_SOURCE}>{MANUAL_SOURCE_LABEL}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </FilterGroup>

      <PriceFilter query={query} currencies={currencies} update={update} />

      {fields.map((f) => (
        <FilterGroup key={f.id} label={f.unit && f.unit.toLowerCase() !== f.label.toLowerCase() ? `${f.label} (${f.unit})` : f.label}>
          <FieldFilter field={f} values={query.fields[f.key] ?? []} update={update} />
        </FilterGroup>
      ))}

      {fields.length === 0 && (
        <FilterGroup label="Tus campos">
          <span className="flt-hint">
            Cuando añadas campos (talla, color, duración…) en «Campos», podrás filtrar por ellos aquí.
          </span>
        </FilterGroup>
      )}
    </div>
  );
}

function PriceFilter({ query, currencies, update }: { query: ProductListQuery; currencies: string[]; update: Update }) {
  const several = currencies.length > 1;
  // La moneda solo se guarda en la URL con un rango puesto; mientras, se recuerda aquí.
  const [currency, setCurrency] = useState(query.currency ?? currencies[0] ?? "");
  useEffect(() => {
    if (query.currency) setCurrency(query.currency);
    else if (!currencies.includes(currency) && currencies[0]) setCurrency(currencies[0]);
  }, [query.currency, currencies, currency]);

  // Cada lado se combina con el otro tal como está en la URL en ese momento.
  const commit = (side: "min" | "max" | null, value: string | null, cur = currency) =>
    update((q) => {
      const min = side === "min" ? value : (q.price?.min ?? null);
      const max = side === "max" ? value : (q.price?.max ?? null);
      return { ...q, price: parseRange(formatRange(min, max)), currency: several ? cur || null : null };
    });

  return (
    <FilterGroup label="Precio">
      <div className="flt-range">
        <label>
          <span>Mín.</span>
          <DebouncedInput
            className="field field-sm"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={query.price?.min ?? ""}
            onCommit={(v) => commit("min", v || null)}
            aria-label="Precio mínimo"
          />
        </label>
        <label>
          <span>Máx.</span>
          <DebouncedInput
            className="field field-sm"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={query.price?.max ?? ""}
            onCommit={(v) => commit("max", v || null)}
            aria-label="Precio máximo"
          />
        </label>
        {several && (
          <label className="prod-filters__cur">
            <span>Moneda</span>
            <select
              className="field field-sm"
              value={currency}
              aria-label="Moneda del precio"
              onChange={(e) => {
                setCurrency(e.target.value);
                if (query.price) commit(null, null, e.target.value);
              }}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {several && <span className="flt-hint">Cuenta el precio base o el precio en esa moneda.</span>}
      <label className="flt-check">
        <input type="checkbox" checked={query.discount} onChange={(e) => update((q) => ({ ...q, discount: e.target.checked }))} data-filter-discount />
        <span>Con descuento</span>
      </label>
    </FilterGroup>
  );
}

function FieldFilter({ field: f, values, update }: { field: ProductFieldDto; values: string[]; update: Update }) {
  const set = (next: string[]) => update((q) => withField(q, f.key, next));

  if (isListFieldType(f.type) && f.options.length > 0) {
    return (
      <div className="flt-chips">
        {f.options.map((o) => {
          const on = values.some((v) => v.toLowerCase() === o.toLowerCase());
          return (
            <button
              key={o}
              type="button"
              className={`flt-chip${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => set(on ? values.filter((v) => v.toLowerCase() !== o.toLowerCase()) : [...values, o])}
            >
              {o}
            </button>
          );
        })}
      </div>
    );
  }

  if (f.type === "boolean") {
    const current = values[0] ?? "";
    return (
      <div className="flt-chips">
        {(
          [
            ["si", "Sí"],
            ["no", "No"],
          ] as const
        ).map(([v, text]) => (
          <button
            key={v}
            type="button"
            className={`flt-chip${current === v ? " is-on" : ""}`}
            aria-pressed={current === v}
            onClick={() => set(current === v ? [] : [v])}
          >
            {text}
          </button>
        ))}
      </div>
    );
  }

  if (f.type === "number" || f.type === "date" || f.type === "time") {
    const r = parseRange(values[0]);
    const type = f.type === "number" ? "number" : f.type;
    const commit = (side: "min" | "max", value: string | null) =>
      update((q) => {
        const cur = parseRange(q.fields[f.key]?.[0]);
        const v = side === "min" ? formatRange(value, cur?.max ?? null) : formatRange(cur?.min ?? null, value);
        return withField(q, f.key, v ? [v] : []);
      });
    const words = f.type === "number" ? (["Mín.", "Máx."] as const) : (["Desde", "Hasta"] as const);
    return (
      <div className="flt-range">
        <label>
          <span>{words[0]}</span>
          <DebouncedInput
            className="field field-sm"
            type={type}
            step={f.type === "number" ? "any" : undefined}
            inputMode={f.type === "number" ? "decimal" : undefined}
            value={r?.min ?? ""}
            onCommit={(v) => commit("min", v || null)}
            aria-label={`${f.label}: ${words[0].toLowerCase()}`}
          />
        </label>
        <label>
          <span>{words[1]}</span>
          <DebouncedInput
            className="field field-sm"
            type={type}
            step={f.type === "number" ? "any" : undefined}
            inputMode={f.type === "number" ? "decimal" : undefined}
            value={r?.max ?? ""}
            onCommit={(v) => commit("max", v || null)}
            aria-label={`${f.label}: ${words[1].toLowerCase()}`}
          />
        </label>
      </div>
    );
  }

  // Texto, enlace, texto largo o una lista sin opciones: «contiene».
  return (
    <DebouncedInput
      className="field field-sm"
      value={values[0] ?? ""}
      placeholder="Contiene…"
      onCommit={(v) => set(v ? [v] : [])}
      aria-label={`${f.label}: contiene`}
    />
  );
}

// ── Filtros puestos, como etiquetas que se quitan ───────────

function rangeText(min: string | null, max: string | null, fmt: (v: string) => string): string {
  if (min !== null && max !== null) return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  if (min !== null) return `desde ${fmt(min)}`;
  if (max !== null) return `hasta ${fmt(max)}`;
  return "";
}

export function ActiveProductFilters({
  query,
  fields,
  sources,
  update,
  onClearAll,
}: {
  query: ProductListQuery;
  fields: ProductFieldDto[];
  sources: ProductSourceDto[];
  update: Update;
  onClearAll: () => void;
}) {
  const chips: { key: string; text: string; remove: () => void }[] = [];

  if (query.source) {
    const name =
      query.source === MANUAL_SOURCE ? MANUAL_SOURCE_LABEL : (sources.find((s) => s.id === query.source)?.name ?? "Una conexión que ya no existe");
    chips.push({ key: "source", text: `Origen: ${name}`, remove: () => update((q) => ({ ...q, source: null })) });
  }
  if (query.price) {
    const cur = query.currency;
    const fmt = (v: string) => (cur ? formatMoney(Number(v), cur) : v);
    chips.push({
      key: "price",
      text: `Precio: ${rangeText(query.price.min, query.price.max, fmt)}`,
      remove: () => update((q) => ({ ...q, price: null, currency: null })),
    });
  }
  if (query.discount) chips.push({ key: "discount", text: "Con descuento", remove: () => update((q) => ({ ...q, discount: false })) });
  for (const [key, values] of Object.entries(query.fields)) {
    const f = fields.find((x) => x.key === key);
    const label = f?.label ?? key;
    let text: string;
    if (!f || (!isListFieldType(f.type) && !["boolean", "number", "date", "time"].includes(f.type)) || (isListFieldType(f.type) && f.options.length === 0)) {
      text = `${label}: contiene «${values[0]}»`;
    } else if (isListFieldType(f.type)) {
      text = `${label}: ${values.join(", ")}`;
    } else if (f.type === "boolean") {
      text = `${label}: ${values[0] === "si" ? "Sí" : "No"}`;
    } else {
      const r = parseRange(values[0]);
      text = `${label}: ${r ? rangeText(r.min, r.max, (v) => formatFieldValue(f, v)) : values[0]}`;
    }
    chips.push({ key: `f.${key}`, text, remove: () => update((q) => withField(q, key, [])) });
  }

  if (chips.length === 0) return null;
  return (
    <div className="prod-active" aria-label="Filtros puestos" data-active-filters>
      {chips.map((c) => (
        <button key={c.key} type="button" className="prod-active__chip" onClick={c.remove} title="Quitar este filtro">
          <span>{c.text}</span>
          <NavIcon name="x" size={11} />
        </button>
      ))}
      <button type="button" className="prod-active__clear" onClick={onClearAll}>
        Limpiar todo
      </button>
    </div>
  );
}
