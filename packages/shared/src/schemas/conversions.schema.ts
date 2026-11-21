import { z } from "zod";

/**
 * Conversiones de anuncios: eventos que Driony envía a Meta cuando un cliente
 * que vino de un anuncio avanza en el embudo. Dos vías:
 *  - chats de un anuncio Click to WhatsApp (Conversions API for Business
 *    Messaging), atribuidos con el ctwa_clid del anuncio;
 *  - leads de formularios de Meta (Conversions API, integración de CRM),
 *    atribuidos con el id del lead.
 * Cada etapa del embudo lleva su propia lista de eventos (varios por etapa);
 * un embudo nuevo arranca con LeadSubmitted en «Potencial» y Purchase en «Ganada».
 *
 * Son los eventos que Meta admite para mensajería (lista de
 * developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging).
 * Meta no admite eventos propios en mensajería: la pantalla ya no los ofrece,
 * aunque una etapa que ya tuviera uno lo conserva (y lo marca para cambiarlo).
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

export type MetaEventGroup = "main" | "store" | "reviews";
export const META_EVENT_GROUPS: { key: MetaEventGroup; label: string }[] = [
  { key: "main", label: "Los más usados" },
  { key: "store", label: "Tienda y pedidos" },
  { key: "reviews", label: "Opiniones" },
];

/**
 * Cómo se le explica cada evento a quien lo configura: qué significa en su
 * negocio y qué hace Meta con él. Casi todos usan solo los tres primeros.
 */
export const META_EVENT_INFO: Record<MetaStandardEvent, { label: string; help: string; group: MetaEventGroup }> = {
  LeadSubmitted: {
    label: "Lead interesado",
    help: "Mostró interés real: pidió precio, dejó sus datos o quiere comprar. Meta busca más gente así.",
    group: "main",
  },
  QualifiedLead: {
    label: "Lead calificado",
    help: "Tu equipo confirmó que es un buen cliente potencial. Meta busca clientes de más calidad, no solo más chats.",
    group: "main",
  },
  Purchase: {
    label: "Compra",
    help: "Compró. Va con el valor de la oportunidad: Meta busca compradores parecidos y mide cuánto vendieron tus anuncios. Si no tiene valor, espera a que se lo pongas.",
    group: "main",
  },
  ViewContent: { label: "Vio un producto", help: "Pidió o recibió un producto o el catálogo.", group: "store" },
  AddToCart: { label: "Añadió al carrito", help: "Eligió un producto para comprarlo.", group: "store" },
  InitiateCheckout: { label: "Empezó a pagar", help: "Le enviaste el enlace o los datos para pagar.", group: "store" },
  CartAbandoned: { label: "Carrito abandonado", help: "Eligió productos pero no terminó la compra.", group: "store" },
  OrderCreated: { label: "Pedido creado", help: "Se registró su pedido.", group: "store" },
  OrderShipped: { label: "Pedido enviado", help: "El pedido salió hacia el cliente.", group: "store" },
  OrderDelivered: { label: "Pedido entregado", help: "El cliente recibió su pedido.", group: "store" },
  OrderCanceled: { label: "Pedido cancelado", help: "El pedido se canceló.", group: "store" },
  OrderReturned: { label: "Pedido devuelto", help: "El cliente devolvió el pedido.", group: "store" },
  RatingProvided: { label: "Dio una valoración", help: "Puntuó tu atención o tu producto.", group: "reviews" },
  ReviewProvided: { label: "Dejó una reseña", help: "Escribió una opinión sobre tu negocio.", group: "reviews" },
};

/**
 * El evento que Driony manda solo, sin configurarlo en ninguna etapa, cuando
 * entra un lead de un formulario de Meta. Meta pide todas las etapas, también
 * la inicial, y solo configura el embudo si recibe eventos de la mayoría de
 * los leads: con este, cada lead que entra cuenta.
 */
export const META_FORM_LEAD_EVENT = "Lead";

/** «Compra (Purchase)»: el nombre del negocio y el de Meta, para encontrarlo en el Administrador de eventos. */
export function metaEventLabel(name: string): string {
  if (name === META_FORM_LEAD_EVENT) return `Lead recibido (${name})`;
  const info = (META_EVENT_INFO as Record<string, { label: string } | undefined>)[name];
  return info ? `${info.label} (${name})` : name;
}
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

/**
 * Una página de Facebook y el conjunto de datos (píxel) de Meta que recibe
 * las conversiones de los leads de sus formularios. El token del conjunto de
 * datos NUNCA sale de la API: el navegador solo sabe si hay uno guardado.
 */
export const conversionFormChannelSchema = z.object({
  /** La página conectada (su fila en Driony). */
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  /** Identificador del conjunto de datos (píxel) en el Administrador de eventos. */
  datasetId: z.string().nullable(),
  hasToken: z.boolean(),
});
export type ConversionFormChannel = z.infer<typeof conversionFormChannelSchema>;

/** Conectar (o cambiar) el conjunto de datos de una página. Sin token se conserva el guardado. */
export const enableFormConversionsSchema = z.object({
  datasetId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "El identificador del conjunto de datos son solo números: cópialo del Administrador de eventos"),
  accessToken: z.string().trim().min(20, "Ese token es demasiado corto: cópialo entero").max(1000).optional(),
});
export type EnableFormConversionsInput = z.infer<typeof enableFormConversionsSchema>;

/** Por dónde vino el cliente del evento: un anuncio de clic a WhatsApp o un formulario de Meta. */
export const conversionEventChannels = ["whatsapp", "form"] as const;
export type ConversionEventChannel = (typeof conversionEventChannels)[number];

export const conversionEventDtoSchema = z.object({
  id: z.string(),
  eventName: z.string(),
  /** waiting: una compra que espera el valor de la oportunidad para salir. */
  status: z.enum(["sent", "failed", "waiting"]),
  value: z.number().nullable(),
  currency: z.string().nullable(),
  error: z.string().nullable(),
  channel: z.enum(conversionEventChannels).default("whatsapp"),
  /** Null: el «Lead» de un lead de formulario recién llegado, que aún no es de ninguna oportunidad. */
  dealId: z.string().nullable(),
  dealTitle: z.string().nullable(),
  contactName: z.string().nullable(),
  /** El número de WhatsApp o la página de Facebook por donde salió. */
  channelLabel: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ConversionEventDto = z.infer<typeof conversionEventDtoSchema>;

export const conversionsOverviewSchema = z.object({
  channels: z.array(conversionChannelSchema),
  forms: z.array(conversionFormChannelSchema).default([]),
  events: z.array(conversionEventDtoSchema),
});
export type ConversionsOverview = z.infer<typeof conversionsOverviewSchema>;
