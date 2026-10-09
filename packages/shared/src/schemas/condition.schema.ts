import { z } from "zod";

/**
 * Condiciones sobre una conversación. Las usan el bloque «Condición» de los
 * flujos y las versiones de una respuesta por palabra clave del agente.
 * Viven aparte porque flow.schema y agent-config.schema se importan entre sí.
 */

// Qué puede mirar una regla.
export const conditionFields = [
  "message", // el último mensaje del cliente
  "variable", // una variable del flujo (key = nombre)
  "contact_name",
  "contact_phone",
  "country", // país del contacto por el prefijo de su teléfono (value = código ISO: PE, MX…)
  "contact_field", // campo personalizado (key = clave del campo)
  "tag", // el contacto tiene la etiqueta (value = nombre)
  "source", // fuente del contacto (value = id; "" = sin fuente)
  "channel", // número de WhatsApp (value = id)
  "status", // OPEN | PENDING | CLOSED
  "ai_mode", // OFF | COPILOT | AUTOPILOT
  "assigned", // agente asignado (value = id; "none" = nadie)
  "stage", // etapa de su oportunidad abierta (value = id)
  "is_new", // es su primer mensaje ("yes" | "no")
  "messages_count", // mensajes que ha enviado el contacto
] as const;
export type ConditionField = (typeof conditionFields)[number];

export const conditionOps = [
  "contains", // alguna de las palabras (separadas por comas)
  "not_contains",
  "equals", // igual a (admite varias opciones separadas por comas)
  "not_equals",
  "starts_with",
  "regex",
  "empty",
  "not_empty",
  "gt",
  "lt",
  "is", // para los campos de opción (estado, fuente, etapa…)
  "is_not",
] as const;
export type ConditionOp = (typeof conditionOps)[number];

export const flowRuleSchema = z.object({
  id: z.string(),
  field: z.enum(conditionFields),
  key: z.string().optional(), // variable o clave de campo
  op: z.enum(conditionOps),
  value: z.string().optional(), // admite {{variables}}
});
export type FlowRule = z.infer<typeof flowRuleSchema>;

export const ruleMatchModes = ["all", "any"] as const;
export type RuleMatchMode = (typeof ruleMatchModes)[number];
