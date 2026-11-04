"use client";

import { readableInk } from "@/lib/readable-ink";
import type { TagDto } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";
import { tagColor } from "@/features/contacts/TagEditor";

/**
 * Piezas de filtro que comparten la bandeja y el embudo: el rango de fechas
 * (con atajos) y el selector de etiquetas. La lógica de "¿esta fecha entra?"
 * vive aquí para que los dos sitios filtren exactamente igual.
 */

export type DatePreset = "" | "today" | "7d" | "30d" | "custom";
export type DateFilterValue = { preset: DatePreset; from: string; to: string };
export const EMPTY_DATE: DateFilterValue = { preset: "", from: "", to: "" };

/** Límites (ms) del filtro; null = sin límite por ese lado. */
export function dateBounds(v: DateFilterValue): { from: number | null; to: number | null } {
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  switch (v.preset) {
    case "today":
      return { from: dayStart(now), to: null };
    case "7d":
      return { from: dayStart(now) - 6 * 86_400_000, to: null };
    case "30d":
      return { from: dayStart(now) - 29 * 86_400_000, to: null };
    case "custom": {
      const from = v.from ? dayStart(new Date(v.from + "T00:00:00")) : null;
      // "Hasta" incluye el día entero.
      const to = v.to ? dayStart(new Date(v.to + "T00:00:00")) + 86_400_000 - 1 : null;
      return { from, to };
    }
    default:
      return { from: null, to: null };
  }
}

export function dateMatches(iso: string | null, v: DateFilterValue): boolean {
  const { from, to } = dateBounds(v);
  if (from === null && to === null) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return (from === null || t >= from) && (to === null || t <= to);
}

export function isDateActive(v: DateFilterValue): boolean {
  return v.preset !== "" && (v.preset !== "custom" || !!v.from || !!v.to);
}

export function DateFilter({
  value,
  onChange,
}: {
  value: DateFilterValue;
  onChange: (v: DateFilterValue) => void;
}) {
  const t = useT();
  const presets: { key: DatePreset; label: string }[] = [
    { key: "", label: t("filters.anyDate") },
    { key: "today", label: t("filters.today") },
    { key: "7d", label: t("filters.last7") },
    { key: "30d", label: t("filters.last30") },
    { key: "custom", label: t("filters.custom") },
  ];
  return (
    <div className="flt-date">
      <div className="flt-chips">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`flt-chip${value.preset === p.key ? " is-on" : ""}`}
            onClick={() => onChange({ ...value, preset: p.key })}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="flt-range">
          <label>
            <span>{t("filters.from")}</span>
            <input
              type="date"
              className="field field-sm"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            />
          </label>
          <label>
            <span>{t("filters.to")}</span>
            <input
              type="date"
              className="field field-sm"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** Valor especial: contactos sin ninguna etiqueta. */
export const NO_TAG = "__none__";

export function TagPicker({
  tags,
  selected,
  onChange,
}: {
  tags: TagDto[];
  selected: string[];
  onChange: (names: string[]) => void;
}) {
  const t = useT();
  const toggle = (name: string) => {
    if (name === NO_TAG) return onChange(selected.includes(NO_TAG) ? [] : [NO_TAG]);
    const rest = selected.filter((n) => n !== NO_TAG);
    onChange(rest.includes(name) ? rest.filter((n) => n !== name) : [...rest, name]);
  };
  return (
    <div className="flt-chips">
      {tags.map((tg) => {
        const on = selected.includes(tg.name);
        return (
          <button
            key={tg.id}
            type="button"
            className={`flt-chip flt-chip--tag${on ? " is-on" : ""}`}
            style={on ? { background: tagColor(tg.color), borderColor: tagColor(tg.color), color: readableInk(tagColor(tg.color)) } : undefined}
            onClick={() => toggle(tg.name)}
          >
            <span className="flt-dot" style={{ background: tagColor(tg.color) }} />
            {tg.name}
          </button>
        );
      })}
      <button
        type="button"
        className={`flt-chip${selected.includes(NO_TAG) ? " is-on" : ""}`}
        onClick={() => toggle(NO_TAG)}
      >
        {t("filters.noTag")}
      </button>
      {tags.length === 0 && <span className="flt-hint">{t("filters.noTagsYet")}</span>}
    </div>
  );
}

/** ¿Las etiquetas de un contacto pasan el filtro? */
export function tagsMatch(applied: { name: string }[], selected: string[]): boolean {
  if (selected.length === 0) return true;
  if (selected.includes(NO_TAG)) return applied.length === 0;
  return selected.every((n) => applied.some((a) => a.name === n));
}

/** Botón que abre/cierra el panel de filtros, con el número de activos. */
export function FiltersToggle({
  open,
  count,
  onClick,
  compact = false,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={`flt-toggle${open || count > 0 ? " is-on" : ""}`}
      onClick={onClick}
      aria-expanded={open}
      title={t("filters.title")}
    >
      <NavIcon name="filter" size={13} />
      {!compact && t("filters.title")}
      {count > 0 && <span className="flt-count">{count}</span>}
    </button>
  );
}

/** Grupo con etiqueta dentro del panel de filtros. */
export function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flt-group">
      <span className="flt-label">{label}</span>
      {children}
    </div>
  );
}
