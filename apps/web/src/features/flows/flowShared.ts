import { createContext } from "react";
import { EMPTY_TRIGGER_CONFIG, type FlowBranch, type FlowNodeData, type FlowNodeType, type FlowRule, type FlowTrigger, type FlowTriggerType } from "@crm/shared";
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

/** Qué dato extra pide cada disparador en el panel de «Inicio». */
export type TriggerNeeds = "keywords" | "tags" | "stages" | "forms" | "hours" | "cooldown" | null;

export interface TriggerMeta {
  type: FlowTrigger["type"];
  label: string;
  /** Etiqueta corta para la lista de flujos. */
  short: string;
  hint: string;
  icon: IconName;
  needs: TriggerNeeds;
  /** Grupo del menú «Añadir disparador». */
  group: TriggerGroup;
}

export const TRIGGER_GROUPS = ["Conversación", "Contacto y embudo", "Leads", "Agenda", "Llamadas"] as const;
export type TriggerGroup = (typeof TRIGGER_GROUPS)[number];

// Cuándo puede arrancar un flujo. El orden es el del selector.
export const TRIGGER_META: TriggerMeta[] = [
  { type: "conversation_start", label: "Al iniciar un chat", short: "al iniciar chat", hint: "Cuando empieza una conversación nueva: el primer mensaje de un contacto, o el primero después de cerrar su chat anterior. No se dispara con cada mensaje de un chat abierto (para eso, «Por palabra clave»). Si ese primer mensaje trae una palabra clave de otro flujo, arranca ese.", icon: "message", needs: null, group: "Conversación" },
  { type: "inbound_message", label: "Llega un mensaje del cliente", short: "cada mensaje", hint: "Con cada mensaje que escribe el cliente (sin palabras concretas), como mucho una vez cada cierto tiempo por conversación. Úsalo con condiciones: por ejemplo, solo si está en una etapa o tiene una etiqueta.", icon: "reply", needs: "cooldown", group: "Conversación" },
  { type: "keyword", label: "Por palabra clave", short: "palabra clave", hint: "Cuando un mensaje del contacto contiene alguna de estas palabras, sin importar tildes ni mayúsculas. Gana a «Al iniciar un chat» y a un flujo a medias de otro tema.", icon: "search", needs: "keywords", group: "Conversación" },
  { type: "ad_click", label: "Llega desde un anuncio", short: "desde anuncio", hint: "Cuando el cliente escribe tras tocar un anuncio Click to WhatsApp de Meta: al abrir el chat, o si vuelve por otro anuncio con el chat abierto.", icon: "megaphone", needs: null, group: "Conversación" },
  { type: "meta_lead", label: "Nuevo lead de Meta Ads (formulario)", short: "lead de Meta", hint: "Cuando entra un lead de un formulario de Meta Lead Ads. El lead aún no te escribió: para hablarle usa el bloque «Enviar plantilla».", icon: "target", needs: "forms", group: "Leads" },
  { type: "lead_webhook", label: "Nuevo lead por API o formulario web", short: "lead por API", hint: "Cuando entra un lead por el webhook de leads o la API (tu web, n8n, Zapier…). Para escribirle usa «Enviar plantilla».", icon: "plug", needs: null, group: "Leads" },
  { type: "tag_added", label: "Se le pone una etiqueta", short: "etiqueta", hint: "Cuando alguien, la IA u otro flujo etiqueta al contacto.", icon: "tag", needs: "tags", group: "Contacto y embudo" },
  { type: "tag_removed", label: "Se le quita una etiqueta", short: "etiqueta quitada", hint: "Cuando alguien, la IA u otro flujo le quita una etiqueta al contacto.", icon: "x", needs: "tags", group: "Contacto y embudo" },
  { type: "owner_changed", label: "Cambia el responsable", short: "cambio de responsable", hint: "Cuando cambia el responsable (vendedor) de su oportunidad: a mano, en bloque o por la IA. Con la condición «Responsable de su oportunidad» eliges de quién.", icon: "user", needs: null, group: "Contacto y embudo" },
  { type: "deal_stage", label: "Cambia de etapa en el embudo", short: "cambio de etapa", hint: "Cuando su oportunidad se mueve a una etapa (a mano, por la IA o por otro flujo).", icon: "pipeline", needs: "stages", group: "Contacto y embudo" },
  { type: "conversation_closed", label: "Se cierra la conversación", short: "al cerrar", hint: "Cuando tu equipo cierra la conversación. Ideal para una encuesta o una despedida.", icon: "check", needs: null, group: "Conversación" },
  { type: "no_reply", label: "El cliente no responde", short: "sin respuesta", hint: "Cuando pasan estas horas sin que el cliente conteste a tu último mensaje. Se dispara una vez por silencio.", icon: "hourglass", needs: "hours", group: "Conversación" },
  { type: "missed_call", label: "Llamada perdida", short: "llamada perdida", hint: "Cuando alguien llama al número de la empresa (Twilio) y nadie contesta. Ideal para escribirle por WhatsApp.", icon: "phone", needs: null, group: "Llamadas" },
  { type: "booking_created", label: "Se le reserva una cita", short: "cita reservada", hint: "Cuando se le reserva una cita: desde la agenda, por el agente de IA o por el enlace de reservas. Los avisos de confirmación y recordatorio de Ajustes › Agenda salen igual; esto es para lo demás (indicaciones, cómo llegar, qué traer). Fuera de las 24 h usa «Enviar plantilla».", icon: "calendar", needs: null, group: "Agenda" },
  { type: "booking_cancelled", label: "Se cancela su cita", short: "cita cancelada", hint: "Cuando se cancela su cita, la cancele el equipo, el agente de IA o el propio cliente desde el recordatorio. Por ejemplo, para ofrecerle otra hora.", icon: "calendar", needs: null, group: "Agenda" },
];

export const TRIGGER_BY_TYPE: Record<string, TriggerMeta> = Object.fromEntries(TRIGGER_META.map((t) => [t.type, t]));

/** Un disparador nuevo de ese tipo, sin filtros. */
export function newTrigger(type: FlowTrigger["type"]): FlowTrigger {
  return {
    id: `trg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type,
    keywords: [],
    config: { ...EMPTY_TRIGGER_CONFIG },
    conditions: { match: "all", rules: [] },
    delayMin: 0,
    activeHours: null,
  };
}

/** Lo que concreta un disparador, en una línea: «hola, info», «VIP», «tras 24 h». */
export function triggerDetail(t: FlowTrigger, stageName: (id: string) => string): string {
  switch (t.type) {
    case "keyword":
      return t.keywords.length ? t.keywords.map((k) => `«${k}»`).join(", ") : "sin palabras";
    case "tag_added":
    case "tag_removed":
      return t.config.tags.length ? t.config.tags.join(", ") : "cualquier etiqueta";
    case "inbound_message":
      return `pausa ${minutesLabel(t.config.cooldownMin)}`;
    case "deal_stage":
      return t.config.stageIds.length ? t.config.stageIds.map(stageName).join(", ") : "cualquier etapa";
    case "meta_lead":
      return t.config.forms.length ? t.config.forms.join(", ") : "cualquier formulario";
    case "no_reply":
      return `tras ${t.config.hours} h`;
    default:
      return "";
  }
}

export const DAY_LABEL: Record<string, string> = { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" };

/** «5 min», «2 h», «1 día». */
export function minutesLabel(m: number): string {
  if (m % 1440 === 0) return m === 1440 ? "1 día" : `${m / 1440} días`;
  if (m % 60 === 0) return `${m / 60} h`;
  return `${m} min`;
}

/** Lo que añade un disparador además de su evento: espera, condiciones, horario. */
export function triggerExtras(t: FlowTrigger): string[] {
  const out: string[] = [];
  if (t.delayMin > 0) out.push(`a los ${minutesLabel(t.delayMin)}`);
  const n = t.conditions.rules.length;
  if (n) out.push(n === 1 ? "1 condición" : `${n} condiciones`);
  if (t.activeHours) out.push("en horario");
  return out;
}

/** Para la lista de flujos: «palabra clave + 2 más» o «solo desde el embudo». */
export function triggersShort(types: FlowTriggerType[]): string {
  if (!types.length) return "solo desde el embudo";
  const first = TRIGGER_BY_TYPE[types[0]!]?.short ?? types[0]!;
  return types.length > 1 ? `${first} + ${types.length - 1} más` : first;
}

// Catálogo de bloques que se pueden añadir (paleta, menú "+" y arrastre).
export const NODE_PALETTE: NodeMeta[] = [
  { type: "sendMessage", label: "Enviar mensaje", icon: "message", hint: "Texto, con imagen o archivo opcional", color: "#2c4b7a", accent: "var(--accent-text)", group: "Mensajes" },
  { type: "buttons", label: "Botones", icon: "buttons", hint: "Mensaje con hasta 3 botones; cada uno es una salida", color: "#2c5f7a", accent: "#8fc8e8", group: "Mensajes" },
  { type: "list", label: "Lista de opciones", icon: "filter", hint: "Un botón que abre hasta 10 opciones; cada una es una salida", color: "#2c5f7a", accent: "#8fc8e8", group: "Mensajes" },
  { type: "carousel", label: "Carrusel", icon: "image", hint: "De 2 a 10 tarjetas con imagen o video, texto y un botón", color: "#2c5f7a", accent: "#8fc8e8", group: "Mensajes" },
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
  /** Pide una clave extra: nombre de variable, clave de campo o qué UTM. */
  needsKey?: "variable" | "field" | "utm";
}
export const CONDITION_FIELDS: ConditionFieldMeta[] = [
  { field: "message", label: "El mensaje del cliente", group: "Mensaje del cliente", kind: "text" },
  { field: "variable", label: "Una variable guardada", group: "Mensaje del cliente", kind: "text", needsKey: "variable" },
  { field: "contact_name", label: "Nombre del contacto", group: "Contacto", kind: "text" },
  { field: "contact_phone", label: "Teléfono del contacto", group: "Contacto", kind: "text" },
  { field: "country", label: "País del contacto", group: "Contacto", kind: "enum" },
  { field: "contact_field", label: "Un campo del contacto", group: "Contacto", kind: "text", needsKey: "field" },
  { field: "utm", label: "UTM con que llegó", group: "Contacto", kind: "text", needsKey: "utm" },
  { field: "tag", label: "Etiqueta del contacto", group: "Contacto", kind: "enum" },
  { field: "source", label: "Fuente del contacto", group: "Contacto", kind: "enum" },
  { field: "status", label: "Estado de la conversación", group: "Conversación", kind: "enum" },
  { field: "assigned", label: "Asignada a", group: "Conversación", kind: "enum" },
  { field: "ai_mode", label: "Modo de la IA", group: "Conversación", kind: "enum" },
  { field: "channel", label: "Número de WhatsApp", group: "Conversación", kind: "enum" },
  { field: "is_new", label: "Es su primer mensaje", group: "Conversación", kind: "bool" },
  { field: "messages_count", label: "Mensajes que ha enviado", group: "Conversación", kind: "number" },
  { field: "stage", label: "Etapa de su oportunidad", group: "Embudo", kind: "enum" },
  { field: "deal_value", label: "Valor de su oportunidad", group: "Embudo", kind: "number" },
  { field: "deal_owner", label: "Responsable de su oportunidad", group: "Embudo", kind: "enum" },
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
    case "list":
      return { text: "", listButton: "Ver opciones", buttons: [{ id: "o1", title: "" }, { id: "o2", title: "" }, { id: "o3", title: "" }] };
    case "carousel":
      return {
        text: "",
        cardMode: "reply",
        cards: [
          { id: "c1", text: "", buttonTitle: "Elegir" },
          { id: "c2", text: "", buttonTitle: "Elegir" },
        ],
      };
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
    case "list":
      return [
        ...(d.buttons ?? []).map((b, i) => ({ id: b.id, label: b.title || `opción ${i + 1}` })),
        { id: "else", label: "otra respuesta" },
      ];
    case "carousel":
      return (d.cardMode ?? "reply") === "url"
        ? [{ id: null, label: "" }]
        : [
            ...(d.cards ?? []).map((c, i) => ({ id: c.id, label: c.text?.trim() || c.buttonTitle || `tarjeta ${i + 1}` })),
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
export function hasDefaultOutput(type: string | undefined, data?: FlowNodeData): boolean {
  if (type === "carousel") return (data?.cardMode ?? "reply") === "url";
  return !["condition", "jumpToFlow", "buttons", "list", "split", "schedule"].includes(type ?? "");
}

/** Icono y nombre de cada tipo de adjunto. */
export const MEDIA_META: Record<string, { icon: "image" | "video" | "mic" | "file"; label: string }> = {
  IMAGE: { icon: "image", label: "Imagen" },
  VIDEO: { icon: "video", label: "Video" },
  AUDIO: { icon: "mic", label: "Audio" },
  DOCUMENT: { icon: "file", label: "Documento" },
};

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
  /** Disparadores del flujo: el bloque «Inicio» los enseña. */
  triggers: FlowTrigger[];
  stageName: (id: string) => string;
}

export const FlowActionsContext = createContext<FlowActions | null>(null);

// Clave única de una salida (nodo + handle). Handle vacío = salida por defecto.
export function outgoingKey(sourceId: string, sourceHandle?: string | null): string {
  return `${sourceId}::${sourceHandle ?? ""}`;
}
