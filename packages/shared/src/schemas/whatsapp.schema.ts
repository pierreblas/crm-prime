import { z } from "zod";

// Un número de WhatsApp conectado (un "canal").
export const whatsappChannelSchema = z.object({
  id: z.string(), // id de la conexión ("env" para el del .env)
  phoneNumberId: z.string(),
  displayPhoneNumber: z.string().nullable(),
  label: z.string().nullable(), // alias visible: "Ventas", "Soporte"…
  wabaId: z.string().nullable(),
  mode: z.string(), // coexistence | api
  status: z.string(), // connected | error
  // Por qué está en error (token caducado, permisos…). Null si va bien.
  statusReason: z.string().nullable(),
  source: z.string(), // embedded | env
  isActive: z.boolean(),
  connectedAt: z.string().nullable(),
  // Embudo al que entran sus conversaciones nuevas; null = el predeterminado.
  pipelineId: z.string().nullable(),
  // Agente de IA que atiende este número; null = el predeterminado de la empresa.
  bot: z.object({ id: z.string(), name: z.string() }).nullable().default(null),
});
export type WhatsappChannel = z.infer<typeof whatsappChannelSchema>;

// Configuración de un número desde su propia ficha: alias, a qué embudo entran
// sus conversaciones y qué agente lo atiende (null = el predeterminado).
export const updateChannelSchema = z.object({
  label: z.string().max(60).nullable().optional(),
  pipelineId: z.string().nullable().optional(),
  botId: z.string().nullable().optional(),
});
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

// Lista de canales que muestra el panel (multi-número).
export const whatsappChannelsSchema = z.object({
  channels: z.array(whatsappChannelSchema),
});
export type WhatsappChannels = z.infer<typeof whatsappChannelsSchema>;

// Comprobar que el token de un canal sigue siendo válido contra Meta.
export const testChannelSchema = z.object({
  phoneNumberId: z.string().min(1),
});
export type TestChannelInput = z.infer<typeof testChannelSchema>;

/** Una comprobación del diagnóstico de un número. ok = null: no se pudo comprobar. */
export const channelCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  ok: z.boolean().nullable(),
  detail: z.string().nullable(),
});
export type ChannelCheck = z.infer<typeof channelCheckSchema>;

export const channelTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  displayPhoneNumber: z.string().nullable(),
  /** Token, plataforma, suscripción de la WABA, webhook de la app y último evento recibido. */
  checks: z.array(channelCheckSchema).default([]),
  lastWebhookAt: z.string().nullable().optional(),
});
export type ChannelTestResult = z.infer<typeof channelTestResultSchema>;

// Estado agregado (compatibilidad: ¿hay al menos un número conectado?).
export const whatsappConnectionStatusSchema = z.object({
  connected: z.boolean(),
  phoneNumberId: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
  wabaId: z.string().nullable(),
  mode: z.string().nullable(), // coexistence | api
  source: z.string().nullable(), // embedded | env | null
});
export type WhatsappConnectionStatus = z.infer<
  typeof whatsappConnectionStatusSchema
>;

// Datos que envía el Embedded Signup al conectar un número.
export const connectWhatsappSchema = z
  .object({
    code: z.string().optional(), // código del Embedded Signup (se canjea por token)
    accessToken: z.string().optional(), // o un token directo
    wabaId: z.string().optional(),
    // En coexistencia Meta solo devuelve la WABA: el número lo busca la API.
    phoneNumberId: z.string().min(1).optional(),
    displayPhoneNumber: z.string().optional(),
    label: z.string().max(60).optional(), // alias opcional del número
    mode: z.enum(["coexistence", "api"]).default("coexistence"),
  })
  .refine((v) => !!v.code || !!v.accessToken, {
    message: "Se requiere code o accessToken",
  })
  .refine((v) => !!v.phoneNumberId || !!v.wabaId, {
    message: "Se requiere phoneNumberId o wabaId",
  });
export type ConnectWhatsappInput = z.infer<typeof connectWhatsappSchema>;

// Desconectar un número concreto (por su phoneNumberId).
export const disconnectWhatsappSchema = z.object({
  phoneNumberId: z.string().min(1),
});
export type DisconnectWhatsappInput = z.infer<typeof disconnectWhatsappSchema>;

// ── Conector en dominio fijo (SaaS) ─────────────────────────
// El SDK de Meta corre en el dominio raíz; el panel de la empresa pide un pase
// y salta allí. Ver ConnectHubController en la API.

/** Respuesta al pedir el pase. `connectUrl: null` = instalación de una sola empresa. */
export interface ConnectTicketResult {
  ticket: string | null;
  connectUrl: string | null;
  /** Si el plan de la empresa incluye la coexistencia (el conector elige el flujo). */
  coexistence: boolean;
}

/** Estado del registro integrado, para la pantalla de WhatsApp. */
export interface ConnectHubStatus {
  /** Instalación SaaS: el SDK de Meta corre en el conector del dominio raíz. */
  saas: boolean;
  /** Si Meta ya aprobó a la plataforma como proveedor tecnológico (acceso avanzado). */
  approval: "approved" | "pending";
  coexistence: boolean;
}

/** Lo que el conector manda a la API al terminar el Embedded Signup. */
export const connectWithTicketSchema = z
  .object({
    ticket: z.string().min(1),
    code: z.string().min(1),
    phoneNumberId: z.string().min(1).optional(),
    wabaId: z.string().optional(),
    mode: z.enum(["coexistence", "api"]).default("coexistence"),
  })
  .refine((v) => !!v.phoneNumberId || !!v.wabaId, {
    message: "Se requiere phoneNumberId o wabaId",
  });
export type ConnectWithTicketInput = z.infer<typeof connectWithTicketSchema>;

export interface ConnectWithTicketResult {
  ok: true;
  /** A dónde vuelve el usuario: el panel de su empresa, ya con el número guardado. */
  returnUrl: string;
}
