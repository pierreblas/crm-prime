import { z } from "zod";
import { planDefSchema, planKeySchema } from "../plans.js";

// ── Lo que ve cada empresa de su plan (Ajustes › Plan) ────────

export const myPlanSchema = z.object({
  /** false = instalación propia: no hay planes ni límites. */
  saas: z.boolean(),
  plan: planDefSchema,
  usage: z.object({ numbers: z.number(), users: z.number(), contacts: z.number(), deals: z.number(), activeContacts: z.number() }),
  /** El catálogo completo, para comparar. Vacío en instalación propia. */
  plans: z.array(planDefSchema),
  /** A quién escribir para cambiar de plan (no hay cobro automático). */
  contactEmail: z.string().nullable(),
});
export type MyPlanDto = z.infer<typeof myPlanSchema>;

// ── Consola de plataforma (solo el operador del SaaS) ─────────

const dayCount = z.object({ day: z.string(), count: z.number() });
const dayTraffic = z.object({ day: z.string(), inbound: z.number(), outbound: z.number() });

export const platformOverviewSchema = z.object({
  orgs: z.number(),
  activeOrgs: z.number(),
  new7d: z.number(),
  new30d: z.number(),
  /** Empresas con mensajes en los últimos 7 días. */
  orgsActive7d: z.number(),
  users: z.number(),
  numbers: z.number(),
  coexistenceNumbers: z.number(),
  messages7d: z.number(),
  aiCostMonthUsd: z.number(),
  /** Empresas activas en un plan de pago, y lo que suman a precio de lista al mes. */
  payingOrgs: z.number(),
  mrrUsd: z.number(),
  /** Planes que vencen en 7 días o ya vencieron (empresas activas). */
  expiring7d: z.number(),
  numbersWithError: z.number(),
  signupsByDay: z.array(dayCount),
  messagesByDay: z.array(dayTraffic),
  byPlan: z.array(z.object({ plan: z.string(), count: z.number() })),
});
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;

export const platformOrgSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  url: z.string(),
  plan: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  adminEmail: z.string().nullable(),
  users: z.number(),
  numbers: z.number(),
  coexistenceNumbers: z.number(),
  numbersWithError: z.number(),
  contacts: z.number(),
  /** Contactos que enviaron o recibieron un mensaje este mes (sin difusiones). */
  activeContactsMonth: z.number(),
  messages30d: z.number(),
  failedMessages24h: z.number(),
  wonDeals30d: z.number(),
  lastMessageAt: z.string().nullable(),
  aiCostMonthUsd: z.number(),
  onboardingCompletedAt: z.string().nullable(),
  /** Hasta cuándo está pagado el plan (lo lleva el operador a mano). */
  planExpiresAt: z.string().nullable(),
  /** Notas internas del operador: quién es, qué pagó, qué pidió. */
  platformNotes: z.string().nullable(),
});
export type PlatformOrg = z.infer<typeof platformOrgSchema>;

export const updatePlatformOrgSchema = z.object({
  plan: planKeySchema.optional(),
  isActive: z.boolean().optional(),
  planExpiresAt: z.string().datetime().nullable().optional(),
  platformNotes: z.string().max(4000).nullable().optional(),
});
export type UpdatePlatformOrgInput = z.infer<typeof updatePlatformOrgSchema>;

/** Una línea del diario del operador. */
export const platformAuditEntrySchema = z.object({
  id: z.string(),
  actorEmail: z.string(),
  /** plan_changed | suspended | reactivated | expiry_changed | notes_changed | login_as */
  action: z.string(),
  orgId: z.string().nullable(),
  orgName: z.string().nullable(),
  orgSlug: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;

/** La ficha de una empresa. */
export const platformOrgDetailSchema = z.object({
  org: platformOrgSchema,
  users: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      name: z.string().nullable(),
      role: z.string(),
      isActive: z.boolean(),
      createdAt: z.string(),
      lastSeenAt: z.string().nullable(),
    }),
  ),
  numbers: z.array(
    z.object({
      id: z.string(),
      label: z.string().nullable(),
      displayPhoneNumber: z.string().nullable(),
      mode: z.string(),
      status: z.string(),
      statusReason: z.string().nullable(),
      isActive: z.boolean(),
      connectedAt: z.string(),
      capiEnabled: z.boolean(),
    }),
  ),
  /** Consumo de IA del mes por función y modelo. */
  ai: z.array(
    z.object({
      feature: z.string(),
      model: z.string(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      calls: z.number(),
      usd: z.number(),
    }),
  ),
  /** Mensajes por día, últimos 14 días. */
  activity: z.array(dayTraffic),
  counts: z.object({
    agents: z.number(),
    flows: z.number(),
    campaigns: z.number(),
    apiKeys: z.number(),
    webhooks: z.number(),
    deals: z.number(),
    openConversations: z.number(),
  }),
  won30d: z.array(z.object({ currency: z.string(), total: z.number(), count: z.number() })),
  audit: z.array(platformAuditEntrySchema),
});
export type PlatformOrgDetail = z.infer<typeof platformOrgDetailSchema>;

/** Salud de la plataforma: colas, números rotos, envíos fallidos, webhooks que fallan. */
export const platformHealthSchema = z.object({
  queues: z.array(
    z.object({
      name: z.string(),
      waiting: z.number(),
      active: z.number(),
      delayed: z.number(),
      failed: z.number(),
      /** false = no se pudo leer la cola (Redis caído). */
      ok: z.boolean(),
    }),
  ),
  numbersWithError: z.array(
    z.object({
      orgId: z.string(),
      orgName: z.string(),
      orgSlug: z.string(),
      id: z.string(),
      label: z.string().nullable(),
      number: z.string().nullable(),
      reason: z.string().nullable(),
      since: z.string(),
    }),
  ),
  outbound24h: z.object({ failed: z.number(), sent: z.number() }),
  failedByOrg: z.array(
    z.object({ orgId: z.string(), orgName: z.string(), orgSlug: z.string(), count: z.number(), lastError: z.string().nullable() }),
  ),
  webhooksFailing: z.array(
    z.object({
      orgId: z.string(),
      orgName: z.string(),
      url: z.string(),
      failedCount: z.number(),
      lastError: z.string().nullable(),
      lastStatus: z.number().nullable(),
      lastDeliveryAt: z.string().nullable(),
    }),
  ),
});
export type PlatformHealth = z.infer<typeof platformHealthSchema>;

export const platformLoginAsResultSchema = z.object({ url: z.string(), email: z.string() });
export type PlatformLoginAsResult = z.infer<typeof platformLoginAsResultSchema>;
