import { z } from "zod";

/**
 * Consumo de IA: qué se gastó, en qué y cuánto cuesta.
 *
 * Driony no cobra la IA: cada empresa paga a su proveedor con su clave. Esto
 * sirve para que la empresa vea en qué se le va el dinero. El coste es una
 * ESTIMACIÓN con precios de lista; la factura real está en la cuenta de
 * OpenAI o Anthropic de la empresa.
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
  byFeature: z.array(usageRow.extend({ feature: z.string(), label: z.string() })),
  byModel: z.array(usageRow.extend({ model: z.string(), priced: z.boolean() })),
  byDay: z.array(z.object({ day: z.string(), tokens: z.number(), costUsd: z.number() })),
  pricesReviewed: z.string(),
});
export type AiUsageReport = z.infer<typeof aiUsageReportSchema>;
