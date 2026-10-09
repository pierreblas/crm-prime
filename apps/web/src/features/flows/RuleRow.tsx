"use client";

import {
  COUNTRIES,
  flowStatuses,
  type CustomFieldDto,
  type FlowAgentRef,
  type FlowChannelRef,
  type FlowRule,
  type SourceDto,
  type TagDto,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { AI_MODE_LABEL, CONDITION_FIELDS, CONDITION_FIELD_BY, CONDITION_GROUPS, OPS_BY_KIND, OP_LABEL, STATUS_LABEL } from "./flowShared";

/** Catálogos para elegir valores (etapas, fuentes, números…) en una condición. */
export interface RuleLookups {
  variables: string[];
  fields: CustomFieldDto[];
  tags: TagDto[];
  sources: SourceDto[];
  channels: FlowChannelRef[];
  agents: FlowAgentRef[];
  stages: { id: string; name: string }[];
}

export const EMPTY_LOOKUPS: RuleLookups = { variables: [], fields: [], tags: [], sources: [], channels: [], agents: [], stages: [] };

export function newRule(field: FlowRule["field"] = "message", op: FlowRule["op"] = "contains", value = ""): FlowRule {
  return { id: `r_${Math.random().toString(36).slice(2, 8)}`, field, op, value };
}

/** Una condición: qué se mira, cómo se compara y con qué. La usan los flujos y el agente. */
export function RuleRow({
  rule,
  lookups,
  onChange,
  onRemove,
}: {
  rule: FlowRule;
  lookups: RuleLookups;
  onChange: (p: Partial<FlowRule>) => void;
  onRemove: () => void;
}) {
  const meta = CONDITION_FIELD_BY[rule.field] ?? CONDITION_FIELDS[0]!;
  const ops = OPS_BY_KIND[meta.kind];
  const needsValue = !["empty", "not_empty"].includes(rule.op);
  const small: React.CSSProperties = { ...input, padding: "6px 8px", fontSize: 12.5, minWidth: 0 };

  function setField(field: FlowRule["field"]) {
    const m = CONDITION_FIELD_BY[field]!;
    const op = OPS_BY_KIND[m.kind].includes(rule.op) ? rule.op : OPS_BY_KIND[m.kind][0]!;
    onChange({ field, op, key: undefined, value: field === "is_new" ? "yes" : "" });
  }

  const valueControl = (() => {
    if (!needsValue) return null;
    switch (rule.field) {
      case "status":
        return (
          <select style={small} value={rule.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor">
            <option value="">Elige…</option>
            {flowStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        );
      case "ai_mode":
        return (
          <select style={small} value={rule.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor">
            <option value="">Elige…</option>
            {Object.entries(AI_MODE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        );
      case "assigned":
        return (
          <select style={small} value={rule.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor">
            <option value="">Elige…</option>
            <option value="none">Nadie (sin asignar)</option>
            {lookups.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email}
              </option>
            ))}
          </select>
        );
      case "source":
        return (
          <select style={small} value={rule.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor">
            <option value="">Elige…</option>
            {lookups.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        );
      case "channel":
        return (
          <select style={small} value={rule.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor">
            <option value="">Elige…</option>
            {lookups.channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label ?? c.displayPhoneNumber ?? c.id}
              </option>
            ))}
          </select>
        );
      case "stage":
        return (
          <select style={small} value={rule.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor">
            <option value="">Elige…</option>
            {lookups.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        );
      case "country":
        return (
          <select style={small} value={rule.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor">
            <option value="">Elige…</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        );
      case "is_new":
        return (
          <select style={small} value={rule.value ?? "yes"} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor">
            <option value="yes">Sí</option>
            <option value="no">No</option>
          </select>
        );
      case "tag":
        return (
          <>
            <input style={small} list="cond-tag-options" value={rule.value ?? ""} placeholder="nombre de la etiqueta" onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor" />
            <datalist id="cond-tag-options">
              {lookups.tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          </>
        );
      case "messages_count":
        return <input style={small} type="number" min={0} value={rule.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} aria-label="Valor" />;
      default:
        return (
          <input
            style={small}
            value={rule.value ?? ""}
            placeholder={rule.op === "contains" || rule.op === "equals" ? "precio, costo, cuánto" : rule.op === "regex" ? "^\\d{8}$" : "valor o {{variable}}"}
            onChange={(e) => onChange({ value: e.target.value })}
            aria-label="Valor"
          />
        );
    }
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "8px 8px 8px 10px", borderRadius: 8, background: "var(--surface-2)" }} data-rule={rule.id}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select style={{ ...small, flex: 1 }} value={rule.field} onChange={(e) => setField(e.target.value as FlowRule["field"])} aria-label="Qué se mira">
          {CONDITION_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {CONDITION_FIELDS.filter((f) => f.group === g).map((f) => (
                <option key={f.field} value={f.field}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" style={{ ...miniBtn, color: "#e08a8a" }} title="Quitar condición" aria-label="Quitar condición" onClick={onRemove}>
          <NavIcon name="x" size={12} />
        </button>
      </div>
      {meta.needsKey === "variable" && (
        <>
          <input style={small} list="cond-var-options" value={rule.key ?? ""} placeholder="nombre de la variable" onChange={(e) => onChange({ key: e.target.value.replace(/[^\w]/g, "") })} />
          <datalist id="cond-var-options">
            {lookups.variables.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
      )}
      {meta.needsKey === "field" && (
        <select style={small} value={rule.key ?? ""} onChange={(e) => onChange({ key: e.target.value })}>
          <option value="">Elige el campo…</option>
          {lookups.fields.map((f) => (
            <option key={f.id} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select style={{ ...small, flex: needsValue ? "0 0 46%" : 1 }} value={rule.op} onChange={(e) => onChange({ op: e.target.value as FlowRule["op"] })} aria-label="Cómo se compara">
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </select>
        {valueControl && <div style={{ flex: 1, minWidth: 0, display: "flex" }}>{valueControl}</div>}
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};
const miniBtn: React.CSSProperties = {
  padding: "3px 6px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 12,
  display: "inline-flex",
  alignItems: "center",
};
