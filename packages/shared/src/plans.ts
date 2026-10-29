import { z } from "zod";

/**
 * Planes del SaaS.
 *
 * El plan de cada empresa es una cadena en `Organization.plan`; este catálogo
 * dice qué significa. Vive en código y no en la base a propósito: hay tres
 * planes, cambian poco, y así la API, la web y la consola hablan de los mismos
 * límites sin sincronizar nada.
 *
 * No hay cobro automático todavía: el plan lo cambia el operador desde la
 * consola de plataforma. Los precios son informativos y se cambian aquí.
 *
 * En una instalación propia (TENANCY_MODE=single) no hay planes: todo es
 * ilimitado, ver SELF_HOSTED_PLAN.
 */
export const PLAN_KEYS = ["free", "pro", "business"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const planKeySchema = z.enum(PLAN_KEYS);

export const PLAN_FEATURES = ["coexistence", "broadcasts", "api", "prioritySupport"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const FEATURE_LABELS: Record<PlanFeature, string> = {
  coexistence: "Coexistencia con el celular",
  broadcasts: "Difusiones con plantillas",
  api: "API pública y webhooks",
  prioritySupport: "Soporte prioritario",
};

export const planDefSchema = z.object({
  key: z.string(),
  name: z.string(),
  tagline: z.string(),
  /** USD al mes. null = sin precio (instalación propia). */
  priceUsd: z.number().nullable(),
  /**
   * null = sin límite. Números y usuarios se comprueban al añadir. Contactos y
   * oportunidades abiertas son límites blandos: lo que llega por WhatsApp
   * entra siempre; lo que se frena al tope es crear o importar a mano.
   */
  limits: z.object({
    numbers: z.number().nullable(),
    users: z.number().nullable(),
    contacts: z.number().nullable(),
    deals: z.number().nullable(),
    /**
     * Contactos activos al mes (quien envía o recibe un mensaje en el mes,
     * difusiones aparte). Es de uso razonable: no corta nada; si se supera
     * de forma sostenida, se propone un plan mayor.
     */
    activeContacts: z.number().nullable(),
  }),
  /**
   * Conversaciones al mes que el agente atiende con la IA de Driony, para
   * quien no conecta su propia clave. Con clave propia no hay cupo. null =
   * sin IA de Driony (instalación propia: la clave es del servidor).
   */
  aiConversations: z.number().nullable(),
  /** Días que se guardan los adjuntos de los mensajes. null = sin plazo (instalación propia). */
  mediaRetentionDays: z.number().nullable(),
  features: z.object({
    coexistence: z.boolean(),
    broadcasts: z.boolean(),
    api: z.boolean(),
    prioritySupport: z.boolean(),
  }),
});
export type PlanDef = z.infer<typeof planDefSchema>;
export type PlanLimit = keyof PlanDef["limits"];

/** "1 número de WhatsApp", "Hasta 500 contactos", "Oportunidades abiertas sin límite". */
export function formatPlanLimit(kind: PlanLimit, n: number | null): string {
  const words: Record<PlanLimit, [string, string]> = {
    numbers: ["número de WhatsApp", "números de WhatsApp"],
    users: ["persona en el equipo", "personas en el equipo"],
    contacts: ["contacto", "contactos"],
    deals: ["oportunidad abierta", "oportunidades abiertas"],
    activeContacts: ["contacto activo al mes", "contactos activos al mes"],
  };
  const [one, many] = words[kind];
  if (n === null) return `${many[0]!.toUpperCase()}${many.slice(1)} sin límite`;
  if (n === 1) return `1 ${one}`;
  return `Hasta ${n.toLocaleString("es")} ${many}`;
}

export const PLANS: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    name: "Gratis",
    tagline: "Para probar Driony con un número y el agente de IA.",
    priceUsd: 0,
    limits: { numbers: 1, users: 2, contacts: 500, deals: 200, activeContacts: 300 },
    aiConversations: 100,
    mediaRetentionDays: 90,
    features: { coexistence: false, broadcasts: false, api: false, prioritySupport: false },
  },
  pro: {
    key: "pro",
    name: "Pro",
    tagline: "Para equipos que venden por WhatsApp todos los días.",
    priceUsd: 49,
    limits: { numbers: 3, users: 10, contacts: 5000, deals: 2000, activeContacts: 3000 },
    aiConversations: 2000,
    mediaRetentionDays: 365,
    features: { coexistence: true, broadcasts: true, api: true, prioritySupport: false },
  },
  business: {
    key: "business",
    name: "Empresa",
    tagline: "Varios números, equipo grande y soporte prioritario.",
    priceUsd: 149,
    limits: { numbers: null, users: null, contacts: null, deals: null, activeContacts: 15000 },
    aiConversations: 10000,
    mediaRetentionDays: 1095,
    features: { coexistence: true, broadcasts: true, api: true, prioritySupport: true },
  },
};

/** Instalación propia: sin límites ni planes. */
export const SELF_HOSTED_PLAN: PlanDef = {
  key: "selfhosted",
  name: "Instalación propia",
  tagline: "Tu servidor, tus claves, sin límites.",
  priceUsd: null,
  limits: { numbers: null, users: null, contacts: null, deals: null, activeContacts: null },
  aiConversations: null,
  mediaRetentionDays: null,
  features: { coexistence: true, broadcasts: true, api: true, prioritySupport: false },
};

/** El plan que corresponde a una clave guardada; lo desconocido cae en Gratis. */
export function planFor(key: string | null | undefined): PlanDef {
  return (PLAN_KEYS as readonly string[]).includes(key ?? "") ? PLANS[key as PlanKey] : PLANS.free;
}

/** El plan más barato que incluye una característica, o null si ninguno. */
export function planWithFeature(feature: PlanFeature): PlanDef | null {
  return PLAN_KEYS.map((k) => PLANS[k]).find((p) => p.features[feature]) ?? null;
}

/** "USD 49/mes", "Sin costo" o "" (sin precio). */
export function formatPlanPrice(plan: PlanDef): string {
  if (plan.priceUsd === null) return "";
  if (plan.priceUsd === 0) return "Sin costo";
  return `USD ${plan.priceUsd}/mes`;
}

/** "Adjuntos guardados 90 días", "… 1 año", "… 3 años" o "… sin plazo". */
export function formatRetention(days: number | null): string {
  if (days === null) return "Adjuntos guardados sin plazo";
  if (days % 365 === 0) {
    const y = days / 365;
    return `Adjuntos guardados ${y} ${y === 1 ? "año" : "años"}`;
  }
  return `Adjuntos guardados ${days} días`;
}

/** "100 conversaciones con IA incluida al mes", o "" si el plan no la trae. */
export function formatAiIncluded(n: number | null): string {
  if (n === null) return "";
  return `${n.toLocaleString("es")} conversaciones con IA incluida al mes`;
}
