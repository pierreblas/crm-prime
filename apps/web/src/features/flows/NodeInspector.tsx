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
  type FlowCard,
  type FlowChannelRef,
  type FlowNodeData,
  type FlowRule,
  type FlowSplit,
  type FlowSummary,
  type FlowTrigger,
  type SourceDto,
  type TagDto,
  type TemplateVariable,
  type VariableValue,
} from "@crm/shared";
import { TriggersEditor } from "./TriggersEditor";
import { FlowEmailFields } from "@/features/email/FlowEmailFields";
import { NavIcon } from "@/components/NavIcons";
import { uploadMedia } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { RuleRow, type RuleLookups } from "./RuleRow";
import {
  ACTION_LABEL,
  MEDIA_META,
  NODE_META,
  STATUS_LABEL,
  VALIDATION_LABEL,
  defaultHours,
  DAY_LABEL,
  rulesOf,
} from "./flowShared";


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
  triggers,
  onTriggersChange,
}: {
  node: Node;
  bots: FlowBotRef[];
  stages: { id: string; name: string }[];
  /** Plantillas aprobadas por Meta, para «Enviar plantilla». */
  templates: { id: string; name: string; language: string; variables: TemplateVariable[] }[];
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
  /** Disparadores del flujo (se editan en el bloque «Inicio»). */
  triggers: FlowTrigger[];
  onTriggersChange: (next: FlowTrigger[]) => void;
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
              style={{ ...iconBtn, color: "var(--danger)", borderColor: "var(--danger-border)" }}
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
        <>
          <TriggersEditor
            triggers={triggers}
            onChange={onTriggersChange}
            lookups={{ variables: [], fields, tags, sources, channels, agents, stages }}
          />
          <p style={hint}>Después, pulsa el «+» de Inicio o arrastra desde su salida al primer bloque.</p>
        </>
      )}

      {node.type === "list" && (
        <>
          <Field label="Texto del mensaje">
            <textarea
              style={{ ...input, minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
              value={data.text ?? ""}
              maxLength={4096}
              placeholder="Elige el servicio que te interesa"
              onChange={(e) => patch({ text: e.target.value })}
            />
            <VarChips variables={variables} onPick={(v) => patch({ text: `${data.text ?? ""}{{${v}}}` })} />
          </Field>
          <Field label="Botón que abre la lista">
            <input style={input} value={data.listButton ?? ""} maxLength={20} placeholder="Ver opciones" onChange={(e) => patch({ listButton: e.target.value })} />
          </Field>
          <ListRowsFields rows={data.buttons ?? []} onChange={(buttons) => patch({ buttons })} />
          <Field label="Pie (opcional)">
            <input style={input} value={data.footer ?? ""} maxLength={60} onChange={(e) => patch({ footer: e.target.value })} />
          </Field>
          <Field label="Guardar lo que eligió en la variable (opcional)">
            <input
              style={{ ...input, fontFamily: "ui-monospace, monospace" }}
              value={data.variable ?? ""}
              placeholder="opcion"
              onChange={(e) => patch({ variable: e.target.value.replace(/[^\w]/g, "") })}
            />
          </Field>
          <p style={hint}>
            WhatsApp muestra un botón que abre hasta 10 opciones (título de 24 caracteres y descripción de 72). Cada opción es
            una salida. Fuera de la ventana de 24 h va como texto con las opciones numeradas.
          </p>
        </>
      )}

      {node.type === "carousel" && <CarouselFields data={data} variables={variables} onChange={patch} />}

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
          <Attachment data={data} onChange={patch} kind="header" />
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
            vale el texto del botón (con o sin tildes) o su número; cualquier otra cosa sale por «otra respuesta»
            o, si no la conectas, sigue como un mensaje normal y los botones siguen valiendo. Fuera de la
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

      {node.type === "sendEmail" && <FlowEmailFields data={data} patch={patch} />}

      {node.type === "sendTemplate" && (
        <>
          <Field label="Plantilla aprobada por Meta">
            <select
              style={input}
              value={data.templateId ?? ""}
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                // Otra plantilla: sus variables son otras.
                patch({ templateId: e.target.value, templateName: t ? `${t.name} · ${t.language}` : "", templateVars: [] });
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
          <TemplateVarsEditor
            template={templates.find((t) => t.id === data.templateId) ?? null}
            value={data.templateVars ?? []}
            variables={variables}
            onChange={(templateVars) => patch({ templateVars })}
          />
          <p style={hint}>
            Es la única forma de escribirle a quien nunca te escribió (un lead de un formulario) o
            lleva más de 24 h callado. Las plantillas se crean y aprueban en Difusiones.
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
function Attachment({
  data,
  onChange,
  kind = "message",
}: {
  data: FlowNodeData;
  onChange: (p: Partial<FlowNodeData>) => void;
  /** «header»: el de unos botones (imagen, video o documento, sin audio). */
  kind?: "message" | "header";
}) {
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadMedia(file);
      if (kind === "header" && up.kind === "AUDIO") {
        toast.error("Arriba de los botones va una imagen, un video o un documento; el audio, en un «Enviar mensaje» aparte");
        return;
      }
      onChange({ mediaUrl: up.mediaUrl, mediaKind: up.kind, mediaName: up.fileName });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={lbl}>{kind === "header" ? "Arriba de los botones (opcional)" : "Adjunto (opcional)"}</div>
      {data.mediaUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <NavIcon name={MEDIA_META[data.mediaKind ?? "IMAGE"]?.icon ?? "file"} size={14} />
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
          {busy ? "Subiendo…" : kind === "header" ? "Imagen, video o documento" : "Imagen, video, audio o archivo"}
          <input
            type="file"
            accept={
              kind === "header"
                ? "image/jpeg,image/png,image/webp,video/mp4,video/3gpp,.pdf,.doc,.docx,.xls,.xlsx"
                : "image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            }
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </label>
      )}
      {data.mediaUrl && kind === "message" && (
        <p style={hint}>
          {data.mediaKind === "AUDIO" ? "El audio no lleva pie: el texto, si hay, va después en otro mensaje." : "El texto de arriba va como pie del adjunto."}
        </p>
      )}
      {!data.mediaUrl && (
        <p style={hint}>Imagen hasta 5 MB (JPG, PNG, WebP); video MP4 y audio hasta 16 MB; documentos PDF, Word, Excel.</p>
      )}
    </div>
  );
}

function ListRowsFields({ rows, onChange }: { rows: FlowButton[]; onChange: (r: FlowButton[]) => void }) {
  const set = (i: number, p: Partial<FlowButton>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Field label="Opciones (cada una es una salida)">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8, borderRadius: 8, background: "var(--surface-2)" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input style={{ ...input, flex: 1 }} value={r.title} maxLength={24} placeholder={`Opción ${i + 1}`} onChange={(e) => set(i, { title: e.target.value })} />
              <button style={miniBtn} title="Quitar opción" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <NavIcon name="x" size={12} />
              </button>
            </div>
            <input style={input} value={r.description ?? ""} maxLength={72} placeholder="Descripción (opcional)" onChange={(e) => set(i, { description: e.target.value })} />
          </div>
        ))}
        {rows.length < 10 && (
          <button style={{ ...ghost, alignSelf: "flex-start" }} onClick={() => onChange([...rows, { id: `o${Date.now().toString(36)}`, title: "" }])}>
            + Añadir opción
          </button>
        )}
      </div>
    </Field>
  );
}

/** Carrusel: texto general, tipo de botón y de 2 a 10 tarjetas. */
function CarouselFields({ data, variables, onChange }: { data: FlowNodeData; variables: string[]; onChange: (p: Partial<FlowNodeData>) => void }) {
  const cards = data.cards ?? [];
  const mode = data.cardMode ?? "reply";
  const setCard = (i: number, p: Partial<FlowCard>) => onChange({ cards: cards.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  return (
    <>
      <Field label="Texto sobre el carrusel">
        <textarea
          style={{ ...input, minHeight: 64, resize: "vertical", fontFamily: "inherit" }}
          value={data.text ?? ""}
          maxLength={1024}
          placeholder="Mira nuestros modelos"
          onChange={(e) => onChange({ text: e.target.value })}
        />
        <VarChips variables={variables} onPick={(v) => onChange({ text: `${data.text ?? ""}{{${v}}}` })} />
      </Field>
      <Field label="El botón de cada tarjeta">
        <div className="seg" role="radiogroup">
          <button type="button" role="radio" aria-selected={mode === "reply"} onClick={() => onChange({ cardMode: "reply" })}>
            Respuesta (una salida por tarjeta)
          </button>
          <button type="button" role="radio" aria-selected={mode === "url"} onClick={() => onChange({ cardMode: "url" })}>
            Enlace
          </button>
        </div>
      </Field>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {cards.map((c, i) => (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 8, background: "var(--surface-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <strong style={{ fontSize: 12.5, flex: 1 }}>Tarjeta {i + 1}</strong>
              {cards.length > 2 && (
                <button style={miniBtn} title="Quitar tarjeta" onClick={() => onChange({ cards: cards.filter((_, j) => j !== i) })}>
                  <NavIcon name="x" size={12} />
                </button>
              )}
            </div>
            <CardMedia card={c} onChange={(p) => setCard(i, p)} />
            <input style={input} value={c.text ?? ""} maxLength={160} placeholder="Texto de la tarjeta (hasta 160)" onChange={(e) => setCard(i, { text: e.target.value })} />
            <input style={input} value={c.buttonTitle ?? ""} maxLength={20} placeholder={mode === "url" ? "Texto del enlace (Ver más)" : "Texto del botón (Elegir)"} onChange={(e) => setCard(i, { buttonTitle: e.target.value })} />
            {mode === "url" && (
              <input style={input} value={c.url ?? ""} placeholder="https://tu-web.com/producto" onChange={(e) => setCard(i, { url: e.target.value.trim() })} />
            )}
          </div>
        ))}
        {cards.length < 10 && (
          <button
            style={{ ...ghost, alignSelf: "flex-start" }}
            onClick={() => onChange({ cards: [...cards, { id: `c${Date.now().toString(36)}`, text: "", buttonTitle: mode === "url" ? "Ver más" : "Elegir" }] })}
          >
            + Añadir tarjeta
          </button>
        )}
      </div>
      <p style={hint}>
        De 2 a 10 tarjetas, cada una con imagen o video. Con «Respuesta», cada tarjeta es una salida del bloque; con «Enlace»,
        el botón abre la web y el flujo sigue. Solo dentro de la ventana de 24 h: fuera de ella va como texto con las opciones.
      </p>
    </>
  );
}

function CardMedia({ card, onChange }: { card: FlowCard; onChange: (p: Partial<FlowCard>) => void }) {
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadMedia(file);
      if (up.kind !== "IMAGE" && up.kind !== "VIDEO") {
        toast.error("Cada tarjeta lleva una imagen o un video");
        return;
      }
      onChange({ mediaUrl: up.mediaUrl, mediaKind: up.kind, mediaName: up.fileName });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (card.mediaUrl) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
        <NavIcon name={card.mediaKind === "VIDEO" ? "video" : "image"} size={14} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.mediaName || (card.mediaKind === "VIDEO" ? "Video" : "Imagen")}</span>
        <button style={miniBtn} title="Quitar" onClick={() => onChange({ mediaUrl: undefined, mediaKind: undefined, mediaName: undefined })}>
          <NavIcon name="x" size={12} />
        </button>
      </div>
    );
  }
  return (
    <label style={{ ...ghost, display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "wait" : "pointer", alignSelf: "flex-start" }}>
      <NavIcon name="image" size={13} />
      {busy ? "Subiendo…" : "Imagen o video"}
      <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp" style={{ display: "none" }} disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
    </label>
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
          <button style={{ ...miniBtn, color: "var(--danger)" }} title="Quitar botón" onClick={() => onChange(buttons.filter((_, idx) => idx !== i))}>
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
          <button style={{ ...miniBtn, color: "var(--danger)" }} title="Quitar variante" disabled={splits.length <= 2} onClick={() => onChange(splits.filter((_, idx) => idx !== i))}>
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
        <span style={{ ...hint, margin: 0, color: total === 100 ? "var(--muted)" : "var(--warning)" }}>
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
    <div style={{ ...hint, textAlign: "right", color: n > WA_TEXT_MAX * 0.9 ? "var(--warning)" : "var(--muted)" }}>
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
                style={{ ...miniBtn, color: "var(--danger)" }}
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

/**
 * El valor de cada variable de la plantilla: del contacto o un texto fijo (que
 * admite {{variables}} del flujo). Sin elegir, la primera es el nombre.
 */
function TemplateVarsEditor({
  template,
  value,
  variables,
  onChange,
}: {
  template: { variables: TemplateVariable[] } | null;
  value: VariableValue[];
  variables: string[];
  onChange: (v: VariableValue[]) => void;
}) {
  if (!template || template.variables.length === 0) return null;
  const current = (index: number): VariableValue =>
    value.find((v) => v.index === index) ?? (index === 1 ? { index, source: "contact_name" } : { index, source: "static", value: "" });
  const set = (index: number, p: Partial<VariableValue>) =>
    onChange([...value.filter((v) => v.index !== index), { ...current(index), ...p }].sort((a, b) => a.index - b.index));
  return (
    <Field label="Variables de la plantilla">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {template.variables.map((v) => {
          const val = current(v.index);
          return (
            <div key={v.index} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <code style={{ color: "var(--accent-text)", flexShrink: 0 }}>{`{{${v.name ?? v.index}}}`}</code>
                <select
                  style={{ ...input, flex: 1 }}
                  value={val.source}
                  onChange={(e) => set(v.index, { source: e.target.value as VariableValue["source"] })}
                >
                  <option value="contact_name">Nombre del contacto</option>
                  <option value="contact_phone">Teléfono del contacto</option>
                  <option value="static">Texto</option>
                </select>
              </div>
              {val.source === "static" && (
                <>
                  <input
                    style={input}
                    value={val.value ?? ""}
                    placeholder="Texto, o una {{variable}} del flujo"
                    onChange={(e) => set(v.index, { value: e.target.value })}
                  />
                  <VarChips variables={variables} onPick={(name) => set(v.index, { value: `${val.value ?? ""}{{${name}}}` })} />
                </>
              )}
            </div>
          );
        })}
      </div>
    </Field>
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
  border: "1px solid var(--warning-border)",
  background: "rgba(240, 180, 90, 0.08)",
  color: "var(--warning)",
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
  color: "var(--positive)",
  fontSize: 11.5,
  fontFamily: "ui-monospace, monospace",
  cursor: "pointer",
};
