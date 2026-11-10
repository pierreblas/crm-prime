import { z } from "zod";

/**
 * TikTok como canal de la bandeja (Business Messaging API). Una cuenta de
 * empresa de TikTok se conecta con su propio login (OAuth en tiktok.com) y
 * sus mensajes directos entran como conversaciones. Reglas de TikTok que
 * marcan el canal: solo texto e imagen, el cliente escribe primero, y se
 * puede responder hasta 48 h después de su último mensaje (sin plantillas
 * ni «agente humano»).
 */

/** Permisos que se piden al conectar: perfil de la cuenta y sus mensajes directos. */
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "user.info.username",
  "user.info.stats",
  "user.info.profile",
  "user.account.type",
  "user.insights",
  "message.list.read",
  "message.list.send",
  "message.list.manage",
] as const;

/** Horas para responder libremente tras el último mensaje del cliente. */
export const TIKTOK_WINDOW_HOURS = 48;

export const tiktokAccountStatuses = ["connected", "reauth_required", "error"] as const;
export type TikTokAccountStatus = (typeof tiktokAccountStatuses)[number];

export const tiktokAccountDtoSchema = z.object({
  id: z.string(),
  /** Identificador de la cuenta en nuestra app (open_id); llega en cada webhook. */
  businessId: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  status: z.enum(tiktokAccountStatuses),
  statusReason: z.string().nullable(),
  isActive: z.boolean(),
  connectedAt: z.string(),
  /** Hasta cuándo vale el token actual (se renueva solo mientras el refresco viva). */
  tokenExpiresAt: z.string().nullable(),
  lastWebhookAt: z.string().nullable(),
  /** Agente de IA que la atiende; null = el predeterminado. */
  bot: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Embudo de entrada; null = el predeterminado. */
  pipelineId: z.string().nullable(),
  /** Fuente de sus contactos; null = la automática «TikTok». */
  sourceId: z.string().nullable(),
});
export type TikTokAccountDto = z.infer<typeof tiktokAccountDtoSchema>;

export const tiktokAccountsResponseSchema = z.object({
  /** La app de TikTok está configurada en el servidor (TIKTOK_APP_ID y secreto). */
  configured: z.boolean(),
  /** La URL de retorno que debe estar registrada en la app de TikTok. */
  callbackUrl: z.string().nullable(),
  /** La URL que recibe los webhooks (se registra sola en la app). */
  webhookUrl: z.string().nullable(),
  accounts: z.array(tiktokAccountDtoSchema),
});
export type TikTokAccountsResponse = z.infer<typeof tiktokAccountsResponseSchema>;

export const updateTikTokAccountSchema = z.object({
  isActive: z.boolean().optional(),
  botId: z.string().nullable().optional(),
  pipelineId: z.string().nullable().optional(),
  sourceId: z.string().nullable().optional(),
});
export type UpdateTikTokAccountInput = z.infer<typeof updateTikTokAccountSchema>;

/** Dónde mandar al administrador para autorizar en TikTok. */
export const tiktokConnectStartSchema = z.object({ url: z.string() });
export type TikTokConnectStart = z.infer<typeof tiktokConnectStartSchema>;
