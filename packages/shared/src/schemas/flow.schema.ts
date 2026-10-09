import { z } from "zod";
import { businessHoursSchema } from "./agent-config.schema.js";

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

// Botón de respuesta rápida (WhatsApp admite hasta 3, de 20 caracteres).
export const flowButtonSchema = z.object({
  id: z.string(),
  title: z.string().max(20),
});
export type FlowButton = z.infer<typeof flowButtonSchema>;

// Salida del nodo "split": peso relativo (porcentaje) de cada rama.
export const flowSplitSchema = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number().min(0).max(100),
});
export type FlowSplit = z.infer<typeof flowSplitSchema>;

export const flowStatuses = ["OPEN", "PENDING", "CLOSED"] as const;

// Qué puede mirar una regla de "condition".
export const conditionFields = [
  "message", // el último mensaje del cliente
  "variable", // una variable del flujo (key = nombre)
  "contact_name",
  "contact_phone",
  "contact_field", // campo personalizado (key = clave del campo)
  "tag", // el contacto tiene la etiqueta (value = nombre)
  "source", // fuente del contacto (value = id; "" = sin fuente)
  "channel", // número de WhatsApp (value = id)
  "status", // OPEN | PENDING | CLOSED
  "ai_mode", // OFF | COPILOT | AUTOPILOT
  "assigned", // agente asignado (value = id; "none" = nadie)
  "stage", // etapa de su oportunidad abierta (value = id)
  "is_new", // es su primer mensaje ("yes" | "no")
  "messages_count", // mensajes que ha enviado el contacto
] as const;
export type ConditionField = (typeof conditionFields)[number];

export const conditionOps = [
  "contains", // alguna de las palabras (separadas por comas)
  "not_contains",
  "equals", // igual a (admite varias opciones separadas por comas)
  "not_equals",
  "starts_with",
  "regex",
  "empty",
  "not_empty",
  "gt",
  "lt",
  "is", // para los campos de opción (estado, fuente, etapa…)
  "is_not",
] as const;
export type ConditionOp = (typeof conditionOps)[number];

export const flowRuleSchema = z.object({
  id: z.string(),
  field: z.enum(conditionFields),
  key: z.string().optional(), // variable o clave de campo
  op: z.enum(conditionOps),
  value: z.string().optional(), // admite {{variables}}
});
export type FlowRule = z.infer<typeof flowRuleSchema>;

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
  // assign: asignar a un agente
  agentId: z.string().nullable().optional(),
  agentName: z.string().optional(), // solo para mostrar en el lienzo
  // jumpToFlow: continuar en otro flujo
  flowId: z.string().optional(),
  flowName: z.string().optional(), // solo para mostrar en el lienzo
  // sendMessage: adjunto opcional (imagen o documento ya subido)
  mediaUrl: z.string().optional(),
  mediaKind: z.enum(["IMAGE", "DOCUMENT"]).optional(),
  mediaName: z.string().optional(), // solo para mostrar
  // askQuestion: validación de la respuesta; tras agotar los intentos sale
  // por la salida "invalid" (o por la normal si no está conectada)
  validate: z.enum(answerValidations).optional(),
  pattern: z.string().optional(), // regex cuando validate = "regex"
  retryText: z.string().optional(), // qué decir si la respuesta no vale
  maxRetries: z.number().int().min(0).max(5).optional(),
  // buttons: texto en `text`; cada botón es un sourceHandle; "else" = otra respuesta
  buttons: z.array(flowButtonSchema).max(3).optional(),
  footer: z.string().max(60).optional(),
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
 *  - ad_click: la conversación nace desde un anuncio Click-to-WhatsApp.
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
});
export type FlowTriggerConfig = z.infer<typeof flowTriggerConfigSchema>;
export const EMPTY_TRIGGER_CONFIG: FlowTriggerConfig = { tags: [], stageIds: [], forms: [], hours: 24 };

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
  triggerType: z.enum(flowTriggerTypes),
  triggerKeywords: z.array(z.string()),
  triggerConfig: flowTriggerConfigSchema,
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
  triggerType: z.enum(flowTriggerTypes),
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
  triggerType: z.enum(flowTriggerTypes),
  triggerKeywords: z.array(z.string()),
  triggerConfig: flowTriggerConfigSchema,
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
};

export const createFlowSchema = z.object({
  name: flowFields.name,
  isActive: flowFields.isActive.default(false),
  channelId: flowFields.channelId.default(null),
  triggerType: flowFields.triggerType.default("conversation_start"),
  triggerKeywords: flowFields.triggerKeywords.default([]),
  triggerConfig: flowFields.triggerConfig.default(EMPTY_TRIGGER_CONFIG),
  nodes: flowFields.nodes.default([]),
  edges: flowFields.edges.default([]),
});
export type CreateFlowInput = z.infer<typeof createFlowSchema>;

export const updateFlowSchema = z.object({
  name: flowFields.name.optional(),
  isActive: flowFields.isActive.optional(),
  channelId: flowFields.channelId.optional(),
  triggerType: flowFields.triggerType.optional(),
  triggerKeywords: flowFields.triggerKeywords.optional(),
  triggerConfig: flowFields.triggerConfig.optional(),
  nodes: flowFields.nodes.optional(),
  edges: flowFields.edges.optional(),
});
export type UpdateFlowInput = z.infer<typeof updateFlowSchema>;
