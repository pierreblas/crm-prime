/**
 * Cotizador interno de implementaciones (consola de plataforma): el motor de
 * números. Funciones puras, sin fecha ni base de datos, para que la API y la
 * pantalla calculen exactamente lo mismo y se puedan probar solas.
 *
 * Todo el dinero va en **centavos enteros** y los porcentajes en **puntos
 * básicos** (10 000 pb = 100 %). Así no hay 0,1 + 0,2 ≠ 0,3: con un flotante,
 * un margen del 40 % sobre 48 000 ¢ puede dar 79 999,99 y redondear mal.
 *
 * Margen bruto ≠ markup: el margen es sobre el precio (contribución / precio),
 * el markup sobre el costo. Para un 40 % de margen el precio es costo / 0,6,
 * no costo × 1,4.
 */

// ── Estados y catálogos ────────────────────────────────────────

export const QUOTE_STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
  "CANCELLED",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Estados en los que la cotización todavía puede cambiar de manos. */
export const QUOTE_OPEN_STATUSES: readonly QuoteStatus[] = ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "SENT"];

export const QUOTE_ITEM_CATEGORIES = [
  "DIAGNOSIS",
  "CONFIGURATION",
  "AGENT",
  "AUTOMATION",
  "INTEGRATION",
  "DATA",
  "QA",
  "TRAINING",
  "SUPPORT_SETUP",
  "OTHER",
] as const;
export type QuoteItemCategory = (typeof QUOTE_ITEM_CATEGORIES)[number];

export const AI_BILLING_MODES = ["BYOK", "MANAGED", "UNDECIDED"] as const;
export type AiBillingMode = (typeof AI_BILLING_MODES)[number];

/** Monedas en las que se cotiza. Una por cotización, sin conversión automática. */
export const QUOTE_CURRENCIES = ["USD", "PEN"] as const;
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number];

/**
 * Señales de riesgo del diagnóstico. Las marca quien diagnostica; algunas las
 * sugiere la pantalla a partir del alcance (p. ej. integración a medida →
 * `undocumented_api`), pero nunca se añaden solas.
 */
export const RISK_FLAGS = [
  "no_meta_access",
  "undocumented_api",
  "messy_data",
  "payment_verification",
  "unlimited_ai_promise",
  "third_party_costs_excluded",
  "legacy_system",
  "meta_approval_pending",
] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

// ── Complejidad orientativa ────────────────────────────────────

export const COMPLEXITY_LEVELS = {
  numbers: ["one", "few", "many"],
  agents: ["copilot", "autopilot", "multiple"],
  automations: ["simple", "several", "complex"],
  integrations: ["none", "documented", "custom"],
  data: ["organized", "scattered", "migration"],
} as const;
export type ComplexityFactor = keyof typeof COMPLEXITY_LEVELS;
export type ComplexityInput = { [K in ComplexityFactor]: (typeof COMPLEXITY_LEVELS)[K][number] };

/**
 * Puntos por factor y nivel (tabla del documento de trabajo). Son valores de
 * partida: se ajustarán con proyectos reales, y por eso viven en un solo sitio.
 */
export const COMPLEXITY_POINTS: { [K in ComplexityFactor]: Record<(typeof COMPLEXITY_LEVELS)[K][number], number> } = {
  numbers: { one: 0, few: 2, many: 4 },
  agents: { copilot: 0, autopilot: 2, multiple: 4 },
  automations: { simple: 0, several: 2, complex: 4 },
  integrations: { none: 0, documented: 3, custom: 6 },
  data: { organized: 0, scattered: 2, migration: 4 },
};

export type ComplexityBand = "low" | "medium" | "high";

export const DEFAULT_COMPLEXITY: ComplexityInput = {
  numbers: "one",
  agents: "copilot",
  automations: "simple",
  integrations: "none",
  data: "organized",
};

/** 0–3 baja, 4–9 media, 10+ alta. Orientativa: nunca se convierte sola en precio. */
export function complexityScore(input: ComplexityInput): { score: number; band: ComplexityBand; points: Record<ComplexityFactor, number> } {
  const points = {} as Record<ComplexityFactor, number>;
  let score = 0;
  for (const factor of Object.keys(COMPLEXITY_POINTS) as ComplexityFactor[]) {
    const table = COMPLEXITY_POINTS[factor] as Record<string, number>;
    const p = table[input[factor]] ?? 0;
    points[factor] = p;
    score += p;
  }
  return { score, band: score >= 10 ? "high" : score >= 4 ? "medium" : "low", points };
}

// ── Valores de partida (internos, configurables en P1) ─────────

/**
 * Hipótesis de trabajo del cotizador. NO son precios públicos y no se enseñan
 * al cliente: el catálogo público sigue siendo PLANS. En P1 pasan a una tabla
 * editable con rastro; mientras, están aquí para que cambiarlos sea un commit
 * y no una búsqueda.
 */
export const IMPLEMENTATION_DEFAULTS = {
  currency: "USD" as QuoteCurrency,
  /** Costo interno integral por hora (no el salario nominal). */
  hourlyCostCents: 2000,
  contingencyBp: 2000,
  targetMarginBp: 4000,
  /** El precio mínimo se redondea hacia arriba a este múltiplo (USD 10). */
  roundingCents: 1000,
  /** Diagnóstico de pago, acreditable una sola vez al implementar. */
  diagnosisFeeCents: 9900,
  validityDays: 15,
  paymentTerms: "50 % al iniciar y 50 % a la aceptación de la implementación.",
  /** Ofertas de referencia «desde»: orientan al comercial, no fijan el precio. */
  referenceOffers: [
    { key: "esencial", name: "Esencial (Copilot)", fromCents: 29000 },
    { key: "hibrida", name: "Híbrida (Copilot + Autopilot)", fromCents: 59000 },
    { key: "personalizada", name: "Personalizada (integraciones)", fromCents: 120000 },
  ],
} as const;

/** Partidas típicas para arrancar una estimación con un clic; luego se editan. */
export const SUGGESTED_QUOTE_ITEMS: ReadonlyArray<{ category: QuoteItemCategory; description: string; hours: number }> = [
  { category: "DIAGNOSIS", description: "Diagnóstico y levantamiento de procesos", hours: 2 },
  { category: "CONFIGURATION", description: "Configuración de la cuenta, números y equipo", hours: 4 },
  { category: "AGENT", description: "Agente de IA: prompt, conocimiento y pruebas", hours: 6 },
  { category: "AUTOMATION", description: "Automatizaciones de etapa y seguimientos", hours: 3 },
  { category: "INTEGRATION", description: "Integración con sistema externo", hours: 8 },
  { category: "DATA", description: "Carga y limpieza de contactos", hours: 3 },
  { category: "QA", description: "Pruebas de punta a punta", hours: 2 },
  { category: "TRAINING", description: "Capacitación del equipo", hours: 2 },
  { category: "SUPPORT_SETUP", description: "Acompañamiento de puesta en marcha", hours: 3 },
];

// ── Motor financiero ───────────────────────────────────────────

export interface PricingItemInput {
  /** Horas estimadas, con hasta dos decimales. */
  hours: number;
  /** Costo interno por hora, en centavos, congelado en la partida. */
  hourlyCostCents: number;
  /** Costos de terceros atribuibles a la partida (licencias, APIs…). */
  thirdPartyCents: number;
  /** Otros costos directos de la partida. */
  otherCents: number;
}

export interface PricingInput {
  items: PricingItemInput[];
  /** Otros costos directos de entrega no atados a una partida. No duplicar los de las partidas. */
  overheadsCents: number;
  contingencyBp: number;
  targetMarginBp: number;
  /** Múltiplo al que se redondea el mínimo hacia arriba (≥ 1). */
  roundingCents: number;
  /** Precio comercial a evaluar; null = aún sin fijar. */
  proposedPriceCents: number | null;
}

export type PricingAlert =
  | "no_items"
  | "no_hours"
  | "price_missing"
  | "below_minimum"
  | "negative_contribution"
  | "margin_below_target";

export interface PricingResult {
  laborCents: number;
  thirdPartyCents: number;
  otherDirectCents: number;
  /** Terceros + otros de partidas + gastos de entrega. */
  externalCents: number;
  baseCostCents: number;
  contingencyCents: number;
  budgetedCostCents: number;
  /** Precio mínimo recomendado, ya redondeado hacia arriba. */
  minimumPriceCents: number;
  /** Mínimo sin redondear, para explicar el redondeo. */
  minimumRawCents: number;
  proposedPriceCents: number | null;
  expectedContributionCents: number | null;
  /** Margen esperado en pb; null sin precio. */
  expectedMarginBp: number | null;
  totalHours: number;
  belowMinimum: boolean;
  alerts: PricingAlert[];
}

export class PricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingInputError";
  }
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** Redondea hacia arriba al múltiplo (nunca hacia abajo: el mínimo no se rebaja solo). */
export function ceilTo(cents: number, multiple: number): number {
  if (multiple <= 1) return cents;
  return Math.ceil(cents / multiple) * multiple;
}

/**
 * laborCost = Σ horas × costo/hora
 * baseCost = laborCost + costos externos directos + gastos de entrega
 * contingency = baseCost × tasa
 * budgeted = baseCost + contingency
 * minimum = budgeted / (1 − margen objetivo), redondeado hacia arriba
 * margin(precio) = (precio − budgeted) / precio
 *
 * Ejemplo del documento: 20 h × 2 000 ¢ = 40 000; +20 % = 48 000; /0,6 ⇒ 80 000 ¢ = USD 800.
 */
export function computePricing(input: PricingInput): PricingResult {
  if (!isInt(input.targetMarginBp) || input.targetMarginBp < 0 || input.targetMarginBp >= 10000) {
    throw new PricingInputError("El margen objetivo debe estar entre 0 % y 99,99 %");
  }
  if (!isInt(input.contingencyBp) || input.contingencyBp < 0) throw new PricingInputError("La contingencia no puede ser negativa");
  if (!isInt(input.overheadsCents) || input.overheadsCents < 0) throw new PricingInputError("Los gastos de entrega no pueden ser negativos");
  if (!isInt(input.roundingCents) || input.roundingCents < 1) throw new PricingInputError("El redondeo debe ser un entero positivo");
  if (input.proposedPriceCents !== null && (!isInt(input.proposedPriceCents) || input.proposedPriceCents < 0)) {
    throw new PricingInputError("El precio propuesto debe ser un entero no negativo");
  }

  let laborCents = 0;
  let thirdPartyCents = 0;
  let otherDirectCents = 0;
  let totalHours = 0;
  for (const it of input.items) {
    if (!Number.isFinite(it.hours) || it.hours < 0) throw new PricingInputError("Las horas no pueden ser negativas");
    if (!isInt(it.hourlyCostCents) || it.hourlyCostCents < 0) throw new PricingInputError("El costo por hora no puede ser negativo");
    if (!isInt(it.thirdPartyCents) || it.thirdPartyCents < 0) throw new PricingInputError("El costo de terceros no puede ser negativo");
    if (!isInt(it.otherCents) || it.otherCents < 0) throw new PricingInputError("Los otros costos no pueden ser negativos");
    // Horas con dos decimales × centavos enteros: se redondea el producto, no las horas.
    laborCents += Math.round(it.hours * it.hourlyCostCents);
    thirdPartyCents += it.thirdPartyCents;
    otherDirectCents += it.otherCents;
    totalHours += it.hours;
  }
  totalHours = Math.round(totalHours * 100) / 100;

  const externalCents = thirdPartyCents + otherDirectCents + input.overheadsCents;
  const baseCostCents = laborCents + externalCents;
  const contingencyCents = Math.round((baseCostCents * input.contingencyBp) / 10000);
  const budgetedCostCents = baseCostCents + contingencyCents;
  // budgeted / (1 − m) en enteros: budgeted × 10 000 / (10 000 − m), hacia arriba.
  const minimumRawCents = Math.ceil((budgetedCostCents * 10000) / (10000 - input.targetMarginBp));
  const minimumPriceCents = ceilTo(minimumRawCents, input.roundingCents);

  const proposed = input.proposedPriceCents;
  const expectedContributionCents = proposed === null ? null : proposed - budgetedCostCents;
  const expectedMarginBp =
    proposed === null || proposed === 0 || expectedContributionCents === null ? null : Math.round((expectedContributionCents * 10000) / proposed);

  const alerts: PricingAlert[] = [];
  if (input.items.length === 0) alerts.push("no_items");
  else if (totalHours === 0) alerts.push("no_hours");
  if (proposed === null || proposed === 0) alerts.push("price_missing");
  const belowMinimum = proposed !== null && proposed > 0 && proposed < minimumPriceCents;
  if (belowMinimum) alerts.push("below_minimum");
  if (expectedContributionCents !== null && proposed !== null && proposed > 0 && expectedContributionCents < 0) alerts.push("negative_contribution");
  if (expectedMarginBp !== null && expectedMarginBp < input.targetMarginBp && !belowMinimum) alerts.push("margin_below_target");

  return {
    laborCents,
    thirdPartyCents,
    otherDirectCents,
    externalCents,
    baseCostCents,
    contingencyCents,
    budgetedCostCents,
    minimumPriceCents,
    minimumRawCents,
    proposedPriceCents: proposed,
    expectedContributionCents,
    expectedMarginBp,
    totalHours,
    belowMinimum,
    alerts,
  };
}

/** Centavos → "1.234,50" en el idioma dado, sin símbolo (el símbolo lo pone quien pinta). */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** "1234.5" o "1.234,50" → centavos enteros; null si no es un número. */
export function amountToCents(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === "number") return Number.isFinite(text) ? Math.round(text * 100) : null;
  const t = text.trim();
  if (t === "") return null;
  // Acepta coma o punto decimal; quita separadores de miles.
  const normalized = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Puntos básicos → porcentaje con hasta dos decimales (4 000 → 40). */
export function bpToPercent(bp: number): number {
  return Math.round(bp) / 100;
}

/** Porcentaje → puntos básicos (40 → 4 000; 18,64 → 1 864). */
export function percentToBp(percent: number): number {
  return Math.round(percent * 100);
}

// ── Máquina de estados ─────────────────────────────────────────

export type QuoteAction = "submit" | "reopen" | "approve" | "send" | "accept" | "reject" | "cancel" | "revise";

/**
 * Desde qué estado vale cada acción. `revise` no cambia la cotización: crea
 * la versión siguiente y marca esta como SUPERSEDED (salvo ACCEPTED, que es
 * el contrato firmado y se queda; la nueva versión es un cambio de alcance).
 */
export const QUOTE_TRANSITIONS: Record<QuoteAction, { from: readonly QuoteStatus[]; to: QuoteStatus | null }> = {
  submit: { from: ["DRAFT"], to: "READY_FOR_REVIEW" },
  reopen: { from: ["READY_FOR_REVIEW"], to: "DRAFT" },
  approve: { from: ["READY_FOR_REVIEW"], to: "APPROVED" },
  send: { from: ["APPROVED"], to: "SENT" },
  accept: { from: ["SENT"], to: "ACCEPTED" },
  reject: { from: ["SENT"], to: "REJECTED" },
  cancel: { from: ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "SENT"], to: "CANCELLED" },
  revise: { from: ["APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"], to: null },
};

export function canTransition(status: QuoteStatus, action: QuoteAction): boolean {
  return QUOTE_TRANSITIONS[action].from.includes(status);
}

/** Estado efectivo: una aprobada o enviada con la vigencia pasada se lee como EXPIRED (sin tarea programada). */
export function effectiveQuoteStatus(status: QuoteStatus, validUntil: Date | string | null, now: Date = new Date()): QuoteStatus {
  if ((status === "APPROVED" || status === "SENT") && validUntil) {
    const until = typeof validUntil === "string" ? new Date(validUntil) : validUntil;
    if (until.getTime() < now.getTime()) return "EXPIRED";
  }
  return status;
}
