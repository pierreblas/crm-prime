import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// Llamadas telefónicas: por Twilio desde el navegador, o registradas a mano
// (el vendedor llamó desde su celular).
// ─────────────────────────────────────────────────────────────

export const callDirections = ["INBOUND", "OUTBOUND"] as const;
export type CallDirection = (typeof callDirections)[number];

export const callStatuses = [
  "queued",
  "ringing",
  "in_progress",
  "completed",
  "missed", // entrante que nadie contestó
  "no_answer", // saliente sin respuesta
  "busy",
  "failed",
  "canceled",
] as const;
export type CallStatus = (typeof callStatuses)[number];

// Cómo fue la llamada, según quien la hizo o la atendió.
export const callOutcomes = ["answered", "no_answer", "voicemail", "busy", "wrong_number", "callback"] as const;
export type CallOutcome = (typeof callOutcomes)[number];

export const callDtoSchema = z.object({
  id: z.string(),
  contactId: z.string().nullable(),
  conversationId: z.string().nullable(),
  agent: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
  direction: z.enum(callDirections),
  status: z.enum(callStatuses),
  provider: z.string(), // twilio | manual
  fromNumber: z.string(),
  toNumber: z.string(),
  startedAt: z.string().nullable(),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSec: z.number().nullable(),
  // Referencia interna de la grabación (se sirve por el BFF, con sesión).
  recordingUrl: z.string().nullable(),
  transcript: z.string().nullable(),
  outcome: z.enum(callOutcomes).nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type CallDto = z.infer<typeof callDtoSchema>;

// Registrar a mano una llamada hecha o recibida fuera del CRM.
export const createManualCallSchema = z.object({
  contactId: z.string(),
  conversationId: z.string().optional(),
  direction: z.enum(callDirections).default("OUTBOUND"),
  outcome: z.enum(callOutcomes),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  note: z.string().max(1000).optional(),
  at: z.string().datetime().optional(), // cuándo fue; por defecto, ahora
});
export type CreateManualCallInput = z.infer<typeof createManualCallSchema>;

export const updateCallSchema = z.object({
  outcome: z.enum(callOutcomes).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});
export type UpdateCallInput = z.infer<typeof updateCallSchema>;

// Token para el softphone del navegador (Twilio Voice SDK).
export const callTokenSchema = z.object({
  token: z.string(),
  identity: z.string(),
  ttl: z.number(),
  number: z.string().nullable(),
});
export type CallToken = z.infer<typeof callTokenSchema>;

// ¿La empresa tiene llamadas desde el CRM? Lo que el navegador necesita saber.
export const callsConfigSchema = z.object({
  configured: z.boolean(),
  number: z.string().nullable(),
  recording: z.boolean(),
});
export type CallsConfig = z.infer<typeof callsConfigSchema>;

// Resultado de dejar Twilio apuntando a nuestros webhooks.
export const twilioProvisionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  appSid: z.string().nullable(),
  voiceUrl: z.string().nullable(),
});
export type TwilioProvisionResult = z.infer<typeof twilioProvisionResultSchema>;
