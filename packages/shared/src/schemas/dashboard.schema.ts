import { z } from "zod";

/**
 * Panel de la empresa: cómo va el negocio en un periodo. Todo se calcula en la
 * zona horaria del navegador de quien lo mira, para que "hoy" y las horas
 * pico sean las suyas y no las del servidor.
 */
export const dashboardPeriods = ["7d", "30d", "90d"] as const;
export type DashboardPeriod = (typeof dashboardPeriods)[number];

const kpi = z.object({ value: z.number().nullable(), prev: z.number().nullable() });
export type DashboardKpi = z.infer<typeof kpi>;

export const dashboardSchema = z.object({
  period: z.enum(dashboardPeriods),
  from: z.string(),
  to: z.string(),
  tz: z.string(),
  /** Moneda principal: la más usada en las oportunidades del periodo. */
  currency: z.string(),
  kpis: z.object({
    conversations: kpi,
    leads: kpi,
    inbound: kpi,
    /** Mediana en segundos del primer mensaje del cliente a la primera respuesta. */
    firstResponseSec: kpi,
    /** Parte de las respuestas que dio la IA (0-1). */
    aiShare: kpi,
    wonCount: kpi,
    /** Valor ganado en la moneda principal. */
    wonValue: kpi,
    /** Ganadas / (ganadas + perdidas), 0-1. */
    winRate: kpi,
    awaitingNow: z.number(),
  }),
  daily: z.array(
    z.object({
      day: z.string(),
      conversations: z.number(),
      leads: z.number(),
      inbound: z.number(),
      outboundAi: z.number(),
      outboundHuman: z.number(),
      wonValue: z.number(),
    }),
  ),
  /**
   * De dónde vienen los contactos nuevos. `kind` dice si la fuente es la automática
   * de un canal (whatsapp, ad, form, messenger, instagram, tiktok) y `color` es el
   * que le puso la empresa: con eso la web le pinta su símbolo. `id` null = sin fuente.
   */
  sources: z.array(
    z.object({
      id: z.string().nullable().default(null),
      name: z.string(),
      kind: z.string().nullable().default(null),
      color: z.string().nullable().default(null),
      count: z.number(),
    }),
  ),
  /** Perdidas del periodo por motivo («Sin motivo» si no se indicó). */
  lossReasons: z.array(z.object({ reason: z.string(), count: z.number() })).default([]),
  funnel: z.object({
    pipelineId: z.string().nullable(),
    pipelineName: z.string().nullable(),
    pipelines: z.array(z.object({ id: z.string(), name: z.string() })),
    stages: z.array(
      z.object({ id: z.string(), name: z.string(), count: z.number(), value: z.number(), isWon: z.boolean(), isLost: z.boolean() }),
    ),
  }),
  team: z.array(
    z.object({
      userId: z.string().nullable(),
      name: z.string(),
      conversations: z.number(),
      closed: z.number(),
      awaiting: z.number(),
      firstResponseSec: z.number().nullable(),
    }),
  ),
  /** Mensajes de clientes por día de la semana (0 = domingo) y hora. */
  heatmap: z.array(z.array(z.number())),
});
export type DashboardDto = z.infer<typeof dashboardSchema>;

/**
 * Ventas por anuncio: de los clientes que escribieron desde un anuncio de Meta
 * (Click to WhatsApp, Instagram o Messenger) en el periodo, cuántos llegaron a
 * potencial y cuántos compraron, por anuncio. Cada cliente cuenta una vez, para
 * el último anuncio por el que escribió (como Meta), y solo cuentan las
 * oportunidades posteriores a su primer clic del periodo.
 */
const adSalesCounts = z.object({
  /** Clientes distintos. */
  chats: z.number(),
  /** Con una oportunidad que llegó a una etapa «potencial» o ya ganada. */
  qualified: z.number(),
  /** Con una oportunidad ganada. */
  won: z.number(),
  /** Valor ganado en la moneda principal. */
  wonValue: z.number(),
});
export type AdSalesCounts = z.infer<typeof adSalesCounts>;

export const adSalesRowSchema = adSalesCounts.extend({
  key: z.string(),
  label: z.string(),
  /** Enlace del anuncio o la publicación (solo http/https). */
  sourceUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  /** «ad» o «post», como lo manda Meta. */
  sourceType: z.string().nullable(),
  channels: z.array(z.string()),
  /** Clientes de este anuncio con alguna oportunidad avisada a Meta (Conversions API). */
  sentToMeta: z.number(),
  lastAt: z.string(),
});
export type AdSalesRow = z.infer<typeof adSalesRowSchema>;

export const adSalesReportSchema = z.object({
  period: z.enum(dashboardPeriods),
  currency: z.string(),
  /** Hay ventas en otras monedas que no suman en el valor. */
  otherCurrencies: z.boolean(),
  totals: adSalesCounts.extend({
    /** Clientes cuyo último clic trae ctwa_clid: los únicos que se pueden avisar a Meta. */
    reportable: z.number(),
    sentToMeta: z.number(),
  }),
  ads: z.array(adSalesRowSchema),
  /** Los que empezaron a escribir en el periodo sin venir de un anuncio, para comparar. */
  organic: adSalesCounts,
});
export type AdSalesReport = z.infer<typeof adSalesReportSchema>;
