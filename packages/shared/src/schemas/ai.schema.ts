import { z } from "zod";

// ── Clasificación del mensaje (salida estructurada) ─────────
export const sentimentValues = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof sentimentValues)[number];

export const urgencyValues = ["low", "medium", "high"] as const;
export type Urgency = (typeof urgencyValues)[number];

export const classificationSchema = z.object({
  intent: z.string(), // p.ej. "consulta_precio", "soporte", "agendar"
  sentiment: z.enum(sentimentValues),
  urgency: z.enum(urgencyValues),
  requiresHuman: z.boolean(),
});
export type Classification = z.infer<typeof classificationSchema>;

// ── Acciones que la IA quiere ejecutar sobre el CRM ──────────
// En autopilot se aplican solas; en copilot quedan pendientes hasta que el
// agente humano envía la respuesta (o la descarta, y se rechazan).
export const pendingActionSchema = z.object({
  id: z.string(), // id del AiToolCall
  tool: z.string(), // add_tag, move_deal_stage, …
  summary: z.string(), // "Poner la etiqueta «VIP»"
  applied: z.boolean(), // true si ya se ejecutó (autopilot)
});
export type PendingAction = z.infer<typeof pendingActionSchema>;

// Resultado de pedirle al agente IA una sugerencia (modo copilot).
export const aiSuggestionSchema = z.object({
  runId: z.string(),
  suggestion: z.string().nullable(), // texto propuesto para enviar (editable)
  classification: classificationSchema.nullable(),
  escalate: z.boolean(), // la IA recomienda pasar a un humano
  escalationReason: z.string().nullable(),
  windowOpen: z.boolean(), // si está cerrada, no se puede enviar texto libre
  model: z.string(),
  provider: z.string(), // "anthropic" | "fake"
  toolsUsed: z.array(z.string()),
  pendingActions: z.array(pendingActionSchema),
});
export type AiSuggestion = z.infer<typeof aiSuggestionSchema>;

// Resolución de las acciones pendientes de un run.
export const resolveActionsSchema = z.object({
  approve: z.boolean(), // true = ejecutar, false = descartar
});
export type ResolveActionsInput = z.infer<typeof resolveActionsSchema>;

export const resolveActionsResultSchema = z.object({
  executed: z.array(z.string()), // resúmenes de lo que se aplicó
  rejected: z.number(),
  errors: z.array(z.string()),
});
export type ResolveActionsResult = z.infer<typeof resolveActionsResultSchema>;

// ── Playground: probar el agente IA sin enviar nada ──────────
export const playgroundTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type PlaygroundTurn = z.infer<typeof playgroundTurnSchema>;

export const playgroundRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  botId: z.string().optional(), // bot a probar; si falta, usa el por defecto
  // Historial de la conversación de prueba (sin contar el mensaje actual).
  history: z.array(playgroundTurnSchema).max(40).default([]),
});
export type PlaygroundRequest = z.infer<typeof playgroundRequestSchema>;

export const playgroundReplySchema = z.object({
  reply: z.string().nullable(),
  // En el playground las acciones NO se ejecutan: solo se listan.
  simulatedActions: z.array(z.string()).default([]),
  escalate: z.boolean(),
  escalationReason: z.string().nullable(),
  model: z.string(),
  provider: z.string(),
  toolsUsed: z.array(z.string()),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
});
export type PlaygroundReply = z.infer<typeof playgroundReplySchema>;

// ── Simulador: una IA hace de cliente y el agente le responde ──
// Va sobre el playground: nada se envía ni se aplica. Cada paso es un mensaje
// del cliente simulado y la respuesta del agente; la pantalla pide los pasos
// uno a uno, así la conversación se ve en vivo y se puede detener.

/** Mensajes del cliente simulado por conversación, como mucho. */
export const SIMULATOR_MAX_TURNS = 8;
export const SIMULATOR_TURN_OPTIONS = [4, 6, 8] as const;
/** Conversaciones por tanda, como mucho. */
export const SIMULATOR_MAX_BATCH = 5;

export const simulatorScenarioSchema = z.object({
  title: z.string().trim().min(1).max(80),
  /** Quién es el cliente y qué quiere: es lo que guía a la IA que hace de él. */
  brief: z.string().trim().min(10, "Describe al cliente con algo más de detalle").max(600),
});
export type SimulatorScenario = z.infer<typeof simulatorScenarioSchema>;

/** Situaciones habituales para probar un agente sin escribir nada. */
export const SIMULATOR_SCENARIOS: (SimulatorScenario & { id: string })[] = [
  {
    id: "price",
    title: "Pregunta el precio",
    brief: "Viste un anuncio del negocio y quieres saber cuánto cuesta lo que ofrece. Preguntas el precio pronto, lo comparas con otra opción que viste y decides si te interesa.",
  },
  {
    id: "booking",
    title: "Quiere agendar o comprar ya",
    brief: "Ya decidiste que lo quieres. Pides una cita, una fecha o cómo pagar, propones un día y una hora, y das tus datos si te los piden.",
  },
  {
    id: "undecided",
    title: "Está indeciso",
    brief: "Te interesa pero dudas. Preguntas detalles, dices que lo vas a pensar y pides algo que te ayude a decidir, como un descuento, una garantía o una prueba.",
  },
  {
    id: "upset",
    title: "Cliente molesto",
    brief: "Compraste o reservaste hace unos días y algo salió mal: no te respondieron o no recibiste lo prometido. Estás molesto, escribes cortante y quieres una solución concreta.",
  },
  {
    id: "human",
    title: "Pide hablar con una persona",
    brief: "No quieres hablar con un bot. Después de saludar pides que te atienda una persona y, si insisten en ayudarte, lo repites.",
  },
  {
    id: "unknown",
    title: "Pregunta algo que no está previsto",
    brief: "Preguntas algo muy específico que el negocio probablemente no tiene previsto: un envío a otro país, una factura con datos especiales o una condición poco común. Si la respuesta es vaga, insistes una vez.",
  },
];

export const simulateTurnRequestSchema = z.object({
  botId: z.string().optional(), // agente a probar; si falta, el por defecto
  scenario: simulatorScenarioSchema,
  /** Lo hablado hasta ahora: «user» es el cliente simulado y «assistant», el agente. */
  history: z.array(playgroundTurnSchema).max(SIMULATOR_MAX_TURNS * 2).default([]),
  /** Cuántos mensajes del cliente tendrá esta conversación. */
  maxTurns: z.number().int().min(1).max(SIMULATOR_MAX_TURNS).default(6),
});
export type SimulateTurnRequest = z.infer<typeof simulateTurnRequestSchema>;
export type SimulateTurnPayload = z.input<typeof simulateTurnRequestSchema>;

export const simulatorEndReasons = ["customer_done", "escalated", "max_turns", "error"] as const;
export type SimulatorEndReason = (typeof simulatorEndReasons)[number];

export const simulateTurnReplySchema = z.object({
  /** Lo que escribió el cliente simulado en este paso. */
  customer: z.string().nullable(),
  /** La respuesta del agente a ese mensaje, con lo que usó y lo que haría. */
  agent: playgroundReplySchema.nullable(),
  /** Si la conversación terminó en este paso, por qué. */
  ended: z.enum(simulatorEndReasons).nullable(),
  /** Por qué falló, si `ended` es «error». */
  error: z.string().nullable().default(null),
  /** Tokens de este paso: el cliente simulado más el agente. */
  tokens: z.number(),
});
export type SimulateTurnReply = z.infer<typeof simulateTurnReplySchema>;

/**
 * Tokens que gastará, más o menos, una conversación simulada. Cada turno
 * reenvía las instrucciones del agente y todo lo hablado, así que el gasto
 * crece con la longitud del prompt y con los turnos. Es una orientación para
 * antes de empezar; al terminar se enseña lo gastado de verdad.
 */
export function estimateSimulationTokens(promptChars: number, turns: number): number {
  // Prompt, más unas 1.500 de herramientas y conocimiento recuperado (medido con un agente de 7 herramientas).
  const instructions = Math.ceil(promptChars / 3.5) + 1500;
  const agent = turns * (instructions + 150) + 90 * turns * (turns - 1);
  const customer = turns * 450 + 60 * turns * (turns - 1);
  return Math.round((agent + customer) / 1000) * 1000;
}
