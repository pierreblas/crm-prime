"use client";

import { useContext, useEffect, useRef, useState } from "react";
import {
  Handle,
  NodeToolbar,
  Position,
  useConnection,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import type { FlowBranch, FlowButton, FlowNodeData } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { mediaSrc, uploadMedia } from "@/lib/bff";
import { toast } from "@/lib/toast";
import {
  ACTION_LABEL,
  FlowActionsContext,
  MEDIA_META,
  NODE_META,
  STATUS_LABEL,
  TRIGGER_BY_TYPE,
  VALIDATION_LABEL,
  branchTitle,
  triggerDetail,
  triggerExtras,
} from "./flowShared";

const ROW_H = 28;

/**
 * Salida de un bloque. Es el punto de conexión y, mientras está libre, el
 * «+» a la vez: clic para elegir el siguiente bloque (queda conectado),
 * arrastrar para enlazarla con otro. Un solo sitio para las dos cosas: antes
 * el «+» era un botón aparte que tapaba el punto.
 */
function OutputHandle({
  nodeId,
  handleId,
  position = Position.Bottom,
  color,
  top,
}: {
  nodeId: string;
  handleId?: string;
  position?: Position;
  color?: string;
  top?: number;
}) {
  const actions = useContext(FlowActionsContext);
  const free = !!actions && !actions.isOutgoingTaken(nodeId, handleId);
  return (
    <Handle
      type="source"
      position={position}
      id={handleId}
      className={`flow-out${free ? " is-free" : ""}`}
      style={{
        ...(top !== undefined ? { top } : {}),
        ...(color ? ({ "--out": color } as React.CSSProperties) : {}),
      }}
      title={free ? "Clic: elegir el siguiente bloque · Arrastrar: conectar con otro" : "Arrastra para conectar con otro bloque"}
      onClick={(e) => {
        if (!free || !actions) return;
        e.stopPropagation();
        actions.openAddMenu({ sourceId: nodeId, sourceHandle: handleId ?? null, anchor: { x: e.clientX, y: e.clientY } });
      }}
    />
  );
}

function InputHandle() {
  return <Handle type="target" position={Position.Top} className="flow-in" />;
}

/**
 * Texto que se edita en el propio bloque: al seleccionarlo, la vista previa
 * pasa a ser un cuadro de texto que crece con el contenido. Sin ir al panel
 * para cambiar una frase.
 */
function InlineText({
  nodeId,
  value,
  placeholder: ph,
  selected,
  maxLength = 4096,
}: {
  nodeId: string;
  value: string;
  placeholder: string;
  selected?: boolean;
  maxLength?: number;
}) {
  const actions = useContext(FlowActionsContext);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  });
  // Un bloque recién creado (sin texto) se selecciona solo: el cursor va al
  // cuadro para escribir sin un clic más. El menú de añadir, al cerrarse,
  // devolvía el foco a otro sitio: por eso va en un efecto y no en autoFocus.
  useEffect(() => {
    if (selected && !value) requestAnimationFrame(() => ref.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  if (!selected || !actions) {
    return value ? <Clamp>{value}</Clamp> : <i style={placeholder}>{ph}</i>;
  }
  return (
    <textarea
      ref={ref}
      className="nodrag nopan nowheel flow-inline"
      value={value}
      placeholder={ph}
      maxLength={maxLength}
      rows={1}
      onChange={(e) => actions.patchNode(nodeId, { text: e.target.value })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}

/**
 * Marco común de todos los bloques: borde por tipo, barra de herramientas al
 * seleccionar (duplicar / eliminar) y el aviso de que algo falta.
 */
function Shell({
  id,
  type,
  selected,
  minWidth,
  children,
}: {
  id: string;
  type: string;
  selected?: boolean;
  minWidth?: number;
  children: React.ReactNode;
}) {
  const actions = useContext(FlowActionsContext);
  const meta = NODE_META[type];
  const issues = actions?.issuesFor(id) ?? [];
  // Mientras se arrastra una conexión desde otro bloque, este entero es un
  // destino válido: basta soltar encima, sin apuntar al punto de entrada.
  const connection = useConnection();
  const dropping = connection.inProgress && connection.fromNode?.id !== id && type !== "start";
  return (
    <div className="flow-shell" style={shell(!!selected, meta?.color ?? "#3a4c6a", minWidth)}>
      {type !== "start" && (
        <Handle
          type="target"
          position={Position.Top}
          id="body"
          isConnectableStart={false}
          className="flow-body-target"
          style={{ pointerEvents: dropping ? "all" : "none" }}
        />
      )}
      {type !== "start" && (
        <NodeToolbar isVisible={!!selected} position={Position.Top} offset={8}>
          <div style={toolbar}>
            <button style={toolBtn} title="Duplicar (Ctrl+D)" onClick={() => actions?.duplicateNode(id)}>
              <NavIcon name="copy" size={13} /> Duplicar
            </button>
            <button
              style={{ ...toolBtn, color: "var(--danger)" }}
              title="Eliminar (Supr)"
              onClick={() => actions?.deleteNode(id)}
            >
              <NavIcon name="x" size={13} /> Eliminar
            </button>
          </div>
        </NodeToolbar>
      )}
      {issues.length > 0 && (
        <span style={issueDot} title={issues.join("\n")}>
          !
        </span>
      )}
      {children}
    </div>
  );
}

function Head({ type }: { type: string }) {
  const meta = NODE_META[type];
  return (
    <div style={{ ...head, color: meta.accent }}>
      <NavIcon name={meta.icon} size={15} />
      {meta.label}
    </div>
  );
}

/** Texto del bloque recortado a tres líneas: el detalle va en el inspector. */
function Clamp({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

/** Fila con una salida a la derecha, pegada al borde del bloque. */
function Row({ children }: { children: React.ReactNode }) {
  return <div style={rowStyle}>{children}</div>;
}

const placeholder: React.CSSProperties = { opacity: 0.5, fontStyle: "italic" };

/** «Inicio» con la lista de disparadores: cuándo arranca el flujo, a la vista. */
export function StartNode({ id, selected }: NodeProps) {
  const actions = useContext(FlowActionsContext);
  const triggers = actions?.triggers ?? [];
  return (
    <Shell id={id} type="start" selected={selected} minWidth={200}>
      <div style={{ ...head, color: NODE_META.start.accent }}>
        <NavIcon name="play" size={14} />
        Inicio
      </div>
      <div className="flow-start__list">
        {triggers.length === 0 ? (
          <div className="flow-start__empty">Sin disparadores: solo desde el embudo u otro flujo</div>
        ) : (
          triggers.map((t) => {
            const meta = TRIGGER_BY_TYPE[t.type];
            const detail = [triggerDetail(t, actions?.stageName ?? ((x) => x)), ...triggerExtras(t)].filter(Boolean).join(" · ");
            return (
              <div key={t.id} className="flow-start__trigger" title={meta?.hint}>
                <NavIcon name={meta?.icon ?? "bolt"} size={12} />
                <span>
                  {meta?.label ?? t.type}
                  {detail && <span className="flow-start__detail"> · {detail}</span>}
                </span>
              </div>
            );
          })
        )}
        <div className="flow-start__hint">{selected ? "Edita los disparadores en el panel" : "Pulsa para añadir o cambiar disparadores"}</div>
      </div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function SendMessageNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="sendMessage" selected={selected}>
      <InputHandle />
      <Head type="sendMessage" />
      <div style={body}>
        <MediaSlot nodeId={id} data={d} selected={selected} accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" label="Adjuntar imagen, video, audio o archivo" />
        <InlineText
          nodeId={id}
          value={d.text ?? ""}
          placeholder={d.mediaUrl ? (d.mediaKind === "AUDIO" ? "Texto que va después del audio (opcional)…" : "Pie del adjunto (opcional)…") : "Escribe el mensaje…"}
          selected={selected}
        />
      </div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function SendTemplateNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="sendTemplate" selected={selected}>
      <InputHandle />
      <Head type="sendTemplate" />
      <div style={body}>{d.templateName ? <Clamp>{d.templateName}</Clamp> : <i style={placeholder}>Elige la plantilla en el panel…</i>}</div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function SendEmailNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="sendEmail" selected={selected}>
      <InputHandle />
      <Head type="sendEmail" />
      <div style={body}>{d.emailTemplateName ? <Clamp>{d.emailTemplateName}</Clamp> : <i style={placeholder}>Elige la plantilla de correo en el panel…</i>}</div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function AskQuestionNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const validated = !!d.validate && d.validate !== "any";
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateInternals(id);
  }, [validated, id, updateInternals]);
  return (
    <Shell id={id} type="askQuestion" selected={selected}>
      <InputHandle />
      <Head type="askQuestion" />
      <div style={body}>
        <InlineText nodeId={id} value={d.text ?? ""} placeholder="Escribe la pregunta…" selected={selected} />
        <div style={{ marginTop: 5, fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: d.variable ? "var(--positive)" : "var(--muted)", fontFamily: "ui-monospace, monospace" }}>
            → {d.variable ? `{{${d.variable}}}` : "sin variable"}
          </span>
          {validated && <span style={{ color: "#c9b6f0" }}>espera: {VALIDATION_LABEL[d.validate!]?.toLowerCase()}</span>}
        </div>
      </div>
      {validated && (
        <div style={{ padding: "0 10px 6px", borderTop: "1px solid rgba(154, 185, 194, 0.07)", paddingTop: 4 }}>
          <Row>
            <span style={{ ...branchText, color: "var(--warning)" }}>si no es válida</span>
            <OutputHandle nodeId={id} handleId="invalid" position={Position.Right} color="var(--warning)" top={ROW_H / 2} />
          </Row>
        </div>
      )}
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function ConditionNode({ id, data, selected }: NodeProps) {
  const branches = ((data as FlowNodeData).branches ?? []) as FlowBranch[];
  // Cada rama es un handle: al añadir o quitar ramas hay que decirle a React
  // Flow que vuelva a medir dónde están, o las conexiones se quedan colgando
  // del sitio antiguo.
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateInternals(id);
  }, [branches.length, id, updateInternals]);

  return (
    <Shell id={id} type="condition" selected={selected}>
      <InputHandle />
      <Head type="condition" />
      <div style={{ padding: "6px 10px 8px" }}>
        {branches.length === 0 && <i style={{ ...placeholder, fontSize: 11.5 }}>Añade ramas en el panel…</i>}
        {branches.map((b) => (
          <Row key={b.id}>
            <span style={branchText}>{branchTitle(b)}</span>
            <OutputHandle nodeId={id} handleId={b.id} position={Position.Right} top={ROW_H / 2} />
          </Row>
        ))}
        <Row>
          <span style={{ ...branchText, color: "var(--muted)" }}>en otro caso</span>
          <OutputHandle nodeId={id} handleId="else" position={Position.Right} color="var(--muted)" top={ROW_H / 2} />
        </Row>
      </div>
    </Shell>
  );
}

export function ActionNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const label = d.action ? (ACTION_LABEL[d.action] ?? d.action) : "Sin acción";
  return (
    <Shell id={id} type="action" selected={selected}>
      <InputHandle />
      <Head type="action" />
      <div style={body}>
        {label}
        {(d.action === "tag" || d.action === "untag") && d.tag ? ` · ${d.tag}` : ""}
        {d.action === "create_deal" && d.dealTitle ? ` · ${d.dealTitle}` : ""}
      </div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function DelayNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const unit = d.delayUnit === "hours" ? "h" : "min";
  return (
    <Shell id={id} type="delay" selected={selected}>
      <InputHandle />
      <Head type="delay" />
      <div style={body}>{d.delayValue ? `${d.delayValue} ${unit}` : <i style={placeholder}>Sin tiempo…</i>}</div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function HttpNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="http" selected={selected}>
      <InputHandle />
      <Head type="http" />
      <div style={body}>
        <strong>{d.method ?? "POST"}</strong>{" "}
        {d.url ? <Clamp>{d.url}</Clamp> : <i style={placeholder}>Sin URL…</i>}
      </div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function AssignNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="assign" selected={selected}>
      <InputHandle />
      <Head type="assign" />
      <div style={body}>{d.agentName || <i style={placeholder}>Elige un agente…</i>}</div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function JumpToFlowNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="jumpToFlow" selected={selected}>
      <InputHandle />
      <Head type="jumpToFlow" />
      <div style={body}>{d.flowName || <i style={placeholder}>Elige un flujo…</i>}</div>
    </Shell>
  );
}

/** Filas con una salida cada una (dividir, horario). */
function OutputRows({ id, rows, muted }: { id: string; rows: { id: string; label: string; color?: string }[]; muted?: string }) {
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateInternals(id);
  }, [rows.length, id, updateInternals]);
  return (
    <div style={{ padding: "4px 10px 8px" }}>
      {rows.map((r) => (
        <Row key={r.id}>
          <span style={{ ...branchText, color: r.color }}>{r.label}</span>
          <OutputHandle nodeId={id} handleId={r.id} position={Position.Right} color={r.color} top={ROW_H / 2} />
        </Row>
      ))}
      {muted && <i style={{ ...placeholder, fontSize: 11.5 }}>{muted}</i>}
    </div>
  );
}

/** Botones de respuesta: se escriben, añaden y quitan en el propio bloque. */
function ButtonRows({
  id,
  buttons,
  selected,
  max = 3,
  maxLength = 20,
  noun = "Botón",
}: {
  id: string;
  buttons: FlowButton[];
  selected?: boolean;
  max?: number;
  maxLength?: number;
  noun?: string;
}) {
  const actions = useContext(FlowActionsContext);
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateInternals(id);
  }, [buttons.length, id, updateInternals]);
  const editing = !!selected && !!actions;
  const set = (next: FlowButton[]) => actions?.patchNode(id, { buttons: next });
  return (
    <div style={{ padding: "4px 10px 8px" }}>
      {buttons.map((b, i) => (
        <Row key={b.id}>
          {editing ? (
            <>
              <input
                className="nodrag nopan flow-inline-input"
                value={b.title}
                maxLength={maxLength}
                placeholder={`${noun} ${i + 1}`}
                autoFocus={!b.title && i === 0}
                onChange={(e) => set(buttons.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") e.currentTarget.blur();
                }}
              />
              <button
                type="button"
                className="nodrag nopan flow-row-x"
                title={`Quitar ${noun.toLowerCase()}`}
                onClick={(e) => {
                  e.stopPropagation();
                  set(buttons.filter((_, j) => j !== i));
                }}
              >
                ×
              </button>
            </>
          ) : (
            <span style={branchText}>▢ {b.title || `${noun} ${i + 1}`}</span>
          )}
          <OutputHandle nodeId={id} handleId={b.id} position={Position.Right} top={ROW_H / 2} />
        </Row>
      ))}
      {editing && buttons.length < max && (
        <button
          type="button"
          className="nodrag nopan flow-row-add"
          onClick={(e) => {
            e.stopPropagation();
            set([...buttons, { id: `b${Date.now().toString(36)}`, title: "" }]);
          }}
        >
          + Añadir {noun.toLowerCase()}
        </button>
      )}
      <Row>
        <span style={{ ...branchText, color: "var(--muted)" }}>otra respuesta</span>
        <OutputHandle nodeId={id} handleId="else" position={Position.Right} color="var(--muted)" top={ROW_H / 2} />
      </Row>
    </div>
  );
}

export function ButtonsNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="buttons" selected={selected}>
      <InputHandle />
      <Head type="buttons" />
      <div style={{ ...body, paddingBottom: 2 }}>
        <MediaSlot nodeId={id} data={d} selected={selected} accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,.pdf,.doc,.docx,.xls,.xlsx" label="Imagen, video o archivo arriba" />
        <InlineText nodeId={id} value={d.text ?? ""} placeholder="Escribe el mensaje…" selected={selected} maxLength={1024} />
      </div>
      <ButtonRows id={id} buttons={d.buttons ?? []} selected={selected} />
    </Shell>
  );
}

export function ListNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="list" selected={selected}>
      <InputHandle />
      <Head type="list" />
      <div style={{ ...body, paddingBottom: 2 }}>
        <InlineText nodeId={id} value={d.text ?? ""} placeholder="Escribe el mensaje…" selected={selected} maxLength={4096} />
        <div className="flow-list-btn">
          <NavIcon name="filter" size={11} />
          {d.listButton?.trim() || "Ver opciones"}
        </div>
      </div>
      <ButtonRows id={id} buttons={d.buttons ?? []} selected={selected} max={10} maxLength={24} noun="Opción" />
    </Shell>
  );
}

/** Carrusel: cada tarjeta con su miniatura; con respuestas, cada una es una salida. */
export function CarouselNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const cards = d.cards ?? [];
  const reply = (d.cardMode ?? "reply") === "reply";
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateInternals(id);
  }, [cards.length, reply, id, updateInternals]);
  return (
    <Shell id={id} type="carousel" selected={selected}>
      <InputHandle />
      <Head type="carousel" />
      <div style={{ ...body, paddingBottom: 2 }}>
        <InlineText nodeId={id} value={d.text ?? ""} placeholder="Texto sobre el carrusel…" selected={selected} maxLength={1024} />
      </div>
      <div style={{ padding: "4px 10px 8px" }}>
        {cards.map((c, i) => {
          const src = c.mediaUrl && c.mediaKind !== "VIDEO" ? mediaSrc(c.mediaUrl) : null;
          return (
            <Row key={c.id}>
              <span className="flow-card-row">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" className="flow-card-thumb" />
                ) : (
                  <span className="flow-card-thumb flow-card-thumb--empty">
                    <NavIcon name={c.mediaKind === "VIDEO" ? "video" : "image"} size={11} />
                  </span>
                )}
                <span style={branchText}>{c.text?.trim() || c.buttonTitle || `Tarjeta ${i + 1}`}</span>
              </span>
              {reply && <OutputHandle nodeId={id} handleId={c.id} position={Position.Right} top={ROW_H / 2} />}
            </Row>
          );
        })}
        {reply ? (
          <Row>
            <span style={{ ...branchText, color: "var(--muted)" }}>otra respuesta</span>
            <OutputHandle nodeId={id} handleId="else" position={Position.Right} color="var(--muted)" top={ROW_H / 2} />
          </Row>
        ) : (
          <div style={{ ...placeholder, fontSize: 11 }}>Botones con enlace: sigue sin esperar.</div>
        )}
      </div>
      {!reply && <OutputHandle nodeId={id} />}
    </Shell>
  );
}

/**
 * El adjunto de un mensaje (o el encabezado de unos botones), en la propia
 * cajita: se ve lo que lleva y, con el bloque elegido, se adjunta o se quita
 * sin ir al panel.
 */
function MediaSlot({ nodeId, data, selected, accept, label }: { nodeId: string; data: FlowNodeData; selected?: boolean; accept: string; label: string }) {
  const actions = useContext(FlowActionsContext);
  const [busy, setBusy] = useState(false);
  const meta = data.mediaKind ? MEDIA_META[data.mediaKind] : null;
  const src = data.mediaUrl && data.mediaKind === "IMAGE" ? mediaSrc(data.mediaUrl) : null;
  async function pick(file: File | undefined) {
    if (!file || !actions) return;
    setBusy(true);
    try {
      const up = await uploadMedia(file);
      actions.patchNode(nodeId, { mediaUrl: up.mediaUrl, mediaKind: up.kind, mediaName: up.fileName });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (data.mediaUrl && meta) {
    return (
      <div className="flow-media">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="flow-media__img" />
        ) : (
          <span className="flow-media__icon">
            <NavIcon name={meta.icon} size={13} />
          </span>
        )}
        <span className="flow-media__name">{data.mediaName || meta.label}</span>
        {selected && actions && (
          <button
            type="button"
            className="nodrag nopan flow-row-x"
            title="Quitar adjunto"
            onClick={(e) => {
              e.stopPropagation();
              actions.patchNode(nodeId, { mediaUrl: undefined, mediaKind: undefined, mediaName: undefined });
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  }
  if (!selected || !actions) return null;
  return (
    <label className="nodrag nopan flow-media-add" onClick={(e) => e.stopPropagation()}>
      <NavIcon name="paperclip" size={12} />
      {busy ? "Subiendo…" : label}
      <input type="file" accept={accept} disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
    </label>
  );
}

export function SetFieldNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="setField" selected={selected}>
      <InputHandle />
      <Head type="setField" />
      <div style={body}>
        {d.fieldKey ? (
          <>
            <span style={{ color: "var(--accent-text)" }}>{d.fieldKey === "name" ? "Nombre" : d.fieldKey}</span> ={" "}
            {d.value || <i style={placeholder}>vacío</i>}
          </>
        ) : (
          <i style={placeholder}>Elige un campo…</i>
        )}
      </div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function AddNoteNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="addNote" selected={selected}>
      <InputHandle />
      <Head type="addNote" />
      <div style={body}>
        <InlineText nodeId={id} value={d.text ?? ""} placeholder="Escribe la nota…" selected={selected} maxLength={1000} />
      </div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function SetStatusNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <Shell id={id} type="setStatus" selected={selected} minWidth={160}>
      <InputHandle />
      <Head type="setStatus" />
      <div style={body}>{d.status ? STATUS_LABEL[d.status] : <i style={placeholder}>Elige un estado…</i>}</div>
      <OutputHandle nodeId={id} />
    </Shell>
  );
}

export function SplitNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const splits = d.splits ?? [];
  return (
    <Shell id={id} type="split" selected={selected}>
      <InputHandle />
      <Head type="split" />
      <OutputRows id={id} rows={splits.map((s) => ({ id: s.id, label: `${s.label || s.id} · ${s.weight}%` }))} muted={splits.length ? undefined : "Añade variantes en el panel…"} />
    </Shell>
  );
}

export function ScheduleNode({ id, data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const open = d.hours ? Object.values(d.hours.days ?? {}).filter(Boolean).length : 0;
  return (
    <Shell id={id} type="schedule" selected={selected}>
      <InputHandle />
      <Head type="schedule" />
      <div style={{ ...body, paddingBottom: 2, fontSize: 11.5 }}>
        {d.hours ? `${open} día${open === 1 ? "" : "s"} · ${d.hours.timezone}` : <i style={placeholder}>Sin horario…</i>}
      </div>
      <OutputRows
        id={id}
        rows={[
          { id: "in", label: "en horario", color: "var(--positive)" },
          { id: "out", label: "fuera de horario", color: "var(--warning)" },
        ]}
      />
    </Shell>
  );
}

export const nodeTypes = {
  start: StartNode,
  buttons: ButtonsNode,
  list: ListNode,
  carousel: CarouselNode,
  setField: SetFieldNode,
  addNote: AddNoteNode,
  setStatus: SetStatusNode,
  split: SplitNode,
  schedule: ScheduleNode,
  sendMessage: SendMessageNode,
  sendTemplate: SendTemplateNode,
  sendEmail: SendEmailNode,
  askQuestion: AskQuestionNode,
  condition: ConditionNode,
  action: ActionNode,
  delay: DelayNode,
  http: HttpNode,
  assign: AssignNode,
  jumpToFlow: JumpToFlowNode,
};

// ── Estilos ───────────────────────────────────────────────────

function shell(selected: boolean, color: string, minWidth = 220): React.CSSProperties {
  return {
    position: "relative",
    minWidth,
    maxWidth: 280,
    borderRadius: 10,
    border: `1.5px solid ${selected ? "var(--accent)" : color}`,
    background: "var(--panel-2)",
    color: "var(--text)",
    fontSize: 12,
    boxShadow: selected ? "0 0 0 3px rgba(11, 108, 216, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35)" : "0 2px 10px rgba(0, 0, 0, 0.25)",
    transition: "box-shadow 0.12s ease, border-color 0.12s ease",
  };
}

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "7px 10px",
  borderBottom: "1px solid rgba(154, 185, 194, 0.07)",
  fontWeight: 700,
  fontSize: 12,
};

const body: React.CSSProperties = {
  padding: "8px 10px",
  color: "var(--muted)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  lineHeight: 1.45,
};

// La salida va pegada al borde del bloque: la fila se sale del relleno
// lateral y deja hueco al texto para no pisar el punto.
const rowStyle: React.CSSProperties = {
  position: "relative",
  height: ROW_H,
  display: "flex",
  alignItems: "center",
  marginRight: -10,
  paddingRight: 18,
};

const branchText: React.CSSProperties = {
  fontSize: 11,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  paddingRight: 6,
};

const toolbar: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 4,
  borderRadius: 8,
  background: "var(--field)",
  border: "1px solid var(--border)",
  boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
};

const toolBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 8px",
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "var(--text)",
  fontSize: 12,
  cursor: "pointer",
};

const issueDot: React.CSSProperties = {
  position: "absolute",
  top: -8,
  right: -8,
  width: 18,
  height: 18,
  borderRadius: "50%",
  background: "#b8562a",
  color: "#fff",
  fontSize: 11,
  fontWeight: 800,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 1px 4px rgba(0, 0, 0, 0.4)",
  cursor: "help",
  zIndex: 6,
};
