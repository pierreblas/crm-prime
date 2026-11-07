import { z } from "zod";

/**
 * Webhooks salientes: el CRM avisa a sistemas externos cuando pasa algo.
 *
 * Es lo contrario de la API pública. Sin esto el CRM es un silo al que hay
 * que preguntar; con esto participa en un flujo automatizado (n8n, Zapier,
 * un ERP) que reacciona en cuanto ocurre el hecho.
 */

export const webhookEvents = [
  "message.received",
  "message.sent",
  "contact.created",
  "deal.created",
  "deal.stage_changed",
  "conversation.escalated",
  "booking.created",
  "booking.rescheduled",
  "booking.cancelled",
] as const;
export type WebhookEvent = (typeof webhookEvents)[number];

export const webhookEventLabels: Record<WebhookEvent, string> = {
  "message.received": "Entra un mensaje",
  "message.sent": "Se envía un mensaje",
  "contact.created": "Se crea un contacto",
  "deal.created": "Se crea una oportunidad",
  "deal.stage_changed": "Una oportunidad cambia de etapa",
  "conversation.escalated": "La IA escala a un humano",
  "booking.created": "Se reserva una cita",
  "booking.rescheduled": "Se mueve una cita",
  "booking.cancelled": "Se cancela una cita",
};

export const webhookSubscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  events: z.array(z.enum(webhookEvents)),
  isActive: z.boolean(),
  lastStatus: z.number().nullable(),
  lastError: z.string().nullable(),
  lastDeliveryAt: z.string().nullable(),
  deliveredCount: z.number(),
  failedCount: z.number(),
  createdAt: z.string(),
});
export type WebhookSubscriptionDto = z.infer<typeof webhookSubscriptionSchema>;

export const createWebhookSchema = z.object({
  name: z.string().min(1, "Ponle un nombre").max(80),
  url: z
    .string()
    .url("Tiene que ser una URL completa (https://…)")
    .max(500),
  events: z.array(z.enum(webhookEvents)).min(1, "Elige al menos un evento"),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  url: z.string().url().max(500).optional(),
  events: z.array(z.enum(webhookEvents)).min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

// El secreto solo se ve al crear la suscripción; después solo su hash de uso.
export const createdWebhookSchema = z.object({
  subscription: webhookSubscriptionSchema,
  secret: z.string(),
});
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;

export const webhookTestResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().nullable(),
  message: z.string(),
  latencyMs: z.number(),
});
export type WebhookTestResult = z.infer<typeof webhookTestResultSchema>;
