import { z } from "zod";
import { aiIncludedSchema } from "../ai-usage.js";

/**
 * Copiloto de Driony: la IA que ayuda al equipo (no la que responde sola).
 *
 * Funciona con la clave de IA de la empresa (Ajustes › Inteligencia
 * Artificial) o, sin clave, con la IA de Driony dentro del cupo del plan.
 */

// ── Estado de la IA para esta empresa ─────────────────────────
export const aiStatusSchema = z.object({
  /** Hay un modelo real disponible (no el simulado). */
  ready: z.boolean(),
  provider: z.string(),
  model: z.string(),
  /**
   * De quién es la clave: la empresa, la plataforma (si el operador la presta
   * sin cupo), la IA de Driony con cupo del plan, o nadie.
   */
  source: z.enum(["own", "platform", "included", "none"]),
  saas: z.boolean(),
  /** Uso de la IA de Driony este mes; null si la empresa no puede usarla (o es instalación propia). */
  included: aiIncludedSchema.nullable(),
  /** Tokens del mes con la clave propia de la empresa (o la del servidor): sin cupo, pero se enseñan junto a la foto. */
  ownTokens: z.number().default(0),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;

// ── Reescribir el borrador ────────────────────────────────────
export const REWRITE_MODES = ["improve", "friendly", "formal", "shorter", "grammar", "translate"] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];

export const copilotRewriteSchema = z.object({
  text: z.string().trim().min(1, "Escribe algo primero").max(4000),
  mode: z.enum(REWRITE_MODES),
  /**
   * Solo para `translate`. Nombre del idioma ("inglés", "portugués"…) o
   * "customer" para el idioma en que escribe el cliente.
   */
  language: z.string().max(40).optional(),
});
export type CopilotRewriteInput = z.infer<typeof copilotRewriteSchema>;
export interface CopilotRewriteResult {
  text: string;
}

// ── Resumen de la conversación ────────────────────────────────
export const copilotSummarySchema = z.object({
  summary: z.string(),
  points: z.array(z.string()),
  nextStep: z.string().nullable(),
  mood: z.enum(["positive", "neutral", "negative"]).nullable(),
});
export type CopilotSummary = z.infer<typeof copilotSummarySchema>;

// ── Preguntar a la IA sobre el cliente ────────────────────────
export const copilotAskSchema = z.object({
  question: z.string().trim().min(2).max(600),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .default([]),
});
export type CopilotAskInput = z.infer<typeof copilotAskSchema>;
export interface CopilotAskResult {
  answer: string;
}

// ── Copiloto del administrador ────────────────────────────────
// Chat de ayuda de toda la app (solo ADMIN): explica Driony con la
// documentación y mira la configuración de la cuenta para diagnosticar.
// Solo lee: los cambios los hace el administrador con los pasos que le da.
export const adminCopilotTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(8000),
});
export type AdminCopilotTurn = z.infer<typeof adminCopilotTurnSchema>;

export const adminCopilotRequestSchema = z.object({
  /** El hilo entero; el último turno es la pregunta. */
  messages: z
    .array(adminCopilotTurnSchema)
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1]?.role === "user", "El último mensaje debe ser una pregunta"),
  /** Pantalla desde la que pregunta (ruta y query), para entender «aquí». */
  path: z.string().max(300).optional(),
});
export type AdminCopilotRequest = z.infer<typeof adminCopilotRequestSchema>;

export interface AdminCopilotReply {
  reply: string;
  /** Lo que consultó para responder (documentos y datos de la cuenta), para mostrarlo. */
  consulted: string[];
  provider: string;
  model: string;
}

// ── Memoria del cliente ───────────────────────────────────────
export const contactMemorySchema = z.object({
  summary: z.string().nullable(),
  facts: z.array(z.string()),
  updatedAt: z.string().nullable(),
});
export type ContactMemory = z.infer<typeof contactMemorySchema>;

// ── Preguntas sin respuesta (huecos del conocimiento) ─────────
export const knowledgeSuggestionStatuses = ["pending", "accepted", "dismissed"] as const;
export const knowledgeSuggestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  occurrences: z.number(),
  conversationIds: z.array(z.string()),
  status: z.enum(knowledgeSuggestionStatuses),
  createdAt: z.string(),
});
export type KnowledgeSuggestionDto = z.infer<typeof knowledgeSuggestionSchema>;

export const acceptKnowledgeSuggestionSchema = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(3).max(4000),
});
export type AcceptKnowledgeSuggestionInput = z.infer<typeof acceptKnowledgeSuggestionSchema>;

export interface AnalyzeKnowledgeResult {
  analyzed: number;
  created: number;
}

// ── Importar una web al conocimiento ──────────────────────────
export const importUrlSchema = z.object({
  url: z.string().trim().url("Escribe una dirección completa (https://…)").max(2000),
  /** Seguir los enlaces del mismo sitio (hasta 15 páginas). */
  crawl: z.boolean().default(false),
});
export type ImportUrlInput = z.infer<typeof importUrlSchema>;
export interface ImportUrlResult {
  imported: { title: string; url: string; chunks: number }[];
  skipped: { url: string; reason: string }[];
}

// ── Estado del índice del conocimiento ────────────────────────
export interface KnowledgeIndexStatus {
  /** Con qué se calculan los embeddings ahora: voyage | openai | fake. */
  embedder: string;
  docs: number;
  /** Documentos indexados con otro embedder: hay que reindexarlos. */
  stale: number;
}
