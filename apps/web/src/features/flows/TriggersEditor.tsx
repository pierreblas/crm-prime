"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_FLOW_TRIGGERS, type FlowTrigger, type TagDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { TRIGGER_BY_TYPE, TRIGGER_GROUPS, TRIGGER_META, newTrigger } from "./flowShared";

/** Disparadores que no llevan nada que configurar: ponerlos dos veces no suma nada. */
const ONCE: FlowTrigger["type"][] = ["conversation_start", "ad_click", "conversation_closed", "lead_webhook", "missed_call", "no_reply"];

/**
 * Cuándo arranca el flujo: una lista de disparadores, cada uno con lo suyo
 * (palabras, etiquetas, etapas, formularios, horas). Arranca con el primero
 * que ocurra. Vive en el panel del bloque «Inicio».
 */
export function TriggersEditor({
  triggers,
  onChange,
  tags,
  stages,
}: {
  triggers: FlowTrigger[];
  onChange: (next: FlowTrigger[]) => void;
  tags: TagDto[];
  stages: { id: string; name: string }[];
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const patch = (id: string, p: Partial<FlowTrigger>) => onChange(triggers.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const used = new Set(triggers.map((t) => t.type));
  const full = triggers.length >= MAX_FLOW_TRIGGERS;

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <div className="ftr">
      <p className="ftr-intro">
        {triggers.length
          ? "El flujo arranca cuando ocurre cualquiera de estos disparadores."
          : "Sin disparadores, el flujo no arranca solo: lo ejecutan las automatizaciones de una etapa del embudo o el bloque «Ir a otro flujo» de otro flujo."}
      </p>

      {triggers.map((t) => {
        const meta = TRIGGER_BY_TYPE[t.type];
        return (
          <section key={t.id} className="ftr-card" aria-label={meta?.label ?? t.type}>
            <header className="ftr-card__head">
              <span className="ftr-card__icon">
                <NavIcon name={meta?.icon ?? "bolt"} size={14} />
              </span>
              <strong>{meta?.label ?? t.type}</strong>
              <button
                type="button"
                className="icon-btn ftr-card__x"
                aria-label={`Quitar «${meta?.label ?? t.type}»`}
                onClick={() => onChange(triggers.filter((x) => x.id !== t.id))}
              >
                <NavIcon name="x" size={13} />
              </button>
            </header>
            {meta?.hint && <p className="ftr-card__hint">{meta.hint}</p>}
            <TriggerFields trigger={t} tags={tags} stages={stages} onPatch={(p) => patch(t.id, p)} />
          </section>
        );
      })}

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
                {TRIGGER_META.filter((m) => m.group === g).map((m) => {
                  const taken = ONCE.includes(m.type) && used.has(m.type);
                  return (
                    <button
                      key={m.type}
                      type="button"
                      role="menuitem"
                      className="ftr-menu__item"
                      disabled={taken}
                      title={taken ? "Ya está en la lista" : m.hint}
                      onClick={() => {
                        onChange([...triggers, newTrigger(m.type)]);
                        setMenu(false);
                      }}
                    >
                      <NavIcon name={m.icon} size={14} />
                      <span>{m.label}</span>
                      {taken && <NavIcon name="check" size={12} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TriggerFields({
  trigger: t,
  tags,
  stages,
  onPatch,
}: {
  trigger: FlowTrigger;
  tags: TagDto[];
  stages: { id: string; name: string }[];
  onPatch: (p: Partial<FlowTrigger>) => void;
}) {
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
  if (needs === "tags")
    return (
      <Pills
        label="Solo con estas etiquetas"
        empty="Cualquier etiqueta"
        options={tags.map((x) => ({ value: x.name, label: x.name }))}
        value={t.config.tags}
        onChange={(v) => setConfig({ tags: v })}
      />
    );
  if (needs === "stages")
    return (
      <Pills
        label="Solo al entrar en estas etapas"
        empty="Cualquier etapa"
        options={stages.map((s) => ({ value: s.id, label: s.name }))}
        value={t.config.stageIds}
        onChange={(v) => setConfig({ stageIds: v })}
      />
    );
  return null;
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
