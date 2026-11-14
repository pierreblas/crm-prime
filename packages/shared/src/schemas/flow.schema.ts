import { z } from "zod";
import { businessHoursSchema } from "./agent-config.schema.js";
import { flowRuleSchema, ruleMatchModes } from "./condition.schema.js";
import { variableValueSchema } from "./template.schema.js";

// Tipos de nodo del constructor visual.
export const flowNodeTypes = [
  "start",
  "sendMessage",
  "askQuestion",
  "condition",
  "action",
  "delay",
  "http",
  "assign",
  "jumpToFlow",
  "sendTemplate",
  "buttons", // mensaje con botones de respuesta; cada botón es una salida
  "setField", // guardar un valor en la ficha del contacto
  "addNote", // nota interna en la conversación
  "setStatus", // abrir / pendiente / cerrar la conversación
  "split", // dividir al azar (A/B) entre varias salidas
  "schedule", // en horario / fuera de horario
  "list", // lista de opciones de WhatsApp (hasta 10); cada opción es una salida
  "carousel", // carrusel de 2 a 10 tarjetas con imagen o video
  "sendEmail", // correo con una plantilla, desde un buzón de la empresa
] as const;
export type FlowNodeType = (typeof flowNodeTypes)[number];

export const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof httpMethods)[number];

export const delayUnits = ["minutes", "hours"] as const;
export type DelayUnit = (typeof delayUnits)[number];

// Acciones del nodo "action".
export const flowActionTypes = ["ai", "handoff", "tag", "untag", "move_deal", "create_deal"] as const;
export type FlowActionType = (typeof flowActionTypes)[number];

// Validación de la respuesta en "askQuestion".
export const answerValidations = ["any", "phone", "email", "number", "regex"] as const;
export type AnswerValidation = (typeof answerValidations)[number];

// Botón de respuesta rápida (WhatsApp admite hasta 3, de 20 caracteres) u
// opción de una lista (hasta 10, de 24 caracteres y con descripción).
export const flowButtonSchema = z.object({
  id: z.string(),
  title: z.string().max(24),
  description: z.string().max(72).optional(),
});
export type FlowButton = z.infer<typeof flowButtonSchema>;

// Salida del nodo "split": peso relativo (porcentaje) de cada rama.
export const flowSplitSchema = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number().min(0).max(100),
});
export type FlowSplit = z.infer<typeof flowSplitSchema>;

// Tarjeta del carrusel: imagen o video, texto corto y un botón (respuesta o enlace).
export const flowCardSchema = z.object({
  id: z.string(),
  mediaUrl: z.string().optional(),
  mediaKind: z.enum(["IMAGE", "VIDEO"]).optional(),
  mediaName: z.string().optional(),
  text: z.string().max(160).optional(),
  buttonTitle: z.string().max(20).optional(),
  /** Solo en carrusel de enlaces. */
  url: z.string().max(2000).optional(),
});
export type FlowCard = z.infer<typeof flowCardSchema>;
export const MEDIA_KINDS = ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"] as const;

export const flowStatuses = ["OPEN", "PENDING", "CLOSED"] as const;

// Las reglas de «Condición» viven en condition.schema.ts (las comparte el agente).

// Rama del nodo "condition" (cada una es un sourceHandle de salida). Las
// `keywords` son el formato antiguo (mensaje contiene alguna); si hay
// `rules`, mandan ellas.
export const flowBranchSchema = z.object({
  id: z.string(),
  label: z.string(),
  keywords: z.array(z.string()).default([]),
  rules: z.array(flowRuleSchema).max(10).default([]),
  match: z.enum(["all", "any"]).default("all"),
});
export type FlowBranch = z.infer<typeof flowBranchSchema>;

// data del nodo: flexible pero acotado por campos conocidos.
export const flowNodeDataSchema = z.object({
  // sendMessage / askQuestion
  text: z.string().optional(),
  // askQuestion: variable donde guardar la respuesta
  variable: z.string().optional(),
  // condition
  branches: z.array(flowBranchSchema).optional(),
  // action
  action: z.enum(flowActionTypes).optional(),
  botId: z.string().nullable().optional(),
  tag: z.string().optional(),
  stageId: z.string().optional(),
  // delay: esperar antes de continuar
  delayValue: z.number().optional(),
  delayUnit: z.enum(delayUnits).optional(),
  // http: petición a una API/webhook externa
  method: z.enum(httpMethods).optional(),
  url: z.string().optional(),
  headers: z.string().optional(), // JSON crudo: { "Authorization": "..." }
  httpBody: z.string().optional(), // cuerpo (admite {{variables}})
  saveAs: z.string().optional(), // variable donde guardar la respuesta
  // sendTemplate: plantilla aprobada por Meta (abre la ventana de 24 h)
  templateId: z.string().optional(),
  templateName: z.string().optional(), // solo para mostrar en el lienzo
  // Valor de cada variable de la plantilla ({{1}} o {{nombre}}), por orden.
  // Un texto fijo admite {{variables}} del flujo.
  templateVars: z.array(variableValueSchema).max(20).optional(),
  // assign: asignar a un agente
  agentId: z.string().nullable().optional(),
  agentName: z.string().optional(), // solo para mostrar en el lienzo
  // jumpToFlow: continuar en otro flujo
  flowId: z.string().optional(),
  flowName: z.string().optional(), // solo para mostrar en el lienzo
  // sendMessage: adjunto opcional (imagen, video, audio o documento ya
  // subido). buttons: encabezado opcional (imagen, video o documento).
  mediaUrl: z.string().optional(),
  mediaKind: z.enum(MEDIA_KINDS).optional(),
  mediaName: z.string().optional(), // solo para mostrar
  // askQuestion: validación de la respuesta; tras agotar los intentos sale
  // por la salida "invalid" (o por la normal si no está conectada)
  validate: z.enum(answerValidations).optional(),
  pattern: z.string().optional(), // regex cuando validate = "regex"
  retryText: z.string().optional(), // qué decir si la respuesta no vale
  maxRetries: z.number().int().min(0).max(5).optional(),
  // buttons: texto en `text`; cada botón es un sourceHandle; "else" = otra respuesta
  // list: las opciones van en `buttons` (hasta 10) y `listButton` es el botón que las abre
  buttons: z.array(flowButtonSchema).max(10).optional(),
  footer: z.string().max(60).optional(),
  listButton: z.string().max(20).optional(),
  // carousel: tarjetas y si su botón es una respuesta (cada tarjeta, una salida) o un enlace
  cards: z.array(flowCardSchema).max(10).optional(),
  cardMode: z.enum(["reply", "url"]).optional(),
  // setField: clave del campo ("name" = nombre del contacto) y valor (admite {{variables}})
  fieldKey: z.string().optional(),
  value: z.string().optional(),
  // setStatus
  status: z.enum(flowStatuses).optional(),
  // split: cada salida es un sourceHandle con su peso
  splits: z.array(flowSplitSchema).max(5).optional(),
  // schedule: salidas "in" / "out"
  hours: businessHoursSchema.optional(),
  // action create_deal: título (admite {{variables}}); la etapa va en stageId
  dealTitle: z.string().optional(),
  // sendEmail: plantilla de correo y buzón («default» = el de la empresa,
  // «assignee» = el del responsable del chat, o el id de un buzón concreto)
  emailTemplateId: z.string().optional(),
  emailTemplateName: z.string().optional(), // solo para mostrar en el lienzo
  emailAccountId: z.string().optional(),
});
export type FlowNodeData = z.infer<typeof flowNodeDataSchema>;

export const flowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(flowNodeTypes),
  position: z.object({ x: z.number(), y: z.number() }),
  data: flowNodeDataSchema,
});
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  label: z.string().optional(),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

/**
 * Cuándo arranca un flujo.
 *  - conversation_start: primer mensaje de una conversación nueva.
 *  - keyword: un mensaje entrante contiene alguna palabra clave.
 *  - ad_click: el cliente escribe tras tocar un anuncio Click-to-WhatsApp (al
 *    nacer la conversación, o de vuelta por otro anuncio con el chat abierto).
 *  - meta_lead: entra un lead de un formulario de Meta Lead Ads.
 *  - lead_webhook: entra un lead por la API o un webhook (formulario web, n8n…).
 *  - tag_added: se le pone una etiqueta al contacto.
 *  - deal_stage: su oportunidad cambia de etapa.
 *  - conversation_closed: se cierra la conversación.
 *  - no_reply: el cliente lleva X horas sin responder al último mensaje.
 *  - manual: nunca arranca solo; lo ejecutan las automatizaciones de una
 *    etapa del embudo (ver pipeline.schema: stageAutomation).
 */
export const flowTriggerTypes = [
  "conversation_start",
  "keyword",
  "ad_click",
  "meta_lead",
  "lead_webhook",
  "tag_added",
  "deal_stage",
  "conversation_closed",
  "no_reply",
  "missed_call", // llamada telefónica entrante que nadie contestó
  "inbound_message", // cada mensaje del cliente, con una pausa mínima entre disparos
  "tag_removed", // se le quita una etiqueta
  "owner_changed", // cambia el responsable de su oportunidad
  "booking_created", // se le reserva una cita (a mano, por la IA o por el enlace)
  "booking_cancelled", // se cancela su cita
  "manual", // no arranca solo: lo ejecutan las automatizaciones de etapa (o alguien a mano)
] as const;
export type FlowTriggerType = (typeof flowTriggerTypes)[number];

/** Filtros del disparador. Vacío = sin filtro (cualquiera). */
export const flowTriggerConfigSchema = z.object({
  /** tag_added: solo estas etiquetas (por nombre). */
  tags: z.array(z.string().trim().min(1)).max(50).default([]),
  /** deal_stage: solo al entrar en estas etapas. */
  stageIds: z.array(z.string()).max(50).default([]),
  /** meta_lead: solo estos formularios (por nombre o id). */
  forms: z.array(z.string().trim().min(1)).max(50).default([]),
  /** no_reply: horas sin respuesta del cliente. */
  hours: z.number().int().min(1).max(720).default(24),
  /** inbound_message: como mucho una vez cada tantos minutos por conversación. */
  cooldownMin: z.number().int().min(1).max(43200).default(1440),
});
export type FlowTriggerConfig = z.infer<typeof flowTriggerConfigSchema>;
export const EMPTY_TRIGGER_CONFIG: FlowTriggerConfig = { tags: [], stageIds: [], forms: [], hours: 24, cooldownMin: 1440 };

/** Condiciones de un disparador: las mismas reglas que el bloque «Condición». */
export const triggerConditionsSchema = z.object({
  match: z.enum(ruleMatchModes).default("all"),
  rules: z.array(flowRuleSchema).max(10).default([]),
});
export type TriggerConditions = z.infer<typeof triggerConditionsSchema>;

/**
 * Disparadores que pueden esperar antes de arrancar («a los 10 min», «al día
 * siguiente»). Al vencer se comprueba otra vez que sigue valiendo: que siga en
 * la etapa, que siga teniendo (o no) la etiqueta, y las condiciones.
 */
export const DELAYABLE_TRIGGERS = [
  "deal_stage",
  "tag_added",
  "tag_removed",
  "owner_changed",
  "conversation_closed",
  "meta_lead",
  "lead_webhook",
  "missed_call",
  "booking_created",
  "booking_cancelled",
] as const;

/**
 * Un disparador del flujo. Un flujo puede tener varios (por palabra clave,
 * al ponerle una etiqueta, desde un anuncio…): arranca con el primero que
 * ocurra. Sin ninguno, solo lo ejecutan las automatizaciones de una etapa o
 * el bloque «Ir a otro flujo».
 */
export const flowTriggerSchema = z.object({
  id: z.string().min(1).max(40),
  // «manual» no es un disparador: un flujo sin ninguno ya es «solo desde el embudo».
  type: z.enum(flowTriggerTypes).exclude(["manual"]),
  /** keyword: palabras que lo disparan. */
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  config: flowTriggerConfigSchema.default(EMPTY_TRIGGER_CONFIG),
  /**
   * Condiciones que también tienen que cumplirse (etiquetas, etapa,
   * responsable, valor, fuente, UTM…). Sin reglas, siempre.
   */
  conditions: triggerConditionsSchema.default({ match: "all", rules: [] }),
  /** Minutos de espera antes de arrancar (0 = al momento). Solo en DELAYABLE_TRIGGERS. */
  delayMin: z.number().int().min(0).max(43200).default(0),
  /** Solo arranca dentro de este horario (null = siempre). */
  activeHours: businessHoursSchema.nullable().default(null),
});
export type FlowTrigger = z.infer<typeof flowTriggerSchema>;
export const MAX_FLOW_TRIGGERS = 10;
const flowTriggersSchema = z
  .array(flowTriggerSchema)
  .max(MAX_FLOW_TRIGGERS, `Como mucho ${MAX_FLOW_TRIGGERS} disparadores por flujo`)
  .refine((ts) => new Set(ts.map((t) => t.id)).size === ts.length, "Dos disparadores con el mismo id");

// Referencia ligera a un canal (para el selector de disparador).
export const flowChannelRefSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
});
export type FlowChannelRef = z.infer<typeof flowChannelRefSchema>;

// Referencia ligera a un bot (para el nodo action="ai").
export const flowBotRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type FlowBotRef = z.infer<typeof flowBotRefSchema>;

// Referencia ligera a un agente (usuario) para el nodo "assign".
export const flowAgentRefSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
});
export type FlowAgentRef = z.infer<typeof flowAgentRefSchema>;

// Flujo completo que devuelve la API.
export const flowSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  channelId: z.string().nullable(),
  channel: flowChannelRefSchema.nullable(),
  triggers: z.array(flowTriggerSchema),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FlowDto = z.infer<typeof flowSchema>;

// Resumen para la lista (también sirve de selector en "saltar a flujo").
export const flowSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  /** Tipos de sus disparadores, en orden (vacío = solo desde el embudo). */
  triggerTypes: z.array(z.enum(flowTriggerTypes)),
  channel: flowChannelRefSchema.nullable(),
  nodeCount: z.number(),
  updatedAt: z.string(),
});
export type FlowSummary = z.infer<typeof flowSummarySchema>;

// Respuesta de lista: flujos + canales + bots + agentes.
export const flowsResponseSchema = z.object({
  flows: z.array(flowSummarySchema),
  channels: z.array(flowChannelRefSchema),
  bots: z.array(flowBotRefSchema),
  agents: z.array(flowAgentRefSchema),
});
export type FlowsResponse = z.infer<typeof flowsResponseSchema>;

const flowFields = {
  name: z.string().min(1).max(120),
  isActive: z.boolean(),
  channelId: z.string().nullable(),
  triggers: flowTriggersSchema,
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
};

export const createFlowSchema = z.object({
  name: flowFields.name,
  isActive: flowFields.isActive.default(false),
  channelId: flowFields.channelId.default(null),
  triggers: flowFields.triggers.default([]),
  nodes: flowFields.nodes.default([]),
  edges: flowFields.edges.default([]),
});
export type CreateFlowInput = z.infer<typeof createFlowSchema>;

export const updateFlowSchema = z.object({
  name: flowFields.name.optional(),
  isActive: flowFields.isActive.optional(),
  channelId: flowFields.channelId.optional(),
  triggers: flowFields.triggers.optional(),
  nodes: flowFields.nodes.optional(),
  edges: flowFields.edges.optional(),
});
export type UpdateFlowInput = z.infer<typeof updateFlowSchema>;
