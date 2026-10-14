import { z } from "zod";

/**
 * Conversiones de anuncios: eventos que Driony envía a Meta (Conversions API
 * for Business Messaging) cuando un chat que vino de un anuncio Click to
 * WhatsApp avanza en el embudo. Se atribuyen con el ctwa_clid del anuncio.
 *  - LeadSubmitted: la oportunidad llega a una etapa con rol «Potencial».
 *  - Purchase: llega a una etapa con rol «Ganada», con el valor de la oportunidad.
 */
export const conversionEventNames = ["LeadSubmitted", "Purchase"] as const;
export type ConversionEventName = (typeof conversionEventNames)[number];

export const conversionChannelSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
  wabaId: z.string().nullable(),
  enabled: z.boolean(),
  datasetId: z.string().nullable(),
});
export type ConversionChannel = z.infer<typeof conversionChannelSchema>;

export const conversionEventDtoSchema = z.object({
  id: z.string(),
  eventName: z.string(),
  status: z.enum(["sent", "failed"]),
  value: z.number().nullable(),
  currency: z.string().nullable(),
  error: z.string().nullable(),
  dealId: z.string(),
  dealTitle: z.string().nullable(),
  contactName: z.string().nullable(),
  channelLabel: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ConversionEventDto = z.infer<typeof conversionEventDtoSchema>;

export const conversionsOverviewSchema = z.object({
  channels: z.array(conversionChannelSchema),
  events: z.array(conversionEventDtoSchema),
});
export type ConversionsOverview = z.infer<typeof conversionsOverviewSchema>;
