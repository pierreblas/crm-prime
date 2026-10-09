import { z } from "zod";
import { apiKeyStateSchema } from "./ai-settings.schema.js";

/**
 * Credenciales que el CRM CONSUME para llamar a terceros y que hasta ahora
 * solo vivían en el .env. Mismo patrón que los ajustes de IA: se guardan
 * cifradas en la BD y, si están vacías, se usa la variable de entorno.
 *
 * El token de WhatsApp por número NO está aquí: vive en cada canal
 * (WhatsappConnection.accessToken, pestaña Canales). Aquí solo lo que es
 * a nivel de aplicación de Meta.
 */
export const integrationSettingsSchema = z.object({
  // Embeddings del RAG (Voyage AI).
  voyageKey: apiKeyStateSchema,
  voyageModel: z.string(),
  embeddingsProvider: z.string(), // "voyage" | "fake" — el que se usará

  // WhatsApp a nivel de app de Meta (no por número).
  whatsappAppId: z.string().nullable(),
  whatsappAppSecret: apiKeyStateSchema,
  whatsappVerifyToken: apiKeyStateSchema,
  whatsappGraphVersion: z.string(),
  // SaaS: URL a la que la empresa apunta el webhook de su PROPIA app de Meta
  // (acme.driony.com/api/v1/webhooks/whatsapp). null con una sola empresa.
  whatsappWebhookUrl: z.string().nullable(),
  // Si no hay app secret, la firma del webhook NO se verifica: hay que avisar.
  webhookSignatureVerified: z.boolean(),

  // Llamadas telefónicas (Twilio), por empresa.
  twilioAccountSid: z.string().nullable(),
  twilioAuthToken: apiKeyStateSchema,
  twilioApiKeySid: z.string().nullable(),
  twilioApiKeySecret: apiKeyStateSchema,
  twilioNumber: z.string().nullable(),
  twilioRecord: z.boolean(),
  twilioAppSid: z.string().nullable(), // TwiML App creada al activar; null = sin activar
  twilioConfigured: z.boolean(), // credenciales completas
  // Base pública de los webhooks (/api/v1/calls/twilio/<empresa>/…); null si el servidor no la sabe.
  twilioWebhookBase: z.string().nullable(),
});
export type IntegrationSettingsDto = z.infer<typeof integrationSettingsSchema>;

// Enviar "" en un secreto lo borra de la BD (vuelve al valor del .env).
export const updateIntegrationSettingsSchema = z.object({
  voyageKey: z.string().max(400).optional(),
  voyageModel: z.string().min(1).max(80).optional(),
  whatsappAppId: z.string().max(80).nullable().optional(),
  whatsappAppSecret: z.string().max(400).optional(),
  whatsappVerifyToken: z.string().max(400).optional(),
  whatsappGraphVersion: z.string().min(2).max(10).optional(),
  twilioAccountSid: z.string().max(60).nullable().optional(),
  twilioAuthToken: z.string().max(200).optional(),
  twilioApiKeySid: z.string().max(60).nullable().optional(),
  twilioApiKeySecret: z.string().max(200).optional(),
  twilioNumber: z.string().max(30).nullable().optional(),
  twilioRecord: z.boolean().optional(),
});
export type UpdateIntegrationSettingsInput = z.infer<
  typeof updateIntegrationSettingsSchema
>;

// Resultado de "Probar" una integración concreta.
export const integrationTestTargets = ["voyage"] as const;
export type IntegrationTestTarget = (typeof integrationTestTargets)[number];

export const integrationTestSchema = z.object({
  target: z.enum(integrationTestTargets),
});
export type IntegrationTestInput = z.infer<typeof integrationTestSchema>;

export const integrationTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number(),
});
export type IntegrationTestResult = z.infer<typeof integrationTestResultSchema>;
