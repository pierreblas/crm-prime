/**
 * Motor del cotizador de implementaciones: funciones puras de @crm/shared.
 *
 *   npm run test:implpricing --workspace=apps/api
 *
 * El ejemplo de referencia del documento de trabajo: 20 h × USD 20 = 400;
 * contingencia 20 % = 80; presupuesto 480; margen objetivo 40 % ⇒ mínimo 800.
 * Vender a 590 debe avisar y exigir aprobación excepcional.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  amountToCents,
  bpToPercent,
  canTransition,
  ceilTo,
  complexityScore,
  computePricing,
  DEFAULT_COMPLEXITY,
  effectiveQuoteStatus,
  percentToBp,
  PricingInputError,
} from "@crm/shared";

const base = { overheadsCents: 0, contingencyBp: 2000, targetMarginBp: 4000, roundingCents: 1000 };
const item = (hours: number, hourlyCostCents = 2000, extra: Partial<{ thirdPartyCents: number; otherCents: number }> = {}) => ({
  hours,
  hourlyCostCents,
  thirdPartyCents: 0,
  otherCents: 0,
  ...extra,
});

test("ejemplo del documento: 20 h × USD 20 con 20 % y 40 % ⇒ mínimo USD 800", () => {
  const r = computePricing({ ...base, items: [item(20)], proposedPriceCents: null });
  assert.equal(r.laborCents, 40000);
  assert.equal(r.baseCostCents, 40000);
  assert.equal(r.contingencyCents, 8000);
  assert.equal(r.budgetedCostCents, 48000);
  assert.equal(r.minimumRawCents, 80000);
  assert.equal(r.minimumPriceCents, 80000);
  assert.equal(r.totalHours, 20);
  assert.equal(r.expectedMarginBp, null, "sin precio no hay margen");
  assert.deepEqual(r.alerts, ["price_missing"]);
});

test("vender a USD 590 avisa: por debajo del mínimo y margen del 18,64 %", () => {
  const r = computePricing({ ...base, items: [item(20)], proposedPriceCents: 59000 });
  assert.equal(r.belowMinimum, true);
  assert.equal(r.expectedContributionCents, 11000);
  assert.equal(r.expectedMarginBp, 1864);
  assert.ok(r.alerts.includes("below_minimum"));
  assert.ok(!r.alerts.includes("margin_below_target"), "bajo mínimo ya lo dice todo; no se duplica la alerta");
});

test("a USD 800 exactos no hay alerta; a USD 1 000 el margen sube al 52 %", () => {
  const ok = computePricing({ ...base, items: [item(20)], proposedPriceCents: 80000 });
  assert.equal(ok.belowMinimum, false);
  assert.equal(ok.expectedMarginBp, 4000);
  assert.deepEqual(ok.alerts, []);
  const better = computePricing({ ...base, items: [item(20)], proposedPriceCents: 100000 });
  assert.equal(better.expectedMarginBp, 5200);
});

test("margen bruto ≠ markup: costo × 1,4 NO da el 40 %", () => {
  const markup = Math.round(48000 * 1.4); // 67 200
  const r = computePricing({ ...base, items: [item(20)], proposedPriceCents: markup });
  assert.ok(r.belowMinimum, "67 200 < 80 000");
  assert.equal(r.expectedMarginBp, 2857, "el markup del 40 % deja un margen del 28,57 %");
});

test("el redondeo siempre sube, nunca baja del mínimo", () => {
  // 48 000 / 0,65 = 73 846,15 → 73 847 → múltiplo de 1 000 hacia arriba = 74 000
  const r = computePricing({ ...base, targetMarginBp: 3500, items: [item(20)], proposedPriceCents: null });
  assert.equal(r.minimumRawCents, 73847);
  assert.equal(r.minimumPriceCents, 74000);
  assert.equal(ceilTo(73847, 1), 73847, "redondeo 1 = sin redondeo");
  assert.equal(ceilTo(80000, 1000), 80000, "un múltiplo exacto no sube");
  // Y el precio que iguala el mínimo redondeado no está por debajo.
  assert.equal(computePricing({ ...base, targetMarginBp: 3500, items: [item(20)], proposedPriceCents: 74000 }).belowMinimum, false);
});

test("costos de terceros, otros directos y gastos de entrega entran en el costo base una sola vez", () => {
  const r = computePricing({
    ...base,
    overheadsCents: 5000,
    items: [item(10, 2000, { thirdPartyCents: 12000 }), item(0, 2000, { otherCents: 3000 })],
    proposedPriceCents: null,
  });
  assert.equal(r.laborCents, 20000);
  assert.equal(r.thirdPartyCents, 12000);
  assert.equal(r.otherDirectCents, 3000);
  assert.equal(r.externalCents, 20000);
  assert.equal(r.baseCostCents, 40000);
  assert.equal(r.contingencyCents, 8000);
  assert.equal(r.minimumPriceCents, 80000);
});

test("horas con decimales: se redondea el producto, no las horas", () => {
  const r = computePricing({ ...base, contingencyBp: 0, targetMarginBp: 0, roundingCents: 1, items: [item(1.1, 2000), item(0.33, 3333)], proposedPriceCents: null });
  assert.equal(r.laborCents, 2200 + 1100); // 1,1 × 2 000 = 2 200; 0,33 × 3 333 = 1 099,89 → 1 100
  assert.equal(r.totalHours, 1.43);
});

test("sin partidas o sin horas se avisa; con margen 0 % el mínimo es el presupuesto", () => {
  const empty = computePricing({ ...base, items: [], proposedPriceCents: 10000 });
  assert.equal(empty.minimumPriceCents, 0);
  assert.ok(empty.alerts.includes("no_items"));
  const zero = computePricing({ ...base, items: [item(0)], proposedPriceCents: null });
  assert.ok(zero.alerts.includes("no_hours"));
  const flat = computePricing({ ...base, targetMarginBp: 0, roundingCents: 1, items: [item(20)], proposedPriceCents: 48000 });
  assert.equal(flat.minimumPriceCents, 48000);
  assert.equal(flat.expectedMarginBp, 0);
  assert.equal(flat.belowMinimum, false);
});

test("precio por debajo del costo: contribución negativa", () => {
  const r = computePricing({ ...base, items: [item(20)], proposedPriceCents: 30000 });
  assert.ok(r.alerts.includes("negative_contribution"));
  assert.equal(r.expectedContributionCents, -18000);
  assert.equal(r.expectedMarginBp, -6000);
});

test("protecciones: margen fuera de rango, negativos y decimales en centavos se rechazan", () => {
  assert.throws(() => computePricing({ ...base, targetMarginBp: 10000, items: [item(1)], proposedPriceCents: null }), PricingInputError);
  assert.throws(() => computePricing({ ...base, targetMarginBp: -1, items: [item(1)], proposedPriceCents: null }), PricingInputError);
  assert.throws(() => computePricing({ ...base, contingencyBp: -5, items: [item(1)], proposedPriceCents: null }), PricingInputError);
  assert.throws(() => computePricing({ ...base, items: [item(-1)], proposedPriceCents: null }), /horas/);
  assert.throws(() => computePricing({ ...base, items: [item(1, -1)], proposedPriceCents: null }), /costo por hora/);
  assert.throws(() => computePricing({ ...base, items: [item(1, 2000.5)], proposedPriceCents: null }), PricingInputError);
  assert.throws(() => computePricing({ ...base, roundingCents: 0, items: [item(1)], proposedPriceCents: null }), PricingInputError);
  assert.throws(() => computePricing({ ...base, items: [item(1)], proposedPriceCents: -1 }), PricingInputError);
  assert.throws(() => computePricing({ ...base, items: [item(1)], proposedPriceCents: 10.5 }), PricingInputError);
});

test("importes escritos a mano → centavos, con coma o punto", () => {
  assert.equal(amountToCents("590"), 59000);
  assert.equal(amountToCents("1234.5"), 123450);
  assert.equal(amountToCents("1.234,50"), 123450);
  assert.equal(amountToCents("1,234.50"), 123450);
  assert.equal(amountToCents("12,5"), 1250);
  assert.equal(amountToCents(" 0 "), 0);
  assert.equal(amountToCents(""), null);
  assert.equal(amountToCents("abc"), null);
  assert.equal(amountToCents(8), 800);
  assert.equal(bpToPercent(1864), 18.64);
  assert.equal(percentToBp(40), 4000);
  assert.equal(percentToBp(18.64), 1864);
});

test("complejidad: bandas 0–3 baja, 4–9 media, 10+ alta", () => {
  assert.deepEqual(complexityScore(DEFAULT_COMPLEXITY), {
    score: 0,
    band: "low",
    points: { numbers: 0, agents: 0, automations: 0, data: 0, integrations: 0 },
  });
  assert.equal(complexityScore({ ...DEFAULT_COMPLEXITY, integrations: "documented" }).score, 3);
  assert.equal(complexityScore({ ...DEFAULT_COMPLEXITY, integrations: "documented" }).band, "low");
  assert.equal(complexityScore({ ...DEFAULT_COMPLEXITY, numbers: "few", agents: "autopilot" }).band, "medium");
  const high = complexityScore({ numbers: "few", agents: "autopilot", automations: "several", integrations: "documented", data: "scattered" });
  assert.equal(high.score, 11);
  assert.equal(high.band, "high");
  assert.equal(complexityScore({ numbers: "many", agents: "multiple", automations: "complex", integrations: "custom", data: "migration" }).score, 22);
});

test("estados: aprobar solo desde revisión; vencida se deriva de la vigencia", () => {
  assert.equal(canTransition("DRAFT", "approve"), false);
  assert.equal(canTransition("READY_FOR_REVIEW", "approve"), true);
  assert.equal(canTransition("APPROVED", "send"), true);
  assert.equal(canTransition("APPROVED", "reopen"), false, "lo aprobado no vuelve a borrador: nueva versión");
  assert.equal(canTransition("ACCEPTED", "revise"), true);
  assert.equal(canTransition("CANCELLED", "revise"), false);
  const past = new Date(Date.now() - 86_400_000);
  const future = new Date(Date.now() + 86_400_000);
  assert.equal(effectiveQuoteStatus("SENT", past), "EXPIRED");
  assert.equal(effectiveQuoteStatus("APPROVED", past.toISOString()), "EXPIRED");
  assert.equal(effectiveQuoteStatus("SENT", future), "SENT");
  assert.equal(effectiveQuoteStatus("DRAFT", past), "DRAFT", "un borrador no vence");
  assert.equal(effectiveQuoteStatus("ACCEPTED", past), "ACCEPTED", "lo aceptado no vence");
  assert.equal(effectiveQuoteStatus("SENT", null), "SENT");
});
