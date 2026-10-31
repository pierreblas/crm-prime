import { z } from "zod";

/**
 * Conversiones de anuncios: eventos que Driony envía a Meta (Conversions API
 * for Business Messaging) cuando un chat que vino de un anuncio Click to
 * WhatsApp avanza en el embudo. Se atribuyen con el ctwa_clid del anuncio.
 * Cada etapa del embudo lleva su propia lista de eventos (varios por etapa);
 * un embudo nuevo arranca con LeadSubmitted en «Potencial» y Purchase en «Ganada».
 *
 * Son los eventos que Meta admite para mensajería (FAQ de
 * developers.facebook.com/docs/marketing-api/conversions-api/business-messaging).
 * Un nombre propio se puede poner, pero Meta no garantiza aceptarlo.
 */
export const metaStandardEvents = [
  "LeadSubmitted",
  "QualifiedLead",
  "Purchase",
  "InitiateCheckout",
  "AddToCart",
  "ViewContent",
  "CartAbandoned",
  "OrderCreated",
  "OrderShipped",
  "OrderDelivered",
  "OrderCanceled",
  "OrderReturned",
  "RatingProvided",
  "ReviewProvided",
] as const;
export type MetaStandardEvent = (typeof metaStandardEvents)[number];
/** Compatibilidad: los dos eventos que ya existían. */
export const conversionEventNames = ["LeadSubmitted", "Purchase"] as const;
export type ConversionEventName = (typeof conversionEventNames)[number];

/** Un evento configurado en una etapa. Nombre estándar de Meta o uno propio. */
export const stageConversionEventSchema = z.object({
  eventName: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Solo letras, números y guion bajo, sin espacios"),
  /** Mandar el valor y la moneda de la oportunidad (Purchase lo lleva siempre). */
  withValue: z.boolean().default(false),
});
export type StageConversionEvent = z.infer<typeof stageConversionEventSchema>;
export const stageConversionEventsSchema = z.array(stageConversionEventSchema).max(10);

/** Lee la lista guardada en la etapa (JSON libre) sin fiarse del formato. */
export function parseStageConversionEvents(raw: unknown): StageConversionEvent[] {
  const r = stageConversionEventsSchema.safeParse(raw);
  if (!r.success) return [];
  const seen = new Set<string>();
  return r.data.filter((e) => (seen.has(e.eventName) ? false : (seen.add(e.eventName), true)));
}

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
