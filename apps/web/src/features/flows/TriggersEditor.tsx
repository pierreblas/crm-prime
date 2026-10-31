"use client";

import { useEffect, useRef, useState } from "react";
import {
  DELAYABLE_TRIGGERS,
  MAX_FLOW_TRIGGERS,
  weekday,
  type BusinessHours,
  type FlowRule,
  type FlowTrigger,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { RuleRow, newRule, type RuleLookups } from "./RuleRow";
import { DAY_LABEL, TRIGGER_BY_TYPE, TRIGGER_GROUPS, TRIGGER_META, minutesLabel, newTrigger } from "./flowShared";

const DELAYS = [0, 5, 10, 30, 60, 1440];
const COOLDOWNS = [5, 10, 60, 1440];

/** Atajos de «Añadir condición»: lo que más se filtra en un disparador. */
const QUICK_RULES: { label: string; rule: () => FlowRule }[] = [
  { label: "Tiene la etiqueta", rule: () => newRule("tag", "is") },
  { label: "No tiene la etiqueta", rule: () => newRule("tag", "is_not") },
  { label: "Está en la etapa", rule: () => newRule("stage", "is") },
  { label: "Responsable", rule: () => newRule("deal_owner", "is") },
  { label: "Valor de la oportunidad", rule: () => newRule("deal_value", "gt") },
  { label: "Fuente", rule: () => newRule("source", "is") },
  { label: "UTM", rule: () => ({ ...newRule("utm", "equals"), key: "utm_campaign" }) },
  { label: "Otra condición…", rule: () => newRule("contact_field", "equals") },
];

/**
 * Cuándo arranca el flujo: una lista de disparadores. Cada uno es un evento
 * (con su filtro: palabras, etiquetas, etapas…) y, como en Kommo, puede
 * llevar dentro condiciones que también tienen que cumplirse, una espera y un
 * horario activo. El flujo arranca con el primero que se cumpla entero.
 */
export function TriggersEditor({
  triggers,
  onChange,
  lookups,
}: {
  triggers: FlowTrigger[];
  onChange: (next: FlowTrigger[]) => void;
  lookups: RuleLookups;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const patch = (id: string, p: Partial<FlowTrigger>) => onChange(triggers.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const full = triggers.length >= MAX_FLOW_TRIGGERS;
  useDismiss(menu, menuRef, () => setMenu(false));

  return (
    <div className="ftr">
      <p className="ftr-intro">
        {triggers.length
          ? "El flujo arranca con el primero de estos disparadores que se cumpla entero: su evento, sus condiciones y su horario."
          : "Sin disparadores, el flujo no arranca solo: lo ejecutan las automatizaciones de una etapa del embudo o el bloque «Ir a otro flujo» de otro flujo."}
      </p>

      {triggers.map((t) => (
        <TriggerCard key={t.id} trigger={t} lookups={lookups} onPatch={(p) => patch(t.id, p)} onRemove={() => onChange(triggers.filter((x) => x.id !== t.id))} />
      ))}

      <div className="ftr-add" ref={menuRef}>
        <button type="button" className="btn btn-soft btn-sm" disabled={full} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
          <NavIcon name="plus" size={14} />
          Añadir disparador
        </button>
        {full && <span className="ftr-muted">Como mucho {MAX_FLOW_TRIGGERS}.</span>}
        {menu && (
          <div className="ftr-menu" role="menu">
            {TRIGGER_GROUPS.map((g) => (
              <div key={g} className="ftr-menu__group">
                <div className="ftr-menu__title">{g}</div>
                {TRIGGER_META.filter((m) => m.group === g).map((m) => (
                  <button
                    key={m.type}
                    type="button"
                    role="menuitem"
                    className="ftr-menu__item"
                    title={m.hint}
                    onClick={() => {
                      onChange([...triggers, newTrigger(m.type)]);
                      setMenu(false);
                    }}
                  >
                    <NavIcon name={m.icon} size={14} />
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TriggerCard({
  trigger: t,
  lookups,
  onPatch,
  onRemove,
}: {
  trigger: FlowTrigger;
  lookups: RuleLookups;
  onPatch: (p: Partial<FlowTrigger>) => void;
  onRemove: () => void;
}) {
  const meta = TRIGGER_BY_TYPE[t.type];
  const [quick, setQuick] = useState(false);
  const quickRef = useRef<HTMLDivElement | null>(null);
  useDismiss(quick, quickRef, () => setQuick(false));
  const delayable = (DELAYABLE_TRIGGERS as readonly string[]).includes(t.type);
  const rules = t.conditions.rules;
  const setRules = (next: FlowRule[]) => onPatch({ conditions: { ...t.conditions, rules: next } });

  return (
    <section className="ftr-card" aria-label={meta?.label ?? t.type}>
      <header className="ftr-card__head">
        <span className="ftr-card__icon">
          <NavIcon name={meta?.icon ?? "bolt"} size={14} />
        </span>
        <strong>{meta?.label ?? t.type}</strong>
        <button type="button" className="icon-btn ftr-card__x" aria-label={`Quitar «${meta?.label ?? t.type}»`} onClick={onRemove}>
          <NavIcon name="x" size={13} />
        </button>
      </header>
      {meta?.hint && <p className="ftr-card__hint">{meta.hint}</p>}

      <EventFields trigger={t} lookups={lookups} onPatch={onPatch} />

      {delayable && (
        <MinutesSelect
          label="Cuándo"
          value={t.delayMin}
          options={DELAYS}
          zeroLabel="Al momento"
          prefix="A los"
          onChange={(delayMin) => onPatch({ delayMin })}
          hint={t.delayMin > 0 ? "Al vencer se comprueba otra vez que sigue valiendo (misma etapa, misma etiqueta) y sus condiciones." : undefined}
        />
      )}

      <div className="ftr-section">
        <div className="ftr-section__head">
          <span className="label" style={{ margin: 0 }}>
            Condiciones
          </span>
          {rules.length > 1 && (
            <div className="seg seg-sm" role="radiogroup" aria-label="Cómo se combinan">
              <button type="button" role="radio" aria-selected={t.conditions.match === "all"} onClick={() => onPatch({ conditions: { ...t.conditions, match: "all" } })}>
                Todas
              </button>
              <button type="button" role="radio" aria-selected={t.conditions.match === "any"} onClick={() => onPatch({ conditions: { ...t.conditions, match: "any" } })}>
                Alguna
              </button>
            </div>
          )}
        </div>
        {rules.length === 0 && <span className="ftr-muted">Ninguna: arranca con cualquiera.</span>}
        {rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            lookups={lookups}
            onChange={(p) => setRules(rules.map((x) => (x.id === r.id ? { ...x, ...p } : x)))}
            onRemove={() => setRules(rules.filter((x) => x.id !== r.id))}
          />
        ))}
        {rules.length < 10 && (
          <div className="ftr-add" ref={quickRef}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuick((q) => !q)} aria-expanded={quick}>
              <NavIcon name="plus" size={13} />
              Añadir condición
            </button>
            {quick && (
              <div className="ftr-menu ftr-menu--sm" role="menu">
                {QUICK_RULES.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    role="menuitem"
                    className="ftr-menu__item"
                    onClick={() => {
                      setRules([...rules, q.rule()]);
                      setQuick(false);
                    }}
                  >
                    <span>{q.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ActiveHours value={t.activeHours} onChange={(activeHours) => onPatch({ activeHours })} />
    </section>
  );
}

/** Lo propio de cada evento: palabras, etiquetas, etapas, formularios, horas, pausa. */
function EventFields({ trigger: t, lookups, onPatch }: { trigger: FlowTrigger; lookups: RuleLookups; onPatch: (p: Partial<FlowTrigger>) => void }) {
  const needs = TRIGGER_BY_TYPE[t.type]?.needs ?? null;
  const setConfig = (p: Partial<FlowTrigger["config"]>) => onPatch({ config: { ...t.config, ...p } });

  if (needs === "keywords") return <ListInput label="Palabras (separadas por comas)" placeholder="hola, info, precio" value={t.keywords} onChange={(keywords) => onPatch({ keywords })} />;
  if (needs === "forms")
    return <ListInput label="Solo estos formularios (vacío = cualquiera)" placeholder="Formulario de verano" value={t.config.forms} onChange={(forms) => setConfig({ forms })} />;
  if (needs === "hours")
    return (
      <label className="ftr-inline">
        Tras
        <input
          type="number"
          className="field field-sm"
          min={1}
          max={720}
          value={t.config.hours}
          onChange={(e) => setConfig({ hours: Math.max(1, Math.min(720, Number(e.target.value) || 24)) })}
        />
        horas sin respuesta del cliente
      </label>
    );
  if (needs === "cooldown")
    return (
      <MinutesSelect
        label="Como mucho una vez cada"
        value={t.config.cooldownMin}
        options={COOLDOWNS}
        onChange={(cooldownMin) => setConfig({ cooldownMin: Math.max(1, cooldownMin) })}
      />
    );
  if (needs === "tags")
    return (
      <Pills
        label="Solo con estas etiquetas"
        empty="Cualquier etiqueta"
        options={lookups.tags.map((x) => ({ value: x.name, label: x.name }))}
        value={t.config.tags}
        onChange={(v) => setConfig({ tags: v })}
      />
    );
  if (needs === "stages")
    return (
      <Pills
        label="Solo al entrar en estas etapas"
        empty="Cualquier etapa"
        options={lookups.stages.map((s) => ({ value: s.id, label: s.name }))}
        value={t.config.stageIds}
        onChange={(v) => setConfig({ stageIds: v })}
      />
    );
  return null;
}

/** Minutos con atajos («5 min», «1 día») y «Otro…» para un valor propio. */
function MinutesSelect({
  label,
  value,
  options,
  onChange,
  zeroLabel,
  prefix,
  hint,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  zeroLabel?: string;
  prefix?: string;
  hint?: string;
}) {
  const custom = !options.includes(value);
  const [other, setOther] = useState(custom);
  const text = (m: number) => (m === 0 && zeroLabel ? zeroLabel : `${prefix ? `${prefix} ` : ""}${minutesLabel(m)}`);
  return (
    <div className="ftr-field">
      <span className="label">{label}</span>
      <div className="ftr-inline">
        <select
          className="field field-sm"
          style={{ width: "auto" }}
          value={other || custom ? "other" : String(value)}
          onChange={(e) => {
            if (e.target.value === "other") return setOther(true);
            setOther(false);
            onChange(Number(e.target.value));
          }}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {text(m)}
            </option>
          ))}
          <option value="other">Otro…</option>
        </select>
        {(other || custom) && (
          <>
            <input
              type="number"
              className="field field-sm"
              min={1}
              max={43200}
              value={value || ""}
              onChange={(e) => onChange(Math.max(0, Math.min(43200, Math.round(Number(e.target.value) || 0))))}
              aria-label="Minutos"
            />
            min
          </>
        )}
      </div>
      {hint && <p className="ftr-card__hint" style={{ marginTop: 5 }}>{hint}</p>}
    </div>
  );
}

/** «Solo en este horario»: fuera de él, el disparador no arranca nada. */
function ActiveHours({ value, onChange }: { value: BusinessHours | null; onChange: (v: BusinessHours | null) => void }) {
  const on = !!value;
  const setDay = (d: (typeof weekday)[number], range: { from: string; to: string } | null) =>
    value && onChange({ ...value, days: { ...value.days, [d]: range } });
  return (
    <div className="ftr-section">
      <label className="ftr-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? {
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima",
                    days: Object.fromEntries(weekday.map((d) => [d, d === "sat" || d === "sun" ? null : { from: "09:00", to: "18:00" }])) as BusinessHours["days"],
                  }
                : null,
            )
          }
        />
        Solo en un horario
      </label>
      {value && (
        <div className="ftr-hours">
          <input
            className="field field-sm"
            value={value.timezone}
            onChange={(e) => onChange({ ...value, timezone: e.target.value })}
            aria-label="Zona horaria"
            placeholder="America/Lima"
          />
          {weekday.map((d) => {
            const r = value.days?.[d] ?? null;
            return (
              <div key={d} className="ftr-hours__row">
                <label className="ftr-check">
                  <input type="checkbox" checked={!!r} onChange={(e) => setDay(d, e.target.checked ? { from: "09:00", to: "18:00" } : null)} />
                  {DAY_LABEL[d]}
                </label>
                <input className="field field-sm" type="time" value={r?.from ?? ""} disabled={!r} onChange={(e) => r && setDay(d, { ...r, from: e.target.value })} aria-label={`${DAY_LABEL[d]}: desde`} />
                <span aria-hidden>a</span>
                <input className="field field-sm" type="time" value={r?.to ?? ""} disabled={!r} onChange={(e) => r && setDay(d, { ...r, to: e.target.value })} aria-label={`${DAY_LABEL[d]}: hasta`} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Lista separada por comas; se guarda al escribir sin perder la coma a medio teclear. */
function ListInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => {
    // Desde fuera (deshacer, cargar): se refleja si no coincide con lo escrito.
    if (text.split(",").map((x) => x.trim()).filter(Boolean).join("|") !== value.join("|")) setText(value.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="ftr-field">
      <span className="label">{label}</span>
      <input
        className="field field-sm"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean));
        }}
      />
    </label>
  );
}

function Pills({
  label,
  empty,
  options,
  value,
  onChange,
}: {
  label: string;
  empty: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="ftr-field ftr-pills">
      <legend className="label">
        {label} {value.length === 0 && <span className="ftr-muted">· {empty.toLowerCase()}</span>}
      </legend>
      <div className="ftr-pills__list">
        {options.length === 0 && <span className="ftr-muted">No hay ninguna creada todavía.</span>}
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <label key={o.value} className={`ftr-pill${on ? " is-on" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])} />
              {on && <NavIcon name="check" size={11} />}
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Cierra un menú al pulsar fuera o con Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}
