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

// ── Modalidad de facturación de la IA ────────────────────────
/**
 * Quién paga la IA de una empresa, y quién pagó cada llamada:
 *   MANAGED  la IA incluida de Driony (cupo del plan, clave de la plataforma)
 *   BYOK     la propia empresa, con su clave (sin cupo, paga a su proveedor)
 * Una sola modalidad por empresa. Hoy la fija la clave: guardar una clave pasa
 * a BYOK, borrarla vuelve a MANAGED; cada cambio queda en el historial.
 */
// (`AiBillingMode` del cotizador añade UNDECIDED; esta es la de la empresa ya decidida.)
export const orgAiBillingModes = ["MANAGED", "BYOK"] as const;
export type OrgAiBillingMode = (typeof orgAiBillingModes)[number];
export const orgAiBillingModeLabels: Record<OrgAiBillingMode, string> = {
  MANAGED: "IA incluida de Driony",
  BYOK: "Mi propia API key",
};

/**
 * Lo que se sabe de la clave propia de la empresa. «Probar conexión» la deja
 * en valid o invalid; un 429 del proveedor, en exhausted; borrarla, en revoked.
 */
export const aiCredentialStatuses = ["unconfigured", "untested", "valid", "invalid", "exhausted", "revoked"] as const;
export type AiCredentialStatus = (typeof aiCredentialStatuses)[number];
export const aiCredentialStatusLabels: Record<AiCredentialStatus, string> = {
  unconfigured: "Sin clave propia",
  untested: "Guardada, sin probar",
  valid: "Probada y funcionando",
  invalid: "Rechazada por el proveedor",
  exhausted: "Sin cuota en el proveedor",
  revoked: "Borrada",
};

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
  // Modalidad y estado de la clave propia, con quién tocó esto por última vez.
  billingMode: z.enum(orgAiBillingModes),
  credentialStatus: z.enum(aiCredentialStatuses),
  validatedAt: z.string().nullable(),
  rotatedAt: z.string().nullable(),
  updatedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type AiSettingsDto = z.infer<typeof aiSettingsSchema>;

// ── Historial de los ajustes de IA ───────────────────────────
// Cada cambio de clave, de modalidad o prueba de conexión deja un evento.
// `details` nunca lleva la clave: como mucho sus últimos caracteres.
export const aiSettingEventActions = [
  "mode_changed",
  "key_set",
  "key_rotated",
  "key_revoked",
  "settings_changed",
  "test_ok",
  "test_failed",
  "budget_changed",
] as const;
export type AiSettingEventAction = (typeof aiSettingEventActions)[number];
export const aiSettingEventLabels: Record<AiSettingEventAction, string> = {
  mode_changed: "Cambio de modalidad",
  key_set: "Clave guardada",
  key_rotated: "Clave cambiada",
  key_revoked: "Clave borrada",
  settings_changed: "Ajustes cambiados",
  test_ok: "Conexión probada",
  test_failed: "Prueba de conexión fallida",
  budget_changed: "Presupuesto cambiado",
};

export const aiSettingEventSchema = z.object({
  id: z.string(),
  action: z.enum(aiSettingEventActions),
  provider: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type AiSettingEventDto = z.infer<typeof aiSettingEventSchema>;

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
