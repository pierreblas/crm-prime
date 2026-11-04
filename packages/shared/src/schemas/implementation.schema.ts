import { z } from "zod";
import { planKeySchema } from "../plans.js";
import {
  AI_BILLING_MODES,
  COMPLEXITY_LEVELS,
  QUOTE_CURRENCIES,
  QUOTE_ITEM_CATEGORIES,
  QUOTE_STATUSES,
  RISK_FLAGS,
} from "../implementation-pricing.js";

// ── Cotizador interno de implementaciones (consola de plataforma) ──
//
// Lo que entra por la API y lo que sale hacia la pantalla. El motor de cálculo
// está en implementation-pricing.ts; aquí solo se describen las formas.

export const quoteStatusSchema = z.enum(QUOTE_STATUSES);
export const quoteItemCategorySchema = z.enum(QUOTE_ITEM_CATEGORIES);
export const aiBillingModeSchema = z.enum(AI_BILLING_MODES);
export const quoteCurrencySchema = z.enum(QUOTE_CURRENCIES);
export const riskFlagSchema = z.enum(RISK_FLAGS);
export const quoteActionSchema = z.enum(["submit", "reopen", "approve", "send", "accept", "reject", "cancel", "revise"]);

const cents = (max = 100_000_000_00) => z.number().int().min(0).max(max);
const text = (max: number) => z.string().trim().max(max);

// ── Diagnóstico ────────────────────────────────────────────────

export const complexityInputSchema = z.object({
  numbers: z.enum(COMPLEXITY_LEVELS.numbers),
  agents: z.enum(COMPLEXITY_LEVELS.agents),
  automations: z.enum(COMPLEXITY_LEVELS.automations),
  integrations: z.enum(COMPLEXITY_LEVELS.integrations),
  data: z.enum(COMPLEXITY_LEVELS.data),
});
export type ComplexityInputDto = z.infer<typeof complexityInputSchema>;

/** Lo que el comercial recoge del negocio. Se guarda como JSON validado. */
export const assessmentScopeSchema = z.object({
  /** Qué vende, a quién, y qué problema quiere resolver. */
  businessSummary: text(4000).default(""),
  currentProcess: text(4000).default(""),
  monthlyLeads: z.number().int().min(0).max(10_000_000).nullable().default(null),
  agentsCount: z.number().int().min(0).max(10_000).nullable().default(null),
  schedule: text(300).default(""),
  country: text(80).default(""),
  /** Sistemas actuales y qué acceso tiene el cliente a cada uno. */
  systems: z
    .array(z.object({ name: text(120).min(1), access: z.enum(["full", "partial", "none", "unknown"]) }))
    .max(30)
    .default([]),
  aiShould: text(4000).default(""),
  /** Lo que la IA nunca hace sin una persona. */
  aiNever: text(4000).default(""),
  escalation: text(4000).default(""),
  paymentVerification: z.boolean().default(false),
  complexity: complexityInputSchema,
  notes: text(8000).default(""),
});
export type AssessmentScope = z.infer<typeof assessmentScopeSchema>;

export const createAssessmentSchema = z.object({
  title: text(160).min(1, "Ponle un título"),
  clientName: text(160).min(1, "Falta el nombre del cliente"),
  clientContact: text(300).default(""),
  /** Empresa de Driony si ya tiene cuenta; null para un prospecto. */
  orgId: z.string().max(64).nullable().default(null),
  sector: text(120).default(""),
  objective: text(2000).default(""),
  scope: assessmentScopeSchema,
  riskFlags: z.array(riskFlagSchema).max(RISK_FLAGS.length).default([]),
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

export const updateAssessmentSchema = createAssessmentSchema.partial();
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;

// ── Cotización ─────────────────────────────────────────────────

export const quoteItemInputSchema = z.object({
  category: quoteItemCategorySchema,
  description: text(300).min(1, "Describe la partida"),
  hours: z.number().min(0).max(10_000),
  hourlyCostCents: cents(10_000_00),
  thirdPartyCents: cents(),
  otherCents: cents(),
});
export type QuoteItemInput = z.infer<typeof quoteItemInputSchema>;

/** Solo en borrador. Las partidas, si vienen, reemplazan a todas las anteriores. */
export const updateQuoteSchema = z.object({
  currency: quoteCurrencySchema.optional(),
  planKey: planKeySchema.nullable().optional(),
  aiBillingMode: aiBillingModeSchema.optional(),
  overheadsCents: cents().optional(),
  contingencyBp: z.number().int().min(0).max(10_000).optional(),
  targetMarginBp: z.number().int().min(0).max(9_900).optional(),
  roundingCents: z.number().int().min(1).max(1_000_000).optional(),
  proposedPriceCents: cents().nullable().optional(),
  diagnosisFeeCents: cents().nullable().optional(),
  diagnosisCredited: z.boolean().optional(),
  deliverables: text(6000).optional(),
  assumptions: text(6000).optional(),
  exclusions: text(6000).optional(),
  clientRequirements: text(4000).optional(),
  timelineNote: text(1000).optional(),
  paymentTerms: text(2000).optional(),
  externalCostsNote: text(2000).optional(),
  taxNote: text(500).optional(),
  supportNote: text(2000).optional(),
  /** Fin de la vigencia (ISO). null = sin fecha. */
  validUntil: z.string().datetime().nullable().optional(),
  items: z.array(quoteItemInputSchema).max(60).optional(),
});
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

/** Motivo (obligatorio al aprobar bajo mínimo y al rechazar) o nota (al enviar/aceptar). */
export const quoteActionBodySchema = z.object({
  reason: text(2000).optional(),
  note: text(2000).optional(),
});
export type QuoteActionBody = z.infer<typeof quoteActionBodySchema>;

// ── Lo que sale ────────────────────────────────────────────────

export const pricingAlertSchema = z.enum(["no_items", "no_hours", "price_missing", "below_minimum", "negative_contribution", "margin_below_target"]);

export const pricingResultSchema = z.object({
  laborCents: z.number(),
  thirdPartyCents: z.number(),
  otherDirectCents: z.number(),
  externalCents: z.number(),
  baseCostCents: z.number(),
  contingencyCents: z.number(),
  budgetedCostCents: z.number(),
  minimumPriceCents: z.number(),
  minimumRawCents: z.number(),
  proposedPriceCents: z.number().nullable(),
  expectedContributionCents: z.number().nullable(),
  expectedMarginBp: z.number().nullable(),
  totalHours: z.number(),
  belowMinimum: z.boolean(),
  alerts: z.array(pricingAlertSchema),
});
export type PricingResultDto = z.infer<typeof pricingResultSchema>;

export const quoteItemSchema = quoteItemInputSchema.extend({ id: z.string(), sortOrder: z.number() });
export type QuoteItemDto = z.infer<typeof quoteItemSchema>;

/**
 * Lo que puede ver el cliente. Es un objeto aparte a propósito: la vista
 * imprimible (P1) recibe solo esto, y una prueba comprueba que no lleve
 * horas, costos por hora, márgenes ni mínimos.
 */
export const quotePublicViewSchema = z.object({
  number: z.string(),
  version: z.number(),
  status: quoteStatusSchema,
  currency: quoteCurrencySchema,
  clientName: z.string(),
  title: z.string(),
  objective: z.string(),
  deliverables: z.string(),
  /** Partidas sin horas ni costos: solo qué se entrega. */
  lines: z.array(z.object({ category: quoteItemCategorySchema, description: z.string() })),
  assumptions: z.string(),
  exclusions: z.string(),
  clientRequirements: z.string(),
  timelineNote: z.string(),
  /** Pago único de la implementación. */
  implementationPriceCents: z.number().nullable(),
  /** Descuento explícito por el diagnóstico ya pagado (una sola vez). */
  diagnosisCreditCents: z.number().nullable(),
  totalDueCents: z.number().nullable(),
  /** Mensualidad del SaaS, aparte y con el precio del momento. */
  plan: z.object({ key: z.string(), name: z.string(), monthlyCents: z.number() }).nullable(),
  aiBillingMode: aiBillingModeSchema,
  externalCostsNote: z.string(),
  taxNote: z.string(),
  supportNote: z.string(),
  paymentTerms: z.string(),
  validUntil: z.string().nullable(),
});
export type QuotePublicView = z.infer<typeof quotePublicViewSchema>;

// ── Horas y costos reales (sobre una versión aceptada) ─────────

export const implementationActualInputSchema = z.object({
  category: quoteItemCategorySchema,
  description: text(300).min(1, "Describe el trabajo"),
  hours: z.number().min(0).max(10_000),
  /** Costo interno por hora al que se valora; se congela en la fila. */
  hourlyCostCents: cents(10_000_00),
  /** Costos externos pagados de verdad (licencias, APIs, terceros). */
  costCents: cents(),
  /** Día del trabajo, YYYY-MM-DD. */
  workedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha en formato AAAA-MM-DD"),
  note: text(1000).default(""),
});
export type ImplementationActualInput = z.infer<typeof implementationActualInputSchema>;

export const implementationActualSchema = implementationActualInputSchema.extend({
  id: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type ImplementationActual = z.infer<typeof implementationActualSchema>;

/** Presupuesto frente a real, para aprender de cada proyecto. */
export const actualsSummarySchema = z.object({
  hours: z.number(),
  laborCents: z.number(),
  externalCents: z.number(),
  totalCents: z.number(),
  budgetedHours: z.number(),
  budgetedCents: z.number(),
  /** (precio − costo real) / precio; null sin precio o sin registros. */
  realMarginBp: z.number().nullable(),
});
export type ActualsSummary = z.infer<typeof actualsSummarySchema>;

export const quoteSummarySchema = z.object({
  id: z.string(),
  version: z.number(),
  status: quoteStatusSchema,
  currency: quoteCurrencySchema,
  proposedPriceCents: z.number().nullable(),
  minimumPriceCents: z.number(),
  belowMinimum: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  validUntil: z.string().nullable(),
});
export type QuoteSummary = z.infer<typeof quoteSummarySchema>;

export const implementationQuoteSchema = quoteSummarySchema.extend({
  assessmentId: z.string(),
  number: z.string(),
  /** El guardado en la base; `status` es el efectivo (EXPIRED se deriva de la vigencia). */
  storedStatus: quoteStatusSchema,
  planKey: z.string().nullable(),
  planPriceCentsSnapshot: z.number().nullable(),
  aiBillingMode: aiBillingModeSchema,
  overheadsCents: z.number(),
  contingencyBp: z.number(),
  targetMarginBp: z.number(),
  roundingCents: z.number(),
  diagnosisFeeCents: z.number().nullable(),
  diagnosisCredited: z.boolean(),
  deliverables: z.string(),
  assumptions: z.string(),
  exclusions: z.string(),
  clientRequirements: z.string(),
  timelineNote: z.string(),
  paymentTerms: z.string(),
  externalCostsNote: z.string(),
  taxNote: z.string(),
  supportNote: z.string(),
  exceptionReason: z.string().nullable(),
  exceptionBy: z.string().nullable(),
  approvedBy: z.string().nullable(),
  sentNote: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  rejectedReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  supersededById: z.string().nullable(),
  hasApprovedSnapshot: z.boolean(),
  createdBy: z.string(),
  items: z.array(quoteItemSchema),
  pricing: pricingResultSchema,
  /** Solo se registran sobre una versión aceptada; vacío en el resto. */
  actuals: z.array(implementationActualSchema),
  actualsSummary: actualsSummarySchema,
  /** Solo en borrador se edita; después, nueva versión. */
  editable: z.boolean(),
  /** Acciones que valen ahora mismo (según el estado efectivo). */
  actions: z.array(quoteActionSchema),
  publicView: quotePublicViewSchema,
});
export type ImplementationQuote = z.infer<typeof implementationQuoteSchema>;

// ── Ajustes del cotizador (tarifas, plantillas, referencias) ───

export const pricingRateSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: text(80).min(1),
  hourlyCostCents: cents(10_000_00),
});
export type PricingRate = z.infer<typeof pricingRateSchema>;

export const pricingTemplateItemSchema = z.object({
  category: quoteItemCategorySchema,
  description: text(300).min(1),
  hours: z.number().min(0).max(10_000),
  /** Tarifa con la que se valora; si no existe se usa la tarifa por defecto. */
  rateKey: z.string().max(40).nullable().default(null),
});

export const pricingTemplateSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: text(80).min(1),
  description: text(300).default(""),
  items: z.array(pricingTemplateItemSchema).max(40),
});
export type PricingTemplate = z.infer<typeof pricingTemplateSchema>;

export const referenceOfferSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: text(80).min(1),
  fromCents: cents(),
});

/**
 * Lo que el cotizador toma por defecto. Lo edita la cuenta maestra desde la
 * consola y cada cambio queda en el diario. Nada de aquí es público.
 */
export const pricingSettingsSchema = z.object({
  currency: quoteCurrencySchema,
  /** Tarifa por defecto para partidas nuevas. */
  hourlyCostCents: cents(10_000_00),
  contingencyBp: z.number().int().min(0).max(10_000),
  targetMarginBp: z.number().int().min(0).max(9_900),
  roundingCents: z.number().int().min(1).max(1_000_000),
  validityDays: z.number().int().min(1).max(365),
  diagnosisFeeCents: cents().nullable(),
  paymentTerms: text(2000),
  rates: z.array(pricingRateSchema).max(20),
  templates: z.array(pricingTemplateSchema).max(10),
  referenceOffers: z.array(referenceOfferSchema).max(10),
});
export type PricingSettings = z.infer<typeof pricingSettingsSchema>;

export const pricingSettingsDtoSchema = z.object({
  settings: pricingSettingsSchema,
  /** null = nunca se guardaron: valen los de código. */
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type PricingSettingsDto = z.infer<typeof pricingSettingsDtoSchema>;

/** Valores de partida (hipótesis internas; ver IMPLEMENTATION_DEFAULTS). */
export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  currency: "USD",
  hourlyCostCents: 2000,
  contingencyBp: 2000,
  targetMarginBp: 4000,
  roundingCents: 1000,
  validityDays: 15,
  diagnosisFeeCents: 9900,
  paymentTerms: "50 % al iniciar y 50 % a la aceptación de la implementación.",
  rates: [
    { key: "implementador", name: "Implementador", hourlyCostCents: 2000 },
    { key: "senior", name: "Consultor senior", hourlyCostCents: 3500 },
  ],
  templates: [
    {
      key: "esencial",
      name: "Esencial (Copilot)",
      description: "Un número, agente copiloto, embudo básico y capacitación.",
      items: [
        { category: "DIAGNOSIS", description: "Diagnóstico y levantamiento de procesos", hours: 2, rateKey: "senior" },
        { category: "CONFIGURATION", description: "Configuración de la cuenta, número y equipo", hours: 3, rateKey: null },
        { category: "AGENT", description: "Copilot: prompt, respuestas rápidas y base de conocimiento", hours: 4, rateKey: null },
        { category: "TRAINING", description: "Capacitación del equipo", hours: 2, rateKey: null },
        { category: "QA", description: "Pruebas de punta a punta", hours: 1, rateKey: null },
      ],
    },
    {
      key: "hibrida",
      name: "Híbrida (Copilot + Autopilot)",
      description: "Agente que responde solo con escalamiento humano, automatizaciones de etapa y seguimientos.",
      items: [
        { category: "DIAGNOSIS", description: "Diagnóstico y diseño de la atención", hours: 3, rateKey: "senior" },
        { category: "CONFIGURATION", description: "Configuración de cuenta, números y equipo", hours: 4, rateKey: null },
        { category: "AGENT", description: "Autopilot: prompt, conocimiento, límites y escalamiento", hours: 8, rateKey: null },
        { category: "AUTOMATION", description: "Automatizaciones de etapa y seguimientos", hours: 4, rateKey: null },
        { category: "DATA", description: "Carga y limpieza de contactos", hours: 2, rateKey: null },
        { category: "QA", description: "Pruebas de punta a punta", hours: 2, rateKey: null },
        { category: "TRAINING", description: "Capacitación del equipo", hours: 2, rateKey: null },
        { category: "SUPPORT_SETUP", description: "Acompañamiento de puesta en marcha", hours: 3, rateKey: null },
      ],
    },
    {
      key: "personalizada",
      name: "Personalizada (integraciones)",
      description: "Todo lo de la híbrida más integración con sistemas del cliente.",
      items: [
        { category: "DIAGNOSIS", description: "Diagnóstico técnico y de procesos", hours: 4, rateKey: "senior" },
        { category: "CONFIGURATION", description: "Configuración de cuenta, números y equipo", hours: 4, rateKey: null },
        { category: "AGENT", description: "Autopilot con límites y escalamiento", hours: 8, rateKey: null },
        { category: "AUTOMATION", description: "Automatizaciones y seguimientos", hours: 5, rateKey: null },
        { category: "INTEGRATION", description: "Integración con sistema externo (API documentada)", hours: 10, rateKey: "senior" },
        { category: "DATA", description: "Migración y limpieza de datos", hours: 4, rateKey: null },
        { category: "QA", description: "Pruebas de punta a punta", hours: 3, rateKey: null },
        { category: "TRAINING", description: "Capacitación del equipo", hours: 2, rateKey: null },
        { category: "SUPPORT_SETUP", description: "Acompañamiento de puesta en marcha", hours: 4, rateKey: null },
      ],
    },
  ],
  referenceOffers: [
    { key: "esencial", name: "Esencial (Copilot)", fromCents: 29000 },
    { key: "hibrida", name: "Híbrida (Copilot + Autopilot)", fromCents: 59000 },
    { key: "personalizada", name: "Personalizada (integraciones)", fromCents: 120000 },
  ],
};

export const archiveAssessmentSchema = z.object({ archived: z.boolean() });

export const assessmentStageSchema = z.enum(["diagnosis", "quoting", "review", "approved", "sent", "accepted", "rejected", "expired", "cancelled"]);
export type AssessmentStage = z.infer<typeof assessmentStageSchema>;

export const implementationAssessmentRowSchema = z.object({
  id: z.string(),
  quoteNumber: z.string().nullable(),
  title: z.string(),
  clientName: z.string(),
  clientContact: z.string(),
  orgId: z.string().nullable(),
  orgName: z.string().nullable(),
  orgSlug: z.string().nullable(),
  sector: z.string(),
  objective: z.string(),
  ownerEmail: z.string(),
  riskFlags: z.array(riskFlagSchema),
  complexityScore: z.number(),
  complexityBand: z.enum(["low", "medium", "high"]),
  stage: assessmentStageSchema,
  latestQuote: quoteSummarySchema.nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImplementationAssessmentRow = z.infer<typeof implementationAssessmentRowSchema>;

export const implementationAssessmentSchema = implementationAssessmentRowSchema.extend({
  scope: assessmentScopeSchema,
  /** Todas las versiones, la más nueva primero. */
  quotes: z.array(quoteSummarySchema),
});
export type ImplementationAssessment = z.infer<typeof implementationAssessmentSchema>;
