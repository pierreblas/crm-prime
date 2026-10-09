import { createContext } from "react";
import type { FlowBranch, FlowNodeData, FlowNodeType, FlowRule, FlowTriggerType } from "@crm/shared";
import type { IconName } from "@/components/NavIcons";

export interface NodeMeta {
  type: FlowNodeType;
  label: string;
  icon: IconName;
  /** Una línea para el menú de añadir. */
  hint: string;
  /** Borde del bloque. */
  color: string;
  /** Icono y título del bloque. */
  accent: string;
  /** Grupo de la paleta. */
  group: "Mensajes" | "Lógica" | "CRM" | "Integraciones";
}

/** Qué dato extra pide cada disparador en la cabecera del editor. */
export type TriggerNeeds = "keywords" | "tags" | "stages" | "forms" | "hours" | null;

export interface TriggerMeta {
  type: FlowTriggerType;
  label: string;
  /** Etiqueta corta para la lista de flujos. */
  short: string;
  hint: string;
  icon: IconName;
  needs: TriggerNeeds;
}

// Cuándo puede arrancar un flujo. El orden es el del selector.
export const TRIGGER_META: TriggerMeta[] = [
  { type: "conversation_start", label: "Al iniciar un chat", short: "al iniciar chat", hint: "Cuando un contacto escribe por primera vez o abre una conversación nueva.", icon: "message", needs: null },
  { type: "keyword", label: "Por palabra clave", short: "palabra clave", hint: "Cuando un mensaje del contacto contiene alguna de estas palabras.", icon: "search", needs: "keywords" },
  { type: "ad_click", label: "Llega desde un anuncio", short: "desde anuncio", hint: "Cuando la conversación nace de un anuncio Click to WhatsApp de Meta.", icon: "megaphone", needs: null },
  { type: "meta_lead", label: "Nuevo lead de Meta Ads (formulario)", short: "lead de Meta", hint: "Cuando entra un lead de un formulario de Meta Lead Ads. El lead aún no te escribió: para hablarle usa el bloque «Enviar plantilla».", icon: "target", needs: "forms" },
  { type: "lead_webhook", label: "Nuevo lead por API o formulario web", short: "lead por API", hint: "Cuando entra un lead por el webhook de leads o la API (tu web, n8n, Zapier…). Para escribirle usa «Enviar plantilla».", icon: "plug", needs: null },
  { type: "tag_added", label: "Se le pone una etiqueta", short: "etiqueta", hint: "Cuando alguien, la IA u otro flujo etiqueta al contacto.", icon: "tag", needs: "tags" },
  { type: "deal_stage", label: "Cambia de etapa en el embudo", short: "cambio de etapa", hint: "Cuando su oportunidad se mueve a una etapa (a mano, por la IA o por otro flujo).", icon: "pipeline", needs: "stages" },
  { type: "conversation_closed", label: "Se cierra la conversación", short: "al cerrar", hint: "Cuando tu equipo cierra la conversación. Ideal para una encuesta o una despedida.", icon: "check", needs: null },
  { type: "no_reply", label: "El cliente no responde", short: "sin respuesta", hint: "Cuando pasan estas horas sin que el cliente conteste a tu último mensaje. Se dispara una vez por silencio.", icon: "hourglass", needs: "hours" },
  { type: "missed_call", label: "Llamada perdida", short: "llamada perdida", hint: "Cuando alguien llama al número de la empresa (Twilio) y nadie contesta. Ideal para escribirle por WhatsApp.", icon: "phone", needs: null },
  { type: "manual", label: "Solo desde una etapa del embudo", short: "desde el embudo", hint: "No arranca solo: lo ejecutan las automatizaciones de una etapa (Ajustes › Embudos y etapas): al entrar en la etapa, al escribir el cliente, por webhook o tras un silencio.", icon: "pipeline", needs: null },
];

export const TRIGGER_BY_TYPE: Record<string, TriggerMeta> = Object.fromEntries(TRIGGER_META.map((t) => [t.type, t]));

// Catálogo de bloques que se pueden añadir (paleta, menú "+" y arrastre).
export const NODE_PALETTE: NodeMeta[] = [
  { type: "sendMessage", label: "Enviar mensaje", icon: "message", hint: "Texto, con imagen o archivo opcional", color: "#2c4b7a", accent: "var(--accent-text)", group: "Mensajes" },
  { type: "buttons", label: "Botones", icon: "buttons", hint: "Mensaje con hasta 3 botones; cada uno es una salida", color: "#2c5f7a", accent: "#8fc8e8", group: "Mensajes" },
  { type: "askQuestion", label: "Preguntar y guardar", icon: "question", hint: "Espera la respuesta, la valida y la guarda en una variable", color: "#7a5fb0", accent: "#cbb6ff", group: "Mensajes" },
  { type: "sendTemplate", label: "Enviar plantilla", icon: "template", hint: "Una plantilla aprobada por Meta: sirve aunque el contacto no haya escrito", color: "#2c6b7a", accent: "#8fd9e8", group: "Mensajes" },
  { type: "condition", label: "Condición", icon: "branch", hint: "Ramifica según palabras clave", color: "#b08a3f", accent: "#ffd98a", group: "Lógica" },
  { type: "schedule", label: "Horario", icon: "clock", hint: "En horario de atención o fuera de él", color: "#8a6f3f", accent: "#ffcf8a", group: "Lógica" },
  { type: "split", label: "Dividir al azar", icon: "flask", hint: "Reparte entre variantes (A/B)", color: "#8a3f6f", accent: "#ffa8d6", group: "Lógica" },
  { type: "delay", label: "Esperar", icon: "hourglass", hint: "Pausa antes de seguir", color: "#7a6f4a", accent: "#e8d79a", group: "Lógica" },
  { type: "action", label: "Acción", icon: "bolt", hint: "IA, humano, etiquetas, oportunidad", color: "#3f8c6e", accent: "#8fe6c0", group: "CRM" },
  { type: "setField", label: "Guardar en el contacto", icon: "pencil", hint: "Nombre o un campo personalizado", color: "#3f7a8c", accent: "#8fd6e6", group: "CRM" },
  { type: "addNote", label: "Nota interna", icon: "note", hint: "Para el equipo; el cliente no la ve", color: "#6f6f3f", accent: "#e6e68f", group: "CRM" },
  { type: "setStatus", label: "Estado del chat", icon: "inbox-check", hint: "Abierto, pendiente o cerrado", color: "#5a6b85", accent: "#c3d0e6", group: "CRM" },
  { type: "assign", label: "Asignar a agente", icon: "user", hint: "Reparte la conversación", color: "#6a4a7a", accent: "#d6b6e8", group: "CRM" },
  { type: "http", label: "Petición HTTP", icon: "globe", hint: "Llama a una API o a n8n", color: "#4a6f7a", accent: "#9ad8e8", group: "Integraciones" },
  { type: "jumpToFlow", label: "Ir a otro flujo", icon: "jump", hint: "Continúa en otro flujo", color: "#3f8c6e", accent: "#8fe6c0", group: "Integraciones" },
];

export const PALETTE_GROUPS: NodeMeta["group"][] = ["Mensajes", "Lógica", "CRM", "Integraciones"];

// Metadatos por tipo, incluido el inicio (que no está en la paleta).
export const NODE_META: Record<string, NodeMeta> = Object.fromEntries([
  ["start", { type: "start", label: "Inicio", icon: "play", hint: "Donde arranca el flujo", color: "#1f6f46", accent: "#7ee2a8", group: "Lógica" }],
  ...NODE_PALETTE.map((m) => [m.type, m]),
]) as Record<string, NodeMeta>;

export const ACTION_LABEL: Record<string, string> = {
  ai: "Pasar a agente IA",
  handoff: "Pasar a humano",
  tag: "Poner etiqueta",
  untag: "Quitar etiqueta",
  move_deal: "Mover en el embudo",
  create_deal: "Crear oportunidad",
};

export const STATUS_LABEL: Record<string, string> = {
  OPEN: "Abierta",
  PENDING: "Pendiente",
  CLOSED: "Cerrada",
};

export const VALIDATION_LABEL: Record<string, string> = {
  any: "Cualquier respuesta",
  phone: "Un teléfono",
  email: "Un correo",
  number: "Un número",
  regex: "Un patrón (regex)",
};

// ── Condición: campos y operadores ─────────────────────────────
export type RuleKind = "text" | "number" | "enum" | "bool";
export interface ConditionFieldMeta {
  field: FlowRule["field"];
  label: string;
  group: "Mensaje del cliente" | "Contacto" | "Conversación" | "Embudo";
  kind: RuleKind;
  /** Pide una clave extra: nombre de variable o clave de campo. */
  needsKey?: "variable" | "field";
}
export const CONDITION_FIELDS: ConditionFieldMeta[] = [
  { field: "message", label: "El mensaje del cliente", group: "Mensaje del cliente", kind: "text" },
  { field: "variable", label: "Una variable guardada", group: "Mensaje del cliente", kind: "text", needsKey: "variable" },
  { field: "contact_name", label: "Nombre del contacto", group: "Contacto", kind: "text" },
  { field: "contact_phone", label: "Teléfono del contacto", group: "Contacto", kind: "text" },
  { field: "contact_field", label: "Un campo del contacto", group: "Contacto", kind: "text", needsKey: "field" },
  { field: "tag", label: "Etiqueta del contacto", group: "Contacto", kind: "enum" },
  { field: "source", label: "Fuente del contacto", group: "Contacto", kind: "enum" },
  { field: "status", label: "Estado de la conversación", group: "Conversación", kind: "enum" },
  { field: "assigned", label: "Asignada a", group: "Conversación", kind: "enum" },
  { field: "ai_mode", label: "Modo de la IA", group: "Conversación", kind: "enum" },
  { field: "channel", label: "Número de WhatsApp", group: "Conversación", kind: "enum" },
  { field: "is_new", label: "Es su primer mensaje", group: "Conversación", kind: "bool" },
  { field: "messages_count", label: "Mensajes que ha enviado", group: "Conversación", kind: "number" },
  { field: "stage", label: "Etapa de su oportunidad", group: "Embudo", kind: "enum" },
];
export const CONDITION_FIELD_BY: Record<string, ConditionFieldMeta> = Object.fromEntries(CONDITION_FIELDS.map((f) => [f.field, f]));
export const CONDITION_GROUPS: ConditionFieldMeta["group"][] = ["Mensaje del cliente", "Contacto", "Conversación", "Embudo"];

export const OP_LABEL: Record<FlowRule["op"], string> = {
  contains: "contiene",
  not_contains: "no contiene",
  equals: "es igual a",
  not_equals: "no es igual a",
  starts_with: "empieza por",
  regex: "coincide con (regex)",
  empty: "está vacío",
  not_empty: "no está vacío",
  gt: "es mayor que",
  lt: "es menor que",
  is: "es",
  is_not: "no es",
};
export const OPS_BY_KIND: Record<RuleKind, FlowRule["op"][]> = {
  text: ["contains", "not_contains", "equals", "not_equals", "starts_with", "regex", "empty", "not_empty", "gt", "lt"],
  number: ["equals", "gt", "lt"],
  enum: ["is", "is_not"],
  bool: ["is"],
};
export const AI_MODE_LABEL: Record<string, string> = { OFF: "Apagada", COPILOT: "Copilot", AUTOPILOT: "Autopilot" };

/** Reglas efectivas de una rama (las palabras clave antiguas valen como «mensaje contiene»). */
export function rulesOf(b: FlowBranch): FlowRule[] {
  if (b.rules?.length) return b.rules;
  if (b.keywords?.length) return [{ id: "legacy", field: "message", op: "contains", value: b.keywords.join(", ") }];
  return [];
}

/** Resumen corto de una regla, para el lienzo y las conexiones. */
export function ruleSummary(r: FlowRule, names?: (field: FlowRule["field"], value: string) => string | undefined): string {
  const f = CONDITION_FIELD_BY[r.field]?.label.toLowerCase() ?? r.field;
  const key = r.key ? ` ${r.key}` : "";
  if (r.op === "empty" || r.op === "not_empty") return `${f}${key} ${OP_LABEL[r.op]}`;
  if (r.field === "is_new") return r.value === "no" ? "no es su primer mensaje" : "es su primer mensaje";
  const v = names?.(r.field, r.value ?? "") ?? r.value ?? "";
  return `${f}${key} ${OP_LABEL[r.op]} ${v}`.trim();
}

export function branchTitle(b: FlowBranch): string {
  if (b.label) return b.label;
  const rules = rulesOf(b);
  if (!rules.length) return "rama";
  return ruleSummary(rules[0]!) + (rules.length > 1 ? ` (+${rules.length - 1})` : "");
}

/** Horario de oficina por defecto para el bloque «Horario». */
export function defaultHours(): NonNullable<FlowNodeData["hours"]> {
  const day = { from: "09:00", to: "18:00" };
  return {
    timezone: "America/Lima",
    days: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null },
  };
}

export function defaultNodeData(type: FlowNodeType): FlowNodeData {
  switch (type) {
    case "sendMessage":
      return { text: "" };
    case "sendTemplate":
      return { templateId: "" };
    case "askQuestion":
      return { text: "", variable: "", validate: "any", maxRetries: 2 };
    case "buttons":
      return { text: "", buttons: [{ id: "b1", title: "" }, { id: "b2", title: "" }] };
    case "condition":
      return { branches: [] };
    case "action":
      return { action: "ai", botId: null };
    case "delay":
      return { delayValue: 5, delayUnit: "minutes" };
    case "http":
      return { method: "POST", url: "" };
    case "assign":
      return { agentId: null };
    case "setField":
      return { fieldKey: "name", value: "" };
    case "addNote":
      return { text: "" };
    case "setStatus":
      return { status: "PENDING" };
    case "split":
      return { splits: [{ id: "a", label: "A", weight: 50 }, { id: "b", label: "B", weight: 50 }] };
    case "schedule":
      return { hours: defaultHours() };
    default:
      return {};
  }
}

/** Tipo MIME del arrastre desde la paleta al lienzo. */
export const DRAG_MIME = "application/x-driony-flow-node";

/** Una salida de un bloque: el handle (null = la salida por defecto) y cómo se llama. */
export interface NodeOutput {
  id: string | null;
  label: string;
}

/**
 * Las salidas de un bloque, en el orden en que se dibujan. Lo usan la
 * colocación automática, las etiquetas de las conexiones y la inserción en
 * medio de una conexión.
 */
export function outputsOf(type: string | undefined, data: FlowNodeData | undefined): NodeOutput[] {
  const d = data ?? {};
  switch (type) {
    case "condition":
      return [
        ...(d.branches ?? []).map((b) => ({ id: b.id, label: branchTitle(b) })),
        { id: "else", label: "en otro caso" },
      ];
    case "buttons":
      return [
        ...(d.buttons ?? []).map((b, i) => ({ id: b.id, label: b.title || `botón ${i + 1}` })),
        { id: "else", label: "otra respuesta" },
      ];
    case "split":
      return (d.splits ?? []).map((s) => ({ id: s.id, label: `${s.label || s.id} · ${s.weight}%` }));
    case "schedule":
      return [
        { id: "in", label: "en horario" },
        { id: "out", label: "fuera de horario" },
      ];
    case "askQuestion":
      return d.validate && d.validate !== "any"
        ? [
            { id: null, label: "respuesta válida" },
            { id: "invalid", label: "no válida" },
          ]
        : [{ id: null, label: "" }];
    case "jumpToFlow":
      return [];
    default:
      return [{ id: null, label: "" }];
  }
}

/** Bloques con una salida "por defecto" (sin handle). */
export function hasDefaultOutput(type: string | undefined): boolean {
  return !["condition", "jumpToFlow", "buttons", "split", "schedule"].includes(type ?? "");
}

/** Petición de añadir un bloque: tras una salida, o en medio de una conexión. */
export interface AddRequest {
  /** Salida de la que cuelga el bloque nuevo; sin ella, el bloque queda suelto. */
  sourceId?: string | null;
  sourceHandle?: string | null;
  /** Conexión que se parte: el bloque nuevo queda entre `sourceId` y este nodo. */
  insertBefore?: string;
  /** Punto de pantalla donde anclar el menú. */
  anchor: { x: number; y: number };
  /** Dónde colocar el bloque (coordenadas del lienzo): al soltar una conexión en el vacío. */
  at?: { x: number; y: number };
}

// Lo que los bloques y las conexiones pueden pedirle al constructor.
export interface FlowActions {
  openAddMenu: (req: AddRequest) => void;
  /** Si esa salida (nodo + handle) ya tiene una conexión. */
  isOutgoingTaken: (sourceId: string, sourceHandle?: string | null) => boolean;
  removeEdge: (edgeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  issuesFor: (nodeId: string) => string[];
  /** Edición en el propio bloque (texto, botones…). */
  patchNode: (nodeId: string, patch: Partial<FlowNodeData>) => void;
}

export const FlowActionsContext = createContext<FlowActions | null>(null);

// Clave única de una salida (nodo + handle). Handle vacío = salida por defecto.
export function outgoingKey(sourceId: string, sourceHandle?: string | null): string {
  return `${sourceId}::${sourceHandle ?? ""}`;
}
