import { z } from "zod";

/**
 * Consumo de IA: qué se gastó, en qué y cuánto cuesta.
 *
 * Con clave propia, cada empresa paga a su proveedor y esto le enseña en qué
 * se le va el dinero. Sin clave, el agente usa la IA de Driony con un cupo de
 * conversaciones al mes según el plan (ver AI_INCLUDED_*). El coste es una
 * ESTIMACIÓN con precios de lista; la factura real está en la cuenta del
 * proveedor.
 */

export const AI_FEATURES = [
  "agent",
  "classify",
  "copilot",
  "playground",
  "prompt_assistant",
  "flow_assistant",
  "knowledge_gaps",
  "knowledge_index",
  "media",
  "follow_up",
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  agent: "Agente automático",
  classify: "Clasificación de mensajes",
  copilot: "Copiloto del chat",
  playground: "Pruebas del agente",
  prompt_assistant: "Asistente de redacción",
  flow_assistant: "Asistente de flujos",
  knowledge_gaps: "Preguntas sin respuesta",
  knowledge_index: "Indexar y buscar conocimiento",
  media: "Audios e imágenes de clientes",
  follow_up: "Seguimientos automáticos",
};

// ── IA de Driony (incluida en el plan) ──────────────────────
/**
 * Modelo fijo de la IA incluida: barato y bueno. Quien quiera otro modelo
 * conecta su clave. El servidor lo puede cambiar con AI_INCLUDED_MODEL.
 */
export const AI_INCLUDED_MODEL = "gpt-5-mini";
/**
 * Coste medio de una conversación atendida por el agente con ese modelo, a
 * precio de lista. En producción (septiembre de 2026) ~5.000 conversaciones
 * gastaron 86,8M tokens de entrada: ~US$22 de lista solo en entrada, aunque
 * la factura fue de US$16 gracias a la caché. ai_usage no descuenta la caché,
 * así que el tope se calcula con lo que ai_usage va a sumar, no con la factura.
 */
export const AI_COST_PER_CONVERSATION_USD = 0.006;
/** Margen del tope en dólares sobre el coste esperado del cupo. */
export const AI_INCLUDED_SAFETY = 2;

/**
 * Tope de gasto al mes de la IA incluida para un cupo: protege de bucles,
 * abusos y conversaciones muy largas, que el cupo por conversaciones no ve.
 */
export function includedAiCapUsd(conversations: number): number {
  return conversations * AI_COST_PER_CONVERSATION_USD * AI_INCLUDED_SAFETY;
}

/** Funciones que cuentan una conversación del cupo (las que atienden al cliente). */
export const AI_INCLUDED_COUNTED: readonly AiFeature[] = ["agent", "follow_up"];

/**
 * Uso de la IA incluida en el mes en curso (UTC). Dos frenos distintos:
 *
 * - `full`: se llegó al cupo de conversaciones. El agente termina las que ya
 *   atendía este mes; las nuevas pasan al equipo. Nadie se queda a medias.
 * - `exhausted`: se llegó al tope en dólares (freno de seguridad para bucles o
 *   abusos; en un uso normal no se alcanza). Ahí la IA de Driony se apaga del
 *   todo hasta el mes siguiente, salvo la indexación del conocimiento.
 */
export const aiIncludedSchema = z.object({
  /** Conversaciones distintas atendidas este mes con la IA de Driony. */
  conversations: z.number(),
  limit: z.number(),
  costUsd: z.number(),
  capUsd: z.number(),
  full: z.boolean(),
  exhausted: z.boolean(),
  /** Cuándo vuelve a empezar el cupo (día 1 del mes siguiente, UTC). */
  resetsAt: z.string(),
});
export type AiIncluded = z.infer<typeof aiIncludedSchema>;

/** Mes de la última revisión de la tabla de precios. */
export const AI_PRICES_REVIEWED = "2026-09";

/**
 * Precios de lista en USD por millón de tokens (entrada, salida). Se busca el
 * primer patrón que encaje con el nombre del modelo, así que los más
 * concretos van antes. Un modelo que no está aquí se muestra sin precio: mejor
 * decir "sin precio" que inventar una cifra.
 */
const PRICES: Array<[RegExp, number, number]> = [
  // Transcripción: tokens de audio de entrada y de texto de salida.
  [/^gpt-4o-mini-transcribe/i, 1.25, 5],
  [/^gpt-4o-transcribe/i, 2.5, 10],
  [/^gpt-4o-mini/i, 0.15, 0.6],
  [/^gpt-4\.1-nano/i, 0.1, 0.4],
  [/^gpt-4\.1-mini/i, 0.4, 1.6],
  [/^gpt-4\.1/i, 2, 8],
  [/^gpt-4o/i, 2.5, 10],
  [/^gpt-4\.1-nano/i, 0.1, 0.4],
  [/^gpt-4\.1-mini/i, 0.4, 1.6],
  [/^gpt-4\.1/i, 2, 8],
  [/^gpt-5-nano/i, 0.05, 0.4],
  [/^gpt-5-mini/i, 0.25, 2],
  [/^gpt-5/i, 1.25, 10],
  [/^(o3|o4)-mini/i, 1.1, 4.4],
  [/^text-embedding-3-small/i, 0.02, 0],
  [/^text-embedding-3-large/i, 0.13, 0],
  [/^claude-(haiku-4|3-5-haiku|haiku-3-5)/i, 1, 5],
  [/^claude-(sonnet-4|3-7-sonnet|3-5-sonnet)/i, 3, 15],
  [/^claude-opus-4-(5|6|7|8)/i, 5, 25],
  [/^claude-opus-4/i, 15, 75],
];

export function aiPrice(model: string): { input: number; output: number } | null {
  const hit = PRICES.find(([re]) => re.test(model));
  return hit ? { input: hit[1], output: hit[2] } : null;
}

/** Coste estimado en USD, o null si el modelo no tiene precio conocido. */
export function estimateAiCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = aiPrice(model);
  if (!p) return null;
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

export const aiUsagePeriods = ["month", "last_month", "30d"] as const;
export type AiUsagePeriod = (typeof aiUsagePeriods)[number];

const usageRow = z.object({
  calls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  /** null = algún modelo sin precio conocido: el coste está incompleto. */
  costUsd: z.number(),
  unpriced: z.boolean(),
});

export const aiUsageReportSchema = z.object({
  period: z.enum(aiUsagePeriods),
  from: z.string(),
  to: z.string(),
  total: usageRow,
  /**
   * Separado por de quién era la clave: lo que la empresa paga a su proveedor
   * (own) y lo que corrió con la IA incluida de Driony (platform), que no paga.
   */
  bySource: z.object({ own: usageRow, platform: usageRow }),
  byFeature: z.array(usageRow.extend({ feature: z.string(), label: z.string() })),
  byModel: z.array(usageRow.extend({ model: z.string(), priced: z.boolean() })),
  byDay: z.array(z.object({ day: z.string(), tokens: z.number(), costUsd: z.number() })),
  pricesReviewed: z.string(),
});
export type AiUsageReport = z.infer<typeof aiUsageReportSchema>;
