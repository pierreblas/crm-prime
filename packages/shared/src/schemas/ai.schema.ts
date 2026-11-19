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
  /** Opciones para pulsar debajo de la respuesta (botones o lista); vacío si es solo texto. */
  options: z.array(z.string()).default([]),
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

/**
 * El cliente con el que se prueba: su nombre rellena {{nombre}} y su teléfono
 * da el país, la moneda ({{pais}}, {{moneda}}) y el precio que devuelve el
 * catálogo. Sin él, un «Cliente de prueba» sin país.
 */
export const playgroundContactSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
});
export type PlaygroundContact = z.infer<typeof playgroundContactSchema>;

export const playgroundRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  botId: z.string().optional(), // bot a probar; si falta, usa el por defecto
  // Historial de la conversación de prueba (sin contar el mensaje actual).
  history: z.array(playgroundTurnSchema).max(40).default([]),
  contact: playgroundContactSchema.optional(),
});
export type PlaygroundRequest = z.infer<typeof playgroundRequestSchema>;

/** Una consulta que hizo el agente en la prueba y, en una línea, qué le devolvió. */
export const playgroundToolCallSchema = z.object({
  name: z.string(),
  /** Con qué la llamó (p. ej. la búsqueda), en texto corto. */
  input: z.string(),
  summary: z.string(),
  /**
   * Un extracto de lo que devolvió (los productos con sus precios, los
   * fragmentos del conocimiento): con él la revisión del simulador sabe si un
   * dato que dio el agente salió de ahí o se lo inventó. Solo en las pruebas.
   */
  evidence: z.string().optional(),
});
export type PlaygroundToolCall = z.infer<typeof playgroundToolCallSchema>;

export const playgroundReplySchema = z.object({
  reply: z.string().nullable(),
  // En el playground las acciones NO se ejecutan: solo se listan.
  simulatedActions: z.array(z.string()).default([]),
  escalate: z.boolean(),
  escalationReason: z.string().nullable(),
  model: z.string(),
  provider: z.string(),
  toolsUsed: z.array(z.string()),
  /** Cada consulta y su resultado: para ver si de verdad leyó el catálogo y qué encontró. */
  toolCalls: z.array(playgroundToolCallSchema).default([]),
  /** El agente escribe en varios mensajes cortos (como en WhatsApp): la respuesta va por párrafos. */
  splitReplies: z.boolean().default(false),
  /** Opciones para pulsar debajo de la respuesta (botones o lista); vacío si es solo texto. */
  options: z.array(z.string()).default([]),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
});
export type PlaygroundReply = z.infer<typeof playgroundReplySchema>;

// ── «¿Por qué respondió esto?» ───────────────────────────────
/**
 * Lo que hizo la IA para escribir una respuesta real, para verlo en la bandeja:
 * qué entendió del mensaje, qué consultó y qué le devolvió cada consulta, qué
 * acciones hizo y si decidió pasar el chat. Sale de lo que ya se guarda de cada
 * respuesta (AiRun y sus AiToolCall).
 */
export const aiRunStepSchema = playgroundToolCallSchema.extend({
  /** EXECUTED, PENDING_APPROVAL (copilot: espera a que se envíe), REJECTED o ERROR. */
  status: z.string(),
});
export type AiRunStep = z.infer<typeof aiRunStepSchema>;

export const aiRunTraceSchema = z.object({
  runId: z.string(),
  status: z.string(),
  createdAt: z.string(),
  agentName: z.string().nullable(),
  model: z.string(),
  latencyMs: z.number().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  /** Qué entendió del último mensaje del cliente (intención, ánimo, urgencia). */
  classification: classificationSchema.nullable(),
  confidence: z.number().nullable(),
  escalationReason: z.string().nullable(),
  steps: z.array(aiRunStepSchema),
});
export type AiRunTrace = z.infer<typeof aiRunTraceSchema>;

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
  /** El cliente con el que se prueba (nombre y país), como en la conversación manual. */
  contact: playgroundContactSchema.optional(),
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
  // La revisión al terminar: las instrucciones (recortadas) y la conversación con lo que consultó.
  const review = Math.min(instructions, 2200) + 800 + turns * 550;
  return Math.round((agent + customer + review) / 1000) * 1000;
}

// ── Revisión de una conversación simulada ────────────────────
// Al terminar, una IA la juzga con lo que el agente consultó de verdad: si se
// inventó algún dato, si respondió lo que le preguntaron, si propuso el
// siguiente paso y si pasó el chat a una persona cuando tocaba.

export const simulationVerdicts = ["ok", "review", "bad"] as const;
export type SimulationVerdict = (typeof simulationVerdicts)[number];
export const simulationFindingKinds = ["invented", "unanswered", "no_next_step", "handoff", "tone", "good"] as const;
export type SimulationFindingKind = (typeof simulationFindingKinds)[number];

export const simulationReviewLineSchema = z.object({
  /** «team»: una persona del equipo (solo en conversaciones reales). */
  /** «auto»: un mensaje de la IA que no escribió el agente (un flujo, un aviso programado): de contexto, no se juzga. */
  who: z.enum(["customer", "agent", "team", "auto"]),
  text: z.string().max(4000),
  /** Lo que consultó el agente para esta respuesta, con lo que le devolvió. */
  consulted: z.array(z.string().max(2000)).max(12).default([]),
  /** Botones que ofreció. */
  options: z.array(z.string().max(40)).max(10).default([]),
  /** Si pasó el chat a una persona, y por qué. */
  handoff: z.string().max(400).nullable().default(null),
});
export type SimulationReviewLine = z.infer<typeof simulationReviewLineSchema>;

export const simulateReviewRequestSchema = z.object({
  botId: z.string().optional(),
  scenario: simulatorScenarioSchema,
  lines: z.array(simulationReviewLineSchema).min(1).max(SIMULATOR_MAX_TURNS * 2),
  ended: z.enum(simulatorEndReasons).nullable().default(null),
});
export type SimulateReviewRequest = z.infer<typeof simulateReviewRequestSchema>;
export type SimulateReviewPayload = z.input<typeof simulateReviewRequestSchema>;

export const simulationFindingSchema = z.object({
  kind: z.enum(simulationFindingKinds),
  note: z.string(),
  /** La frase del agente a la que se refiere, si aplica. */
  quote: z.string().nullable().default(null),
});
export type SimulationFinding = z.infer<typeof simulationFindingSchema>;

export const simulationReviewSchema = z.object({
  verdict: z.enum(simulationVerdicts),
  summary: z.string(),
  findings: z.array(simulationFindingSchema),
  tokens: z.number(),
});
export type SimulationReview = z.infer<typeof simulationReviewSchema>;

// ── Revisión de conversaciones reales ────────────────────────
// El mismo revisor del simulador sobre los chats que atendió la IA de verdad,
// con lo que consultó el agente en cada respuesta. Una vez al día si la empresa
// lo activa (gasta tokens), o a mano.

/** Conversaciones por pasada diaria, como mucho. */
export const CHAT_REVIEW_DAILY_MAX = 20;
/** «Revisar ahora»: cuántos días hacia atrás puede mirar y cuántas conversaciones, como mucho. */
export const CHAT_REVIEW_DAYS_OPTIONS = [7, 30, 90] as const;
export const CHAT_REVIEW_MANUAL_DAYS = 7;
export const CHAT_REVIEW_MANUAL_MAX = 10;
export const runChatReviewSchema = z.object({
  days: z
    .number()
    .int()
    .refine((d) => (CHAT_REVIEW_DAYS_OPTIONS as readonly number[]).includes(d), "Elige 7, 30 o 90 días")
    .default(CHAT_REVIEW_MANUAL_DAYS),
});
export type RunChatReviewInput = z.infer<typeof runChatReviewSchema>;

export const conversationReviewDtoSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  contactName: z.string(),
  channel: z.string(),
  agentName: z.string().nullable(),
  verdict: z.enum(simulationVerdicts),
  summary: z.string(),
  findings: z.array(simulationFindingSchema),
  aiMessages: z.number(),
  tokens: z.number(),
  status: z.enum(["open", "done"]),
  createdAt: z.string(),
  lastMessageAt: z.string(),
});
export type ConversationReviewDto = z.infer<typeof conversationReviewDtoSchema>;

export const chatReviewOverviewSchema = z.object({
  /** La revisión diaria está activa. */
  enabled: z.boolean(),
  lastRunAt: z.string().nullable(),
  /** Una pasada en marcha: cuántas lleva de cuántas. */
  running: z.object({ done: z.number(), total: z.number() }).nullable(),
  /** Para mirar: «Revisar» o «Mal» que nadie marcó como vistas. */
  open: z.number(),
  reviews: z.array(conversationReviewDtoSchema),
});
export type ChatReviewOverview = z.infer<typeof chatReviewOverviewSchema>;

export const updateChatReviewSettingsSchema = z.object({ enabled: z.boolean() });
export type UpdateChatReviewSettingsInput = z.infer<typeof updateChatReviewSettingsSchema>;
export const updateConversationReviewSchema = z.object({ status: z.enum(["open", "done"]) });
export type UpdateConversationReviewInput = z.infer<typeof updateConversationReviewSchema>;
