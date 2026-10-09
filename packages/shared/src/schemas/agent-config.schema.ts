import { z } from "zod";
import { flowRuleSchema, ruleMatchModes } from "./condition.schema.js";

export const effortValues = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof effortValues)[number];

// Reglas de escalado configurables.
export const escalationRulesSchema = z.object({
  minConfidence: z.number().min(0).max(1).optional(),
  escalateOnNegativeSentiment: z.boolean().optional(),
  keywords: z.array(z.string()).optional(),
  /** Lo que recibe el cliente cuando la IA le pasa el chat a una persona (vacío = nada). */
  handoffMessage: z.string().max(1000).optional(),
});

/** Aviso por defecto al pasar el chat: que el cliente no se quede en silencio. */
export const DEFAULT_HANDOFF_MESSAGE = "Un momento, por favor: te paso con una persona del equipo para ayudarte con esto.";
export type EscalationRules = z.infer<typeof escalationRulesSchema>;

// Herramienta disponible (para los checkboxes del panel).
// `isAction` distingue las que ESCRIBEN en el CRM (etiquetar, mover de etapa…)
// de las de solo lectura: las de escritura pasan por aprobación en copilot.
export const agentToolInfoSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  isAction: z.boolean(),
  // Aviso cuando la acción no puede usarse todavía (p. ej. no hay etiquetas).
  unavailableReason: z.string().nullable(),
});
export type AgentToolInfo = z.infer<typeof agentToolInfoSchema>;

// ── Automatización ───────────────────────────────────────────

// Horario de atención (por día de la semana, formato "HH:MM").
export const weekday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof weekday)[number];

export const businessHoursSchema = z.object({
  timezone: z.string().default("America/Lima"),
  // Para cada día: rango activo, o null si cerrado.
  days: z.record(
    z.enum(weekday),
    z.object({ from: z.string(), to: z.string() }).nullable(),
  ),
  outOfHoursMessage: z.string().max(1000).optional(),
});
export type BusinessHours = z.infer<typeof businessHoursSchema>;

// Disparador por palabra clave.
export const keywordActions = ["reply", "handoff", "set_off"] as const;
export type KeywordAction = (typeof keywordActions)[number];

/**
 * Versión de una respuesta fija para quien cumpla unas condiciones (país por
 * el prefijo del teléfono, etiqueta, etapa, fuente, número…). Se evalúan en
 * orden y gana la primera; si ninguna, el texto general.
 */
export const keywordVariantSchema = z.object({
  rules: z.array(flowRuleSchema).min(1).max(10),
  match: z.enum(ruleMatchModes).default("all"),
  value: z.string().max(2000),
});
export type KeywordVariant = z.infer<typeof keywordVariantSchema>;

export const keywordTriggerSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  action: z.enum(keywordActions),
  // Texto a responder (action="reply") o motivo del handoff.
  value: z.string().max(2000).optional(),
  // action="reply": versiones con condiciones; quien no cumpla ninguna recibe `value`.
  variants: z.array(keywordVariantSchema).max(40).optional(),
});
export type KeywordTrigger = z.infer<typeof keywordTriggerSchema>;

/**
 * Lo guardado puede venir del formato anterior de las versiones (`{ country,
 * value }`) o sin `rules`: se convierte a condiciones para que ni la API ni
 * el editor tengan que distinguir. Lo irreconocible se descarta.
 */
export function normalizeKeywordVariant(raw: unknown): KeywordVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { rules?: unknown; match?: unknown; value?: unknown; country?: unknown };
  const value = typeof v.value === "string" ? v.value : "";
  if (Array.isArray(v.rules)) {
    const rules = v.rules.filter((r) => flowRuleSchema.safeParse(r).success) as KeywordVariant["rules"];
    if (!rules.length) return null;
    return { rules, match: v.match === "any" ? "any" : "all", value };
  }
  if (typeof v.country === "string" && v.country.length === 2) {
    return { rules: [{ id: `r_country_${v.country}`, field: "country", op: "is", value: v.country }], match: "all", value };
  }
  return null;
}

export function normalizeKeywordTrigger(raw: KeywordTrigger): KeywordTrigger {
  const variants = Array.isArray(raw.variants)
    ? (raw.variants as unknown[]).map(normalizeKeywordVariant).filter((v): v is KeywordVariant => v !== null)
    : [];
  return { ...raw, variants };
}

// Configuración del agente que devuelve la API (compat: bot por defecto).
export const agentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  effort: z.string(),
  systemPrompt: z.string(),
  enabledTools: z.array(z.string()),
  maxIterations: z.number(),
  escalationRules: escalationRulesSchema,
  monthlyTokenBudget: z.number(),
  availableTools: z.array(agentToolInfoSchema),
});
export type AgentConfigDto = z.infer<typeof agentConfigSchema>;

// Entrada para actualizar (todo opcional).
export const updateAgentConfigSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  model: z.string().min(1).optional(),
  effort: z.enum(effortValues).optional(),
  systemPrompt: z.string().min(1).max(100_000).optional(),
  enabledTools: z.array(z.string()).optional(),
  maxIterations: z.number().int().min(1).max(20).optional(),
  escalationRules: escalationRulesSchema.optional(),
  monthlyTokenBudget: z.number().int().min(0).optional(),
});
export type UpdateAgentConfigInput = z.infer<typeof updateAgentConfigSchema>;

// ── Bots (CRUD completo, multi-bot) ──────────────────────────

// Canal de WhatsApp al que se puede asignar un bot (resumen).
export const botChannelRefSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
});
export type BotChannelRef = z.infer<typeof botChannelRefSchema>;

// Bot completo que devuelve la API.
export const botSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  effort: z.string(),
  systemPrompt: z.string(),
  enabledTools: z.array(z.string()),
  maxIterations: z.number(),
  escalationRules: escalationRulesSchema,
  monthlyTokenBudget: z.number(),
  // Tokens consumidos en el mes en curso: da sentido al presupuesto, que si
  // no es un número a ciegas.
  tokensThisMonth: z.number(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  channelId: z.string().nullable(),
  channel: botChannelRefSchema.nullable(),
  // Automatización
  autopilotByDefault: z.boolean(),
  /** Segundos de espera desde el último mensaje del cliente antes de responder (0 = al instante). */
  replyDelaySec: z.number().int().min(0).max(60),
  welcomeEnabled: z.boolean(),
  welcomeMessage: z.string().nullable(),
  businessHoursEnabled: z.boolean(),
  businessHours: businessHoursSchema.nullable(),
  keywordTriggers: z.array(keywordTriggerSchema),
  createdAt: z.string(),
});
export type BotDto = z.infer<typeof botSchema>;

// Respuesta de lista: bots + catálogo de tools + canales disponibles.
export const botsResponseSchema = z.object({
  bots: z.array(botSchema),
  availableTools: z.array(agentToolInfoSchema),
  channels: z.array(botChannelRefSchema),
});
export type BotsResponse = z.infer<typeof botsResponseSchema>;

// Campos comunes editables de un bot.
const botFields = {
  name: z.string().min(1).max(120),
  model: z.string().min(1),
  effort: z.enum(effortValues),
  systemPrompt: z.string().min(1).max(100_000),
  enabledTools: z.array(z.string()),
  maxIterations: z.number().int().min(1).max(20),
  escalationRules: escalationRulesSchema,
  monthlyTokenBudget: z.number().int().min(0),
  isActive: z.boolean(),
  channelId: z.string().nullable(),
  autopilotByDefault: z.boolean(),
  /** Segundos de espera desde el último mensaje del cliente antes de responder (0 = al instante). */
  replyDelaySec: z.number().int().min(0).max(60),
  welcomeEnabled: z.boolean(),
  welcomeMessage: z.string().max(2000).nullable(),
  businessHoursEnabled: z.boolean(),
  businessHours: businessHoursSchema.nullable(),
  keywordTriggers: z.array(keywordTriggerSchema),
};

// Crear: todo con defaults sensatos para lo opcional.
export const createBotSchema = z.object({
  name: botFields.name,
  model: botFields.model.default("claude-opus-4-8"),
  effort: botFields.effort.default("medium"),
  systemPrompt: botFields.systemPrompt,
  enabledTools: botFields.enabledTools.default([]),
  maxIterations: botFields.maxIterations.default(6),
  escalationRules: botFields.escalationRules.default({}),
  monthlyTokenBudget: botFields.monthlyTokenBudget.default(0),
  isActive: botFields.isActive.default(true),
  channelId: botFields.channelId.default(null),
  autopilotByDefault: botFields.autopilotByDefault.default(false),
  replyDelaySec: botFields.replyDelaySec.default(4),
  welcomeEnabled: botFields.welcomeEnabled.default(false),
  welcomeMessage: botFields.welcomeMessage.default(null),
  businessHoursEnabled: botFields.businessHoursEnabled.default(false),
  businessHours: botFields.businessHours.default(null),
  keywordTriggers: botFields.keywordTriggers.default([]),
});
export type CreateBotInput = z.infer<typeof createBotSchema>;

// Actualizar: todo opcional.
export const updateBotSchema = z.object({
  name: botFields.name.optional(),
  model: botFields.model.optional(),
  effort: botFields.effort.optional(),
  systemPrompt: botFields.systemPrompt.optional(),
  enabledTools: botFields.enabledTools.optional(),
  maxIterations: botFields.maxIterations.optional(),
  escalationRules: botFields.escalationRules.optional(),
  monthlyTokenBudget: botFields.monthlyTokenBudget.optional(),
  isActive: botFields.isActive.optional(),
  channelId: botFields.channelId.optional(),
  autopilotByDefault: botFields.autopilotByDefault.optional(),
  replyDelaySec: botFields.replyDelaySec.optional(),
  welcomeEnabled: botFields.welcomeEnabled.optional(),
  welcomeMessage: botFields.welcomeMessage.optional(),
  businessHoursEnabled: botFields.businessHoursEnabled.optional(),
  businessHours: botFields.businessHours.optional(),
  keywordTriggers: botFields.keywordTriggers.optional(),
});
export type UpdateBotInput = z.infer<typeof updateBotSchema>;
