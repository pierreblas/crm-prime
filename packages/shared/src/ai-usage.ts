import { z } from "zod";

/**
 * Consumo de IA: qué se gastó, en qué y cuánto cuesta.
 *
 * Con clave propia, cada empresa paga a su proveedor y esto le enseña en qué
 * se le va el dinero. Sin clave, la IA de Driony se mide en tokens: el plan
 * trae un cupo al mes (PlanDef.aiTokens) del que sale todo lo que hace la IA,
 * y se amplía con paquetes de tokens (AI_PACKS). El coste en dólares es una
 * ESTIMACIÓN con precios de lista; la factura real está en la cuenta del
 * proveedor.
 */

export const AI_FEATURES = [
  "agent",
  "classify",
  "copilot",
  "admin_copilot",
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
  admin_copilot: "Copiloto del administrador",
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
 * Tokens que gasta de media una conversación atendida por el agente. En
 * producción (septiembre de 2026) ~5.000 conversaciones gastaron 86,8 M de
 * tokens de entrada: unos 18.000 por conversación con la salida. Sirve para
 * traducir conversaciones a tokens (el selector de plan, los paquetes
 * antiguos) y para que los textos digan «unas N conversaciones».
 */
export const AI_TOKENS_PER_CONVERSATION = 20_000;
/**
 * Coste de lista de un token de la IA incluida, mezclando entrada y salida
 * como salen en producción (unos 95 % de entrada a 0,25 USD/M y 5 % de salida
 * a 2 USD/M con gpt-5-mini). ai_usage no descuenta la caché, así que el tope
 * se calcula con lo que ai_usage va a sumar, no con la factura.
 */
export const AI_TOKEN_COST_USD = 0.35 / 1_000_000;
/** Margen del tope en dólares sobre el coste esperado del cupo. */
export const AI_INCLUDED_SAFETY = 2;
/**
 * Al llegar al cupo, una conversación que el agente ya atendía este mes puede
 * terminar: hasta este margen por encima del total (cupo más tokens extra).
 * Lo nuevo pasa al equipo desde el 100 %.
 */
export const AI_GRACE = 0.05;

/**
 * Tope de gasto al mes de la IA incluida para un cupo de tokens: el cupo
 * cuenta entrada y salida por igual, y esto frena a quien gasta mucha salida
 * (más cara) o a un bucle antes de que cueste de verdad. Con tokens extra, se
 * calcula con el cupo más los extra del mes y los que quedan.
 */
export function includedAiCapUsd(tokens: number): number {
  return tokens * AI_TOKEN_COST_USD * AI_INCLUDED_SAFETY;
}

// ── Tokens extra (paquetes) ─────────────────────────────────
/**
 * Paquetes de tokens de IA para quien se queda corto un mes: se pagan una
 * vez, valen AI_PACK_MONTHS meses y se gastan solo después del cupo del plan,
 * el que vence antes primero. Mientras no haya cobro automático, el operador
 * los añade desde la consola al recibir el pago. Los paquetes de
 * conversaciones anteriores a noviembre de 2026 se convirtieron a
 * AI_TOKENS_PER_CONVERSATION tokens por conversación.
 */
export const AI_PACKS = [
  { key: "20m", tokens: 20_000_000, priceUsd: 12 },
  { key: "60m", tokens: 60_000_000, priceUsd: 29 },
] as const;
export type AiPackKey = (typeof AI_PACKS)[number]["key"];
export const AI_PACK_MONTHS = 6;

/** Un paquete comprado, tal como lo ve la empresa: tokens que trae y tokens gastados. */
export const aiPackSchema = z.object({
  id: z.string(),
  tokens: z.number(),
  used: z.number(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type AiPackDto = z.infer<typeof aiPackSchema>;

/** El operador añade un paquete: uno del catálogo o un número de tokens a mano (regalo, compensación). */
export const grantAiPackSchema = z.object({
  tokens: z.number().int().min(1).max(2_000_000_000),
  /** Lo que pagó, en USD; null = regalo. */
  priceUsd: z.number().min(0).max(100_000).nullable().optional(),
  months: z.number().int().min(1).max(24).optional(),
  note: z.string().max(500).nullable().optional(),
});
export type GrantAiPackInput = z.infer<typeof grantAiPackSchema>;

/**
 * Funciones que atienden al cliente: dicen qué conversaciones «ya atendía» el
 * agente este mes (las que pueden terminar al llegar al cupo) y cuántas
 * atendió, que se enseña junto a los tokens.
 */
export const AI_INCLUDED_COUNTED: readonly AiFeature[] = ["agent", "follow_up"];

/**
 * Uso de la IA incluida en el mes en curso (UTC), en tokens. Dos frenos:
 *
 * - `full`: se gastó el cupo del plan y los tokens extra. Lo nuevo pasa al
 *   equipo; una conversación que el agente ya atendía puede terminar dentro
 *   del margen AI_GRACE. El copiloto y los asistentes se detienen.
 * - `exhausted`: se llegó al tope en dólares (freno de seguridad para bucles o
 *   abusos; en un uso normal no se alcanza). Ahí la IA de Driony se apaga del
 *   todo hasta el mes siguiente, salvo la indexación del conocimiento.
 */
export const aiIncludedSchema = z.object({
  /** Tokens gastados este mes con la IA de Driony, en todo (los extra incluidos). */
  tokens: z.number(),
  /** Conversaciones distintas que el agente atendió este mes, para decirlo en palabras. */
  conversations: z.number(),
  /** El cupo de tokens del mes del plan. */
  limit: z.number(),
  /** Tokens extra (paquetes): los que quedan y los gastados este mes. */
  extraRemaining: z.number(),
  extraUsed: z.number(),
  /** Cuándo vence el paquete que se está gastando (null = sin paquetes). */
  extraExpiresAt: z.string().nullable(),
  costUsd: z.number(),
  capUsd: z.number(),
  full: z.boolean(),
  exhausted: z.boolean(),
  /** Cuándo vuelve a empezar el cupo (día 1 del mes siguiente, UTC). */
  resetsAt: z.string(),
});
export type AiIncluded = z.infer<typeof aiIncludedSchema>;

/** Todo lo que hay este mes: el cupo del plan más los tokens extra (gastados y por gastar). */
export function aiIncludedTotal(i: Pick<AiIncluded, "limit" | "extraRemaining" | "extraUsed">): number {
  return i.limit + i.extraUsed + i.extraRemaining;
}

/** Nivel de aviso del cupo: al 80 % del total (cupo + extra), al 95 % y al llegar. */
export function aiQuotaLevel(i: Pick<AiIncluded, "tokens" | "limit" | "extraRemaining" | "extraUsed" | "full" | "exhausted">): "ok" | "warn" | "high" | "full" {
  if (i.full || i.exhausted) return "full";
  const total = aiIncludedTotal(i);
  if (total <= 0) return "ok";
  if (i.tokens >= total * 0.95) return "high";
  return i.tokens >= total * 0.8 ? "warn" : "ok";
}

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
