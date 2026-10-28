import { z } from "zod";
import { templateDtoSchema, templateFillSchema } from "./template.schema.js";

// ── Audiencia ────────────────────────────────────────────────
/**
 * A quién le llega una difusión. Siempre solo contactos con permiso
 * (opt-in). Vacío = todos ellos.
 */
export const campaignAudienceSchema = z.object({
  /** Con estas etiquetas: alguna o todas. */
  tags: z.array(z.string()).max(50).default([]),
  tagsMode: z.enum(["any", "all"]).default("any"),
  /** Sin estas etiquetas. */
  excludeTags: z.array(z.string()).max(50).default([]),
  /** Con una oportunidad abierta en estas etapas. */
  stageIds: z.array(z.string()).max(50).default([]),
  /** Solo estos contactos (elegidos en el embudo). Vacío = sin esta condición. */
  contactIds: z.array(z.string()).max(5000).default([]),
  /** De estas fuentes («none» = sin fuente). */
  sourceIds: z.array(z.string()).max(50).default([]),
  /** De estos países (código ISO, por el prefijo del teléfono). */
  countries: z.array(z.string().length(2)).max(60).default([]),
  /** Actividad: escribió en los últimos N días, o lleva más de N días sin escribir. */
  activity: z.enum(["any", "within", "older"]).default("any"),
  activityDays: z.number().int().min(1).max(365).default(30),
  /** No repetir: fuera quien recibió otra difusión en los últimos N días (null = no filtrar). */
  skipRecentDays: z.number().int().min(1).max(90).nullable().default(null),
});
export type CampaignAudience = z.infer<typeof campaignAudienceSchema>;
export const EMPTY_AUDIENCE: CampaignAudience = {
  tags: [],
  contactIds: [],
  tagsMode: "any",
  excludeTags: [],
  stageIds: [],
  sourceIds: [],
  countries: [],
  activity: "any",
  activityDays: 30,
  skipRecentDays: null,
};

// ── Campañas ─────────────────────────────────────────────────
export const campaignStatuses = [
  "DRAFT",
  "SCHEDULED",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
] as const;
export type CampaignStatusValue = (typeof campaignStatuses)[number];

export const campaignChannelRefSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
});
export type CampaignChannelRef = z.infer<typeof campaignChannelRefSchema>;

export const campaignDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(campaignStatuses),
  template: z.object({ id: z.string(), name: z.string() }),
  channel: campaignChannelRefSchema.nullable(),
  tagIds: z.array(z.string()),
  audience: campaignAudienceSchema,
  fill: templateFillSchema,
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  totalRecipients: z.number(),
  sentCount: z.number(),
  deliveredCount: z.number(),
  readCount: z.number(),
  failedCount: z.number(),
  /** Destinatarios que escribieron en los 7 días siguientes al envío. */
  repliedCount: z.number().default(0),
  createdAt: z.string(),
});
export type CampaignDto = z.infer<typeof campaignDtoSchema>;

// Etiqueta de audiencia (con conteo de contactos con opt-in).
export const audienceTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  contactCount: z.number(),
});
export type AudienceTag = z.infer<typeof audienceTagSchema>;

// Datos para el asistente de creación (plantillas, etiquetas, canales).
export const campaignMetaSchema = z.object({
  templates: z.array(templateDtoSchema),
  tags: z.array(audienceTagSchema),
  channels: z.array(campaignChannelRefSchema),
});
export type CampaignMeta = z.infer<typeof campaignMetaSchema>;

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(120),
  templateId: z.string().min(1),
  channelId: z.string().nullable().default(null),
  tagIds: z.array(z.string()).default([]),
  audience: campaignAudienceSchema.optional(),
  fill: templateFillSchema.default({ body: [], urlButtons: [] }),
  scheduledAt: z.string().datetime().nullable().default(null),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  templateId: z.string().min(1).optional(),
  channelId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
  audience: campaignAudienceSchema.optional(),
  fill: templateFillSchema.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

// Vista previa de audiencia (cuántos contactos recibirán).
export const audiencePreviewSchema = z.object({ count: z.number() });
export type AudiencePreview = z.infer<typeof audiencePreviewSchema>;

/** Recuento para el asistente: cuántos y cuántos quedan fuera por cada motivo. */
export const audienceCountSchema = z.object({
  count: z.number(),
  /** Con permiso, antes de los filtros. */
  optedIn: z.number(),
  /** Quedan fuera por «no repetir». */
  skippedRecent: z.number(),
});
export type AudienceCount = z.infer<typeof audienceCountSchema>;

// ── Destinatarios de una difusión ────────────────────────────
export const recipientStatuses = ["queued", "sent", "delivered", "read", "failed"] as const;
export type RecipientStatus = (typeof recipientStatuses)[number];
export const campaignRecipientSchema = z.object({
  contactId: z.string(),
  name: z.string().nullable(),
  phone: z.string(),
  status: z.enum(recipientStatuses),
  replied: z.boolean(),
  error: z.string().nullable(),
  sentAt: z.string(),
  conversationId: z.string(),
});
export type CampaignRecipient = z.infer<typeof campaignRecipientSchema>;

// ── Envío de prueba ──────────────────────────────────────────
export const campaignTestSchema = z.object({
  templateId: z.string().min(1),
  channelId: z.string().nullable().default(null),
  fill: templateFillSchema.default({ body: [], urlButtons: [] }),
  phone: z.string().trim().regex(/^\+?\d[\d\s-]{6,20}$/, "escribe el número con código de país"),
});
export type CampaignTestInput = z.infer<typeof campaignTestSchema>;

export const tagRespondersSchema = z.object({ tag: z.string().trim().min(1).max(60) });
export type TagRespondersInput = z.infer<typeof tagRespondersSchema>;
