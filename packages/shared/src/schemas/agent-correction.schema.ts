import { z } from "zod";
import { IMPROVE_REPETITION_OPTIONS, improveChangeSchema } from "./agent-improve.schema.js";

// «Corregir al agente»: de uno o varios chats reales revisados sale un cambio
// puntual en las instrucciones, probado en el momento exacto en que falló.

/** Chats por corrección, como mucho, y lo que puede escribir el dueño. */
export const CORRECTION_MAX_CHATS = 8;
export const CORRECTION_NOTE_MAX = 600;

export const startCorrectionSchema = z.object({
  reviewIds: z
    .array(z.string().min(1))
    .min(1, "Elige al menos un chat")
    .max(CORRECTION_MAX_CHATS, `Como mucho ${CORRECTION_MAX_CHATS} chats a la vez`),
  /** Lo que debió hacer, con las palabras del dueño. */
  note: z.string().trim().max(CORRECTION_NOTE_MAX).default(""),
});
export type StartCorrectionInput = z.infer<typeof startCorrectionSchema>;

/** nothing: no hay nada que cambiar en las instrucciones (ya responde bien o no es de ellas). */
export const correctionStatuses = ["running", "ready", "nothing", "failed", "applied", "discarded"] as const;
export type CorrectionStatus = (typeof correctionStatuses)[number];

/**
 * Qué pasa con cada chat:
 *   fixed / not_fixed  con el cambio ya responde bien / sigue fallando
 *   today_ok           con las instrucciones de hoy ya respondería bien
 *   data               le falta un dato del negocio: va en el catálogo o en Conocimiento
 *   system             no depende de sus instrucciones
 *   error              no se pudo repetir
 */
export const correctionOutcomes = ["pending", "fixed", "not_fixed", "today_ok", "data", "system", "error"] as const;
export type CorrectionOutcome = (typeof correctionOutcomes)[number];

export const correctionChatSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  conversationId: z.string(),
  contactName: z.string(),
  /** Lo que marcó la revisión, en una frase. */
  problem: z.string(),
  /** Lo último que escribió el cliente antes de esa respuesta. */
  customer: z.string(),
  /** Lo que respondió de verdad. */
  before: z.string(),
  /** Lo que respondería hoy y lo que respondería con el cambio. */
  today: z.string().nullable(),
  after: z.string().nullable(),
  outcome: z.enum(correctionOutcomes),
  note: z.string(),
  /** Un dato del negocio que le faltó (va en el catálogo o en Conocimiento), aunque además haya regla. */
  missing: z.string().nullable().default(null),
});
export type CorrectionChat = z.infer<typeof correctionChatSchema>;

export const agentCorrectionSchema = z.object({
  id: z.string(),
  botId: z.string(),
  botName: z.string(),
  status: z.enum(correctionStatuses),
  note: z.string(),
  basePrompt: z.string(),
  prompt: z.string(),
  changes: z.array(improveChangeSchema),
  chats: z.array(correctionChatSchema),
  done: z.number(),
  total: z.number(),
  tokens: z.number(),
  error: z.string().nullable(),
  /** Las instrucciones del agente cambiaron desde que empezó la corrección. */
  agentChanged: z.boolean(),
  /** La medición con los casos del agente, si se pidió. */
  runId: z.string().nullable(),
  /** Casos marcados con los que se puede medir. */
  activeCases: z.number(),
  createdAt: z.string(),
  appliedAt: z.string().nullable(),
});
export type AgentCorrection = z.infer<typeof agentCorrectionSchema>;

export const applyCorrectionSchema = z.object({ force: z.boolean().default(false) });
export type ApplyCorrectionInput = z.infer<typeof applyCorrectionSchema>;

export const measureCorrectionSchema = z.object({
  repetitions: z
    .number()
    .int()
    .refine((n) => (IMPROVE_REPETITION_OPTIONS as readonly number[]).includes(n), "Repeticiones no válidas")
    .default(1),
});
export type MeasureCorrectionInput = z.infer<typeof measureCorrectionSchema>;

/**
 * Tokens que gastará, más o menos: por chat, dos respuestas del agente (hoy y
 * con el cambio) y dos comprobaciones; más una propuesta, que lee las
 * instrucciones y los chats y razona. Si el primer cambio no basta se intenta
 * otro, y entonces gasta cerca del doble.
 */
export function estimateCorrectionTokens(promptChars: number, chats: number): number {
  const instructions = Math.ceil(promptChars / 3.5);
  // Una respuesta consulta el catálogo: dos llamadas, con herramientas y lo hablado.
  // Medido con gpt-5-mini: de 10.000 a 16.000 en total con unas instrucciones cortas.
  const reply = 2 * (instructions + 1500);
  const judge = instructions + 1500;
  const proposal = instructions + 4500 + chats * 1000;
  return Math.max(1000, Math.round((chats * 2 * (reply + judge) + proposal) / 1000) * 1000);
}
