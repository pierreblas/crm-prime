import { z } from "zod";
import { aiIncludedSchema } from "../ai-usage.js";

// ── Proveedores de LLM disponibles ───────────────────────────
// "auto" = elegir el primero que tenga credencial (OpenAI → Anthropic → simulado).
export const llmProviderNames = ["auto", "openai", "anthropic", "fake"] as const;
export type LlmProviderName = (typeof llmProviderNames)[number];

export const llmProviderLabels: Record<LlmProviderName, string> = {
  auto: "Automático",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  fake: "Simulado (sin API)",
};

// Modelos sugeridos en el selector. El campo admite escribir otro a mano.
export const suggestedModels: Record<"openai" | "anthropic", string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-5", "claude-haiku-4-5"],
};

// Estado de una API key. Nunca se devuelve la key en claro: solo si existe,
// de dónde sale (BD o variable de entorno) y sus últimos caracteres.
export const apiKeyStateSchema = z.object({
  configured: z.boolean(),
  source: z.enum(["db", "env", "none"]),
  masked: z.string().nullable(), // p.ej. "sk-…3f2a"
});
export type ApiKeyState = z.infer<typeof apiKeyStateSchema>;

export const aiSettingsSchema = z.object({
  provider: z.enum(llmProviderNames),
  openaiModel: z.string(),
  anthropicModel: z.string(),
  openaiBaseUrl: z.string().nullable(),
  openaiKey: apiKeyStateSchema,
  anthropicKey: apiKeyStateSchema,
  // Lo que realmente se usará en la próxima llamada.
  activeProvider: z.enum(llmProviderNames),
  activeModel: z.string(),
  // SaaS: cada empresa trae sus keys. `platformKeys` dice si, a falta de key
  // propia, se usan las de la plataforma (AI_SHARED_KEYS) o no hay respaldo.
  saas: z.boolean(),
  platformKeys: z.boolean(),
  // IA de Driony: el respaldo con cupo cuando la empresa no tiene clave.
  included: aiIncludedSchema.nullable(),
});
export type AiSettingsDto = z.infer<typeof aiSettingsSchema>;

// Enviar "" en una key la borra de la BD (vuelve al valor del .env, si hay).
export const updateAiSettingsSchema = z.object({
  provider: z.enum(llmProviderNames).optional(),
  openaiKey: z.string().max(400).optional(),
  anthropicKey: z.string().max(400).optional(),
  openaiModel: z.string().min(1).max(80).optional(),
  anthropicModel: z.string().min(1).max(80).optional(),
  openaiBaseUrl: z.string().max(300).nullable().optional(),
});
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

// Resultado de "Probar conexión": una llamada mínima real al proveedor.
export const aiConnectionTestSchema = z.object({
  ok: z.boolean(),
  provider: z.string(),
  model: z.string(),
  message: z.string(),
  latencyMs: z.number(),
});
export type AiConnectionTest = z.infer<typeof aiConnectionTestSchema>;
