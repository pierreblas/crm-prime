import {
  bpToPercent,
  type AiBillingMode,
  type AssessmentStage,
  type ComplexityBand,
  type ComplexityFactor,
  type PricingAlert,
  type QuoteAction,
  type QuoteItemCategory,
  type QuoteStatus,
  type RiskFlag,
} from "@crm/shared";

// Textos del cotizador. La consola es solo en español, como el resto de la
// consola de plataforma: no pasa por i18n.

export type Tone = "draft" | "review" | "on" | "warn" | "off" | "muted";

export const STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Borrador",
  READY_FOR_REVIEW: "En revisión",
  APPROVED: "Aprobada",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
  SUPERSEDED: "Reemplazada",
  CANCELLED: "Cancelada",
};

export const STATUS_TONE: Record<QuoteStatus, Tone> = {
  DRAFT: "draft",
  READY_FOR_REVIEW: "review",
  APPROVED: "on",
  SENT: "review",
  ACCEPTED: "on",
  REJECTED: "off",
  EXPIRED: "warn",
  SUPERSEDED: "muted",
  CANCELLED: "muted",
};

export const STAGE_LABEL: Record<AssessmentStage, string> = {
  diagnosis: "Sin cotizar",
  quoting: "Cotizando",
  review: "En revisión",
  approved: "Aprobada",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
  cancelled: "Cancelada",
};

export const STAGE_TONE: Record<AssessmentStage, Tone> = {
  diagnosis: "muted",
  quoting: "draft",
  review: "review",
  approved: "on",
  sent: "review",
  accepted: "on",
  rejected: "off",
  expired: "warn",
  cancelled: "muted",
};

export const CATEGORY_LABEL: Record<QuoteItemCategory, string> = {
  DIAGNOSIS: "Diagnóstico",
  CONFIGURATION: "Configuración",
  AGENT: "Agente de IA",
  AUTOMATION: "Automatizaciones",
  INTEGRATION: "Integración",
  DATA: "Datos",
  QA: "Pruebas",
  TRAINING: "Capacitación",
  SUPPORT_SETUP: "Puesta en marcha",
  OTHER: "Otro",
};

export const AI_MODE_LABEL: Record<AiBillingMode, string> = {
  BYOK: "Clave propia del cliente (BYOK)",
  MANAGED: "IA gestionada por Driony",
  UNDECIDED: "Por definir",
};

/** Lo que se le dice al cliente sobre la IA según el modo. */
export const AI_MODE_NOTE: Record<AiBillingMode, string> = {
  BYOK: "El consumo de IA se paga directamente al proveedor (OpenAI o Anthropic) con la clave del cliente. No es un ingreso de Driony ni está incluido en este precio.",
  MANAGED: "La IA la gestiona Driony dentro del cupo de tokens de su plan. Nunca es ilimitada: al gastarse el cupo, los chats pasan al equipo humano o se añaden tokens extra.",
  UNDECIDED: "El modo de IA se define antes de empezar: con clave propia del cliente o gestionada por Driony dentro del cupo de su plan.",
};

export const RISK_LABEL: Record<RiskFlag, string> = {
  no_meta_access: "Sin acceso al Meta Business Manager",
  undocumented_api: "API o sistema sin documentar",
  messy_data: "Datos desordenados o incompletos",
  payment_verification: "Hay que verificar pagos",
  unlimited_ai_promise: "Espera IA ilimitada",
  third_party_costs_excluded: "Costos de terceros no incluidos",
  legacy_system: "Sistema legado",
  meta_approval_pending: "Aprobación de Meta pendiente",
};

export const BAND_LABEL: Record<ComplexityBand, string> = { low: "Baja", medium: "Media", high: "Alta" };
export const BAND_TONE: Record<ComplexityBand, Tone> = { low: "on", medium: "warn", high: "off" };

export const FACTOR_LABEL: Record<ComplexityFactor, string> = {
  numbers: "Números de WhatsApp",
  agents: "Agentes",
  automations: "Automatizaciones",
  integrations: "Integraciones",
  data: "Datos y conocimiento",
};

export const LEVEL_LABEL: Record<ComplexityFactor, Record<string, string>> = {
  numbers: { one: "1 número", few: "2–3 números", many: "4 o más" },
  agents: { copilot: "Solo Copilot", autopilot: "Copilot + Autopilot", multiple: "Varios agentes" },
  automations: { simple: "Hasta 2 sencillas", several: "3–5 flujos", complex: "Procesos complejos" },
  integrations: { none: "Ninguna", documented: "API o webhook documentado", custom: "Sistema a medida" },
  data: { organized: "Organizados", scattered: "Dispersos", migration: "Requieren migración" },
};

export const ACCESS_LABEL: Record<"full" | "partial" | "none" | "unknown", string> = {
  full: "Acceso completo",
  partial: "Acceso parcial",
  none: "Sin acceso",
  unknown: "Por confirmar",
};

export const ALERT_LABEL: Record<PricingAlert, string> = {
  no_items: "Sin partidas: añade al menos una.",
  no_hours: "Las partidas suman cero horas.",
  price_missing: "Falta el precio propuesto.",
  below_minimum: "Precio por debajo del mínimo recomendado: aprobarlo exige un motivo y queda en el diario.",
  negative_contribution: "El precio no cubre ni el costo presupuestado.",
  margin_below_target: "El margen esperado queda por debajo del objetivo.",
};

export const ACTION_LABEL: Record<QuoteAction, string> = {
  submit: "Enviar a revisión",
  reopen: "Volver a borrador",
  approve: "Aprobar",
  send: "Marcar como enviada",
  accept: "El cliente aceptó",
  reject: "El cliente rechazó",
  cancel: "Cancelar",
  revise: "Nueva versión",
};

/** Centavos → «USD 1,200.00», como el resto de la consola. */
export function fmtMoney(cents: number | null | undefined, currency: string): string {
  if (cents === null || cents === undefined) return "—";
  return `${currency} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Puntos básicos → «18,64 %». */
export function fmtPct(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return "—";
  return `${bpToPercent(bp).toLocaleString("es", { maximumFractionDigits: 2 })} %`;
}

export function fmtHours(h: number): string {
  return `${h.toLocaleString("es", { maximumFractionDigits: 2 })} h`;
}
