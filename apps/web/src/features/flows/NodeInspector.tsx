"use client";

import { useEffect, useState } from "react";
import type { Node } from "@xyflow/react";
import {
  answerValidations,
  delayUnits,
  flowActionTypes,
  flowStatuses,
  httpMethods,
  weekday,
  type CustomFieldDto,
  type FlowAgentRef,
  type FlowBotRef,
  type FlowBranch,
  type FlowButton,
  type FlowChannelRef,
  type FlowNodeData,
  type FlowRule,
  type FlowSplit,
  type FlowSummary,
  type SourceDto,
  type TagDto,
} from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { uploadMedia } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { RuleRow, type RuleLookups } from "./RuleRow";
import {
  ACTION_LABEL,
  NODE_META,
  STATUS_LABEL,
  VALIDATION_LABEL,
  defaultHours,
  rulesOf,
} from "./flowShared";

const DAY_LABEL: Record<string, string> = { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" };

// Límite de un mensaje de texto en WhatsApp.
const WA_TEXT_MAX = 4096;

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
const lbl: React.CSSProperties = { fontSize: 12, color: "var(--muted)", marginBottom: 4 };
const ghost: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 12,
};
const iconBtn: React.CSSProperties = {
  ...ghost,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 8px",
};

export function NodeInspector({
  node,
  bots,
  stages,
  templates,
  agents,
  fields,
  tags,
  sources,
  channels,
  flows,
  variables,
  issues,
  onChange,
  onDelete,
  onDuplicate,
}: {
  node: Node;
  bots: FlowBotRef[];
  stages: { id: string; name: string }[];
  /** Plantillas aprobadas por Meta, para «Enviar plantilla». */
  templates: { id: string; name: string; language: string }[];
  agents: FlowAgentRef[];
  /** Campos personalizados del contacto, para «Guardar en el contacto» y las condiciones. */
  fields: CustomFieldDto[];
  /** Para los valores de las condiciones. */
  tags: TagDto[];
  sources: SourceDto[];
  channels: FlowChannelRef[];
  flows: FlowSummary[];
  /** Variables definidas en el flujo, para insertarlas en los textos. */
  variables: string[];
  /** Avisos de este bloque (lo que falta para que funcione). */
  issues: string[];
  onChange: (data: FlowNodeData) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const data = node.data as FlowNodeData;
  const patch = (p: Partial<FlowNodeData>) => onChange({ ...data, ...p });
  const meta = NODE_META[node.type ?? ""];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: meta?.accent ?? "var(--text)", display: "inline-flex" }}>
          <NavIcon name={meta?.icon ?? "bolt"} size={16} />
        </span>
        <strong style={{ fontSize: 14, flex: 1 }}>{meta?.label ?? "Bloque"}</strong>
        {node.type !== "start" && (
          <>
            <button style={iconBtn} title="Duplicar (Ctrl+D)" onClick={onDuplicate}>
              <NavIcon name="copy" size={13} />
            </button>
            <button
              style={{ ...iconBtn, color: "#e08a8a", borderColor: "#5a2a2a" }}
              title="Eliminar (Supr)"
              onClick={onDelete}
            >
              <NavIcon name="x" size={13} />
            </button>
          </>
        )}
      </div>

      {issues.length > 0 && (
        <div style={issueBox}>
          {issues.map((i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>
                <NavIcon name="alert" size={13} />
              </span>
              {i}
            </div>
          ))}
        </div>
      )}

      {node.type === "start" && (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
          Punto de inicio del flujo. Pulsa su «+» o arrastra desde su salida
          al primer bloque.
        </p>
      )}

      {node.type === "sendMessage" && (
        <Field label="Mensaje a enviar">
          <textarea
            style={{ ...input, minHeight: 120, resize: "vertical", fontFamily: "inherit" }}
            value={data.text ?? ""}
            maxLength={WA_TEXT_MAX}
            placeholder="Hola, ¿en qué te ayudo?"
            onChange={(e) => patch({ text: e.target.value })}
          />
          <Counter value={data.text ?? ""} />
          <VarChips variables={variables} onPick={(v) => patch({ text: `${data.text ?? ""}{{${v}}}` })} />
          <Attachment data={data} onChange={patch} />
        </Field>
      )}

      {node.type === "buttons" && (
        <>
          <Field label="Texto del mensaje">
            <textarea
              style={{ ...input, minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
              value={data.text ?? ""}
              maxLength={1024}
              placeholder="¿Qué te interesa?"
              onChange={(e) => patch({ text: e.target.value })}
            />
            <VarChips variables={variables} onPick={(v) => patch({ text: `${data.text ?? ""}{{${v}}}` })} />
          </Field>
          <ButtonsFields buttons={data.buttons ?? []} onChange={(buttons) => patch({ buttons })} />
          <Field label="Guardar lo que pulsó en la variable (opcional)">
            <input
              style={{ ...input, fontFamily: "ui-monospace, monospace" }}
              value={data.variable ?? ""}
              placeholder="opcion"
              onChange={(e) => patch({ variable: e.target.value.replace(/[^\w]/g, "") })}
            />
          </Field>
          <p style={hint}>
            WhatsApp muestra hasta 3 botones de 20 caracteres. Si el contacto escribe en vez de pulsar, también
            vale el texto exacto del botón o su número; cualquier otra cosa sale por «otra respuesta». Fuera de la
            ventana de 24 h el mensaje va como texto con las opciones numeradas.
          </p>
        </>
      )}

      {node.type === "setField" && (
        <>
          <Field label="Campo del contacto">
            <select style={input} value={data.fieldKey ?? ""} onChange={(e) => patch({ fieldKey: e.target.value })}>
              <option value="">Elige un campo…</option>
              <option value="name">Nombre del contacto</option>
              {fields.map((f) => (
                <option key={f.id} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor">
            <input
              style={input}
              value={data.value ?? ""}
              placeholder="{{nombre}}"
              onChange={(e) => patch({ value: e.target.value })}
            />
            <VarChips variables={variables} onPick={(v) => patch({ value: `${data.value ?? ""}{{${v}}}` })} />
          </Field>
          <p style={hint}>
            Lo típico: preguntar el nombre con «Preguntar y guardar» y guardarlo aquí en el contacto. Los campos
            personalizados se crean en Contactos.
          </p>
        </>
      )}

      {node.type === "addNote" && (
        <Field label="Nota para el equipo">
          <textarea
            style={{ ...input, minHeight: 90, resize: "vertical", fontFamily: "inherit" }}
            value={data.text ?? ""}
            maxLength={1000}
            placeholder="Pidió presupuesto para {{producto}}"
            onChange={(e) => patch({ text: e.target.value })}
          />
          <VarChips variables={variables} onPick={(v) => patch({ text: `${data.text ?? ""}{{${v}}}` })} />
          <p style={hint}>Queda en las notas internas de la conversación; el cliente no la ve.</p>
        </Field>
      )}

      {node.type === "setStatus" && (
        <Field label="Dejar la conversación como">
          <select style={input} value={data.status ?? ""} onChange={(e) => patch({ status: e.target.value as FlowNodeData["status"] })}>
            {flowStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <p style={hint}>
            «Pendiente» la deja esperando a una persona; «Cerrada» la archiva (y puede disparar un flujo «al cerrar»).
          </p>
        </Field>
      )}

      {node.type === "split" && <SplitFields splits={data.splits ?? []} onChange={(splits) => patch({ splits })} />}

      {node.type === "schedule" && <HoursFields hours={data.hours ?? defaultHours()} onChange={(hours) => patch({ hours })} />}

      {node.type === "sendTemplate" && (
        <>
          <Field label="Plantilla aprobada por Meta">
            <select
              style={input}
              value={data.templateId ?? ""}
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                patch({ templateId: e.target.value, templateName: t ? `${t.name} · ${t.language}` : "" });
              }}
            >
              <option value="">Elige una plantilla…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.language}
                </option>
              ))}
            </select>
          </Field>
          <p style={hint}>
            Es la única forma de escribirle a quien nunca te escribió (un lead de un formulario) o
            lleva más de 24 h callado. Si la plantilla tiene <code>{"{{1}}"}</code>, va el nombre del
            contacto. Las plantillas se crean y aprueban en Difusiones.
          </p>
          {templates.length === 0 && <p style={hint}>Todavía no tienes plantillas aprobadas.</p>}
        </>
      )}

      {node.type === "askQuestion" && (
        <>
          <Field label="Pregunta">
            <textarea
              style={{ ...input, minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
              value={data.text ?? ""}
              maxLength={WA_TEXT_MAX}
              placeholder="¿Cuál es tu nombre?"
              onChange={(e) => patch({ text: e.target.value })}
            />
            <VarChips variables={variables} onPick={(v) => patch({ text: `${data.text ?? ""}{{${v}}}` })} />
          </Field>
          <Field label="Guardar la respuesta en la variable">
            <input
              style={{ ...input, fontFamily: "ui-monospace, monospace" }}
              value={data.variable ?? ""}
              placeholder="nombre"
              onChange={(e) => patch({ variable: e.target.value.replace(/[^\w]/g, "") })}
            />
          </Field>
          <p style={hint}>
            Úsala luego en cualquier texto como{" "}
            <code>{`{{${data.variable || "variable"}}}`}</code>.
          </p>
          <Field label="La respuesta debe ser">
            <select
              style={input}
              value={data.validate ?? "any"}
              onChange={(e) => patch({ validate: e.target.value as FlowNodeData["validate"] })}
            >
              {answerValidations.map((v) => (
                <option key={v} value={v}>
                  {VALIDATION_LABEL[v]}
                </option>
              ))}
            </select>
          </Field>
          {data.validate === "regex" && (
            <Field label="Patrón (expresión regular)">
              <input
                style={{ ...input, fontFamily: "ui-monospace, monospace" }}
                value={data.pattern ?? ""}
                placeholder="^[A-Z]{3}-\\d{4}$"
                onChange={(e) => patch({ pattern: e.target.value })}
              />
            </Field>
          )}
          {data.validate && data.validate !== "any" && (
            <>
              <Field label="Si no es válida, responder">
                <input
                  style={input}
                  value={data.retryText ?? ""}
                  placeholder="Mmm, eso no parece un teléfono. ¿Me lo repites?"
                  onChange={(e) => patch({ retryText: e.target.value })}
                />
              </Field>
              <Field label="Intentos antes de rendirse">
                <input
                  style={{ ...input, width: 90 }}
                  type="number"
                  min={0}
                  max={5}
                  value={data.maxRetries ?? 2}
                  onChange={(e) => patch({ maxRetries: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })}
                />
              </Field>
              <p style={hint}>
                Tras agotar los intentos sigue por la salida «si no es válida» (o por la normal si no la conectas),
                guardando lo último que escribió.
              </p>
            </>
          )}
        </>
      )}

      {node.type === "condition" && (
        <ConditionFields
          branches={data.branches ?? []}
          onChange={(branches) => patch({ branches })}
          lookups={{ variables, fields, tags, sources, channels, agents, stages }}
        />
      )}

      {node.type === "action" && (
        <>
          <Field label="Acción">
            <select
              style={input}
              value={data.action ?? "ai"}
              onChange={(e) => patch({ action: e.target.value as FlowNodeData["action"] })}
            >
              {flowActionTypes.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          </Field>
          {data.action === "ai" && (
            <Field label="Agente que toma la conversación">
              <select
                style={input}
                value={data.botId ?? ""}
                onChange={(e) => patch({ botId: e.target.value || null })}
              >
                <option value="">Agente del canal / por defecto</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {data.action === "handoff" && (
            <p style={hint}>
              La conversación pasa a Copilot y queda pendiente para una persona
              del equipo.
            </p>
          )}
          {(data.action === "tag" || data.action === "untag") && (
            <Field label={data.action === "tag" ? "Etiqueta a poner" : "Etiqueta a quitar"}>
              <input
                style={input}
                value={data.tag ?? ""}
                placeholder="interesado"
                onChange={(e) => patch({ tag: e.target.value })}
              />
            </Field>
          )}
          {data.action === "create_deal" && (
            <>
              <Field label="Crear la oportunidad en la etapa">
                <select style={input} value={data.stageId ?? ""} onChange={(e) => patch({ stageId: e.target.value })}>
                  <option value="">Elige una etapa…</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Título (opcional)">
                <input
                  style={input}
                  value={data.dealTitle ?? ""}
                  placeholder="Oportunidad: {{nombre}}"
                  onChange={(e) => patch({ dealTitle: e.target.value })}
                />
                <VarChips variables={variables} onPick={(v) => patch({ dealTitle: `${data.dealTitle ?? ""}{{${v}}}` })} />
              </Field>
              <p style={hint}>Si el contacto ya tiene una oportunidad abierta en ese embudo, no se duplica.</p>
            </>
          )}
          {data.action === "move_deal" && (
            <Field label="Mover el deal a la etapa">
              <select
                style={input}
                value={data.stageId ?? ""}
                onChange={(e) => patch({ stageId: e.target.value })}
              >
                <option value="">Elige una etapa…</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}

      {node.type === "delay" && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Esperar</div>
              <input
                type="number"
                min={1}
                style={input}
                value={data.delayValue ?? 5}
                onChange={(e) => patch({ delayValue: Number(e.target.value) })}
              />
            </div>
            <select
              style={{ ...input, width: 120 }}
              value={data.delayUnit ?? "minutes"}
              onChange={(e) => patch({ delayUnit: e.target.value as FlowNodeData["delayUnit"] })}
            >
              {delayUnits.map((u) => (
                <option key={u} value={u}>
                  {u === "hours" ? "horas" : "minutos"}
                </option>
              ))}
            </select>
          </div>
          <p style={hint}>
            Si el contacto escribe durante la espera, el flujo sigue con su
            mensaje.
          </p>
        </>
      )}

      {node.type === "http" && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 110 }}>
              <div style={lbl}>Método</div>
              <select
                style={input}
                value={data.method ?? "POST"}
                onChange={(e) => patch({ method: e.target.value as FlowNodeData["method"] })}
              >
                {httpMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>URL</div>
              <input
                style={input}
                value={data.url ?? ""}
                placeholder="https://tu-n8n.com/webhook/..."
                onChange={(e) => patch({ url: e.target.value })}
              />
            </div>
          </div>
          <Field label="Cabeceras (JSON, opcional)">
            <textarea
              style={{ ...input, minHeight: 50, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              value={data.headers ?? ""}
              placeholder={'{ "Authorization": "Bearer ..." }'}
              onChange={(e) => patch({ headers: e.target.value })}
            />
          </Field>
          <Field label="Cuerpo (admite {{variables}}, opcional)">
            <textarea
              style={{ ...input, minHeight: 60, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              value={data.httpBody ?? ""}
              placeholder={'{ "telefono": "{{telefono}}" }'}
              onChange={(e) => patch({ httpBody: e.target.value })}
            />
            <VarChips variables={variables} onPick={(v) => patch({ httpBody: `${data.httpBody ?? ""}{{${v}}}` })} />
          </Field>
          <Field label="Guardar la respuesta en la variable (opcional)">
            <input
              style={{ ...input, fontFamily: "ui-monospace, monospace" }}
              value={data.saveAs ?? ""}
              placeholder="respuesta_api"
              onChange={(e) => patch({ saveAs: e.target.value.replace(/[^\w]/g, "") })}
            />
          </Field>
        </>
      )}

      {node.type === "assign" && (
        <Field label="Asignar la conversación a">
          <select
            style={input}
            value={data.agentId ?? ""}
            onChange={(e) => {
              const a = agents.find((x) => x.id === e.target.value);
              patch({ agentId: e.target.value || null, agentName: a?.name ?? a?.email });
            }}
          >
            <option value="">Elige un agente…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? a.email}
              </option>
            ))}
          </select>
        </Field>
      )}

      {node.type === "jumpToFlow" && (
        <>
          <Field label="Continuar en el flujo">
            <select
              style={input}
              value={data.flowId ?? ""}
              onChange={(e) => {
                const f = flows.find((x) => x.id === e.target.value);
                patch({ flowId: e.target.value, flowName: f?.name });
              }}
            >
              <option value="">Elige un flujo…</option>
              {flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <p style={hint}>Este bloque no tiene salida: el otro flujo toma el control.</p>
        </>
      )}
    </div>
  );
}

/** Variables del flujo como chips: un clic las inserta al final del texto. */
/** Imagen o archivo que acompaña al mensaje. */
function Attachment({ data, onChange }: { data: FlowNodeData; onChange: (p: Partial<FlowNodeData>) => void }) {
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadMedia(file);
      onChange({ mediaUrl: up.mediaUrl, mediaKind: up.kind, mediaName: up.fileName });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={lbl}>Adjunto (opcional)</div>
      {data.mediaUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <NavIcon name={data.mediaKind === "DOCUMENT" ? "file" : "image"} size={14} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {data.mediaName || "Adjunto"}
          </span>
          <button style={miniBtn} title="Quitar adjunto" onClick={() => onChange({ mediaUrl: undefined, mediaKind: undefined, mediaName: undefined })}>
            <NavIcon name="x" size={12} />
          </button>
        </div>
      ) : (
        <label style={{ ...ghost, display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "wait" : "pointer" }}>
          <NavIcon name="paperclip" size={13} />
          {busy ? "Subiendo…" : "Adjuntar imagen o archivo"}
          <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style={{ display: "none" }} disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
      )}
      {data.mediaUrl && <p style={hint}>El texto de arriba va como pie del adjunto.</p>}
    </div>
  );
}

function ButtonsFields({ buttons, onChange }: { buttons: FlowButton[]; onChange: (b: FlowButton[]) => void }) {
  const update = (i: number, title: string) => onChange(buttons.map((b, idx) => (idx === i ? { ...b, title } : b)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={lbl}>Botones (cada uno es una salida)</div>
      {buttons.map((b, i) => (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            style={{ ...input, flex: 1 }}
            value={b.title}
            maxLength={20}
            placeholder={`Botón ${i + 1}`}
            onChange={(e) => update(i, e.target.value)}
          />
          <span style={{ ...hint, margin: 0, width: 38, textAlign: "right" }}>{b.title.length}/20</span>
          <button style={{ ...miniBtn, color: "#e08a8a" }} title="Quitar botón" onClick={() => onChange(buttons.filter((_, idx) => idx !== i))}>
            <NavIcon name="x" size={12} />
          </button>
        </div>
      ))}
      {buttons.length < 3 && (
        <button
          style={ghost}
          onClick={() => onChange([...buttons, { id: `b${Date.now().toString(36)}`, title: "" }])}
        >
          + Añadir botón
        </button>
      )}
    </div>
  );
}

function SplitFields({ splits, onChange }: { splits: FlowSplit[]; onChange: (s: FlowSplit[]) => void }) {
  const total = splits.reduce((s, x) => s + (x.weight || 0), 0);
  const update = (i: number, p: Partial<FlowSplit>) => onChange(splits.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ ...hint, margin: 0 }}>
        Cada contacto que llega aquí sale por una variante al azar, según su peso. Útil para probar dos mensajes
        (A/B) o repartir entre vendedores.
      </p>
      {splits.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input style={{ ...input, flex: 1 }} value={s.label} placeholder={`Variante ${i + 1}`} onChange={(e) => update(i, { label: e.target.value })} />
          <input
            style={{ ...input, width: 70 }}
            type="number"
            min={0}
            max={100}
            value={s.weight}
            onChange={(e) => update(i, { weight: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
          />
          <span style={{ ...hint, margin: 0 }}>%</span>
          <button style={{ ...miniBtn, color: "#e08a8a" }} title="Quitar variante" disabled={splits.length <= 2} onClick={() => onChange(splits.filter((_, idx) => idx !== i))}>
            <NavIcon name="x" size={12} />
          </button>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {splits.length < 5 && (
          <button
            style={ghost}
            onClick={() => onChange([...splits, { id: `s${Date.now().toString(36)}`, label: "", weight: 0 }])}
          >
            + Añadir variante
          </button>
        )}
        <span style={{ ...hint, margin: 0, color: total === 100 ? "var(--muted)" : "#e0b766" }}>
          Suma {total}% {total !== 100 ? "(se reparte en proporción)" : ""}
        </span>
      </div>
    </div>
  );
}

function HoursFields({
  hours,
  onChange,
}: {
  hours: NonNullable<FlowNodeData["hours"]>;
  onChange: (h: NonNullable<FlowNodeData["hours"]>) => void;
}) {
  const setDay = (d: (typeof weekday)[number], range: { from: string; to: string } | null) =>
    onChange({ ...hours, days: { ...hours.days, [d]: range } });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label="Zona horaria">
        <input
          style={input}
          value={hours.timezone}
          placeholder="America/Lima"
          onChange={(e) => onChange({ ...hours, timezone: e.target.value })}
        />
      </Field>
      <div style={lbl}>Días y horas de atención</div>
      {weekday.map((d) => {
        const r = hours.days?.[d] ?? null;
        return (
          <div key={d} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, width: 64, fontSize: 13 }}>
              <input type="checkbox" checked={!!r} onChange={(e) => setDay(d, e.target.checked ? { from: "09:00", to: "18:00" } : null)} />
              {DAY_LABEL[d]}
            </label>
            <input style={{ ...input, flex: 1 }} type="time" value={r?.from ?? ""} disabled={!r} onChange={(e) => r && setDay(d, { ...r, from: e.target.value })} />
            <span style={{ ...hint, margin: 0 }}>a</span>
            <input style={{ ...input, flex: 1 }} type="time" value={r?.to ?? ""} disabled={!r} onChange={(e) => r && setDay(d, { ...r, to: e.target.value })} />
          </div>
        );
      })}
      <p style={hint}>Dentro del horario sigue por «en horario»; si no, por «fuera de horario» (por ejemplo, para avisar que se responderá mañana).</p>
    </div>
  );
}

function VarChips({ variables, onPick }: { variables: string[]; onPick: (v: string) => void }) {
  if (!variables.length) {
    return (
      <p style={hint}>
        Las respuestas guardadas con «Preguntar y guardar» aparecerán aquí para
        insertarlas.
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      <span style={{ ...hint, margin: 0, alignSelf: "center" }}>Insertar:</span>
      {variables.map((v) => (
        <button key={v} style={chipBtn} onClick={() => onPick(v)} title={`Insertar {{${v}}}`}>
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}

function Counter({ value }: { value: string }) {
  const n = value.length;
  return (
    <div style={{ ...hint, textAlign: "right", color: n > WA_TEXT_MAX * 0.9 ? "#e0b766" : "var(--muted)" }}>
      {n} / {WA_TEXT_MAX}
    </div>
  );
}


function ConditionFields({
  branches,
  onChange,
  lookups,
}: {
  branches: FlowBranch[];
  onChange: (b: FlowBranch[]) => void;
  lookups: RuleLookups;
}) {
  function update(i: number, p: Partial<FlowBranch>) {
    onChange(branches.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= branches.length) return;
    const next = [...branches];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  const newRule = (): FlowRule => ({ id: `r_${Math.random().toString(36).slice(2, 8)}`, field: "message", op: "contains", value: "" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ ...hint, margin: 0 }}>
        Cada rama es una salida. Se comprueban en orden y gana la primera cuyas condiciones se
        cumplen; «En otro caso» recoge el resto. Puedes mirar el mensaje, variables, el contacto
        (campos, etiquetas, fuente), la conversación o la etapa del embudo.
      </p>
      {branches.map((b, i) => {
        const rules = rulesOf(b);
        const setRules = (next: FlowRule[]) => update(i, { rules: next, keywords: [] });
        return (
          <div key={b.id} style={branchBox}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...lbl, margin: 0, flex: 1 }}>Rama {i + 1}</span>
              <button style={miniBtn} title="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                <NavIcon name="arrow-up" size={12} />
              </button>
              <button style={miniBtn} title="Bajar" disabled={i === branches.length - 1} onClick={() => move(i, 1)}>
                <NavIcon name="arrow-down" size={12} />
              </button>
              <button
                style={{ ...miniBtn, color: "#e08a8a" }}
                title="Quitar rama"
                onClick={() => onChange(branches.filter((_, idx) => idx !== i))}
              >
                <NavIcon name="x" size={12} />
              </button>
            </div>
            <input
              style={input}
              value={b.label}
              placeholder="Nombre (ej: Quiere precio)"
              onChange={(e) => update(i, { label: e.target.value })}
            />
            {rules.map((r, ri) => (
              <RuleRow
                key={r.id}
                rule={r}
                lookups={lookups}
                onChange={(p) => setRules(rules.map((x, idx) => (idx === ri ? { ...x, ...p } : x)))}
                onRemove={() => setRules(rules.filter((_, idx) => idx !== ri))}
              />
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button style={ghost} onClick={() => setRules([...rules, newRule()])}>
                + Añadir condición
              </button>
              {rules.length > 1 && (
                <div className="seg" role="tablist" aria-label="Cómo se combinan">
                  <button type="button" role="tab" aria-selected={(b.match ?? "all") === "all"} onClick={() => update(i, { match: "all" })}>
                    todas
                  </button>
                  <button type="button" role="tab" aria-selected={b.match === "any"} onClick={() => update(i, { match: "any" })}>
                    alguna
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <button
        onClick={() =>
          onChange([
            ...branches,
            { id: `b_${Math.random().toString(36).slice(2, 8)}`, label: "", keywords: [], rules: [newRule()], match: "all" },
          ])
        }
        style={ghost}
      >
        + Añadir rama
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={lbl}>{label}</div>
      {children}
    </div>
  );
}

const hint: React.CSSProperties = { color: "var(--muted)", fontSize: 12, margin: "6px 0 0", lineHeight: 1.45 };

const issueBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #7a6f4a",
  background: "rgba(224,183,102,0.08)",
  color: "#e0b766",
  fontSize: 12.5,
  lineHeight: 1.4,
};

const branchBox: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const miniBtn: React.CSSProperties = {
  ...ghost,
  padding: "3px 6px",
  display: "inline-flex",
  alignItems: "center",
};

const chipBtn: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "#7ee2a8",
  fontSize: 11.5,
  fontFamily: "ui-monospace, monospace",
  cursor: "pointer",
};
