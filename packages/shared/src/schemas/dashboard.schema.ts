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
  sources: z.array(z.object({ name: z.string(), count: z.number() })),
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
