import { z } from "zod";

// ── Asistente de redacción para agentes ───────────────────────
// Ayuda a escribir (o mejorar) las instrucciones de un agente de IA y otros
// textos del CRM: bienvenida, fuera de horario, respuestas rápidas o lo que
// se le pida. Solo propone; el usuario decide si aplica el texto al campo.

/** Campo para el que se redacta: cambia las reglas del formato del texto. */
export const promptAssistantTargets = [
  "systemPrompt", // instrucciones del agente (el "system prompt")
  "welcomeMessage", // saludo automático al primer mensaje
  "outOfHoursMessage", // respuesta fija fuera de horario
  "quickReply", // respuesta rápida para el equipo
  "free", // cualquier otro texto
] as const;
export type PromptAssistantTarget = (typeof promptAssistantTargets)[number];

export const promptAssistantTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type PromptAssistantTurn = z.infer<typeof promptAssistantTurnSchema>;

export const promptAssistantRequestSchema = z.object({
  // Hasta 8000: lo dictado por audio (unos cinco minutos) cabe entero.
  prompt: z.string().min(1).max(8000),
  target: z.enum(promptAssistantTargets).default("systemPrompt"),
  // Texto que hay ahora en el campo: si existe, el asistente lo mejora en
  // lugar de partir de cero.
  current: z.string().max(20000).default(""),
  // Contexto del agente que se está editando (para no inventar herramientas).
  botName: z.string().max(120).nullable().default(null),
  enabledTools: z.array(z.string().max(60)).max(30).default([]),
  // Turnos previos del chat (para pedir ajustes encadenados).
  history: z.array(promptAssistantTurnSchema).max(20).default([]),
});
export type PromptAssistantRequest = z.infer<typeof promptAssistantRequestSchema>;

export const promptAssistantReplySchema = z.object({
  // Explicación breve, o preguntas si le falta información.
  message: z.string(),
  // Texto propuesto para el campo. null = solo respondió, no propone cambios.
  proposal: z.string().nullable(),
  model: z.string(),
  provider: z.string(),
});
export type PromptAssistantReply = z.infer<typeof promptAssistantReplySchema>;

/**
 * Audio para armar el agente: quien lo configura graba o sube una nota de voz
 * contando su negocio y se convierte en texto, que revisa antes de enviarlo.
 */
export const ASSISTANT_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
/** Lo que dura como mucho una grabación hecha en la pantalla. */
export const ASSISTANT_AUDIO_MAX_SECONDS = 300;
export interface AssistantTranscript {
  text: string;
}
