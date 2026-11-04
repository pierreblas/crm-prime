/**
 * Cotizador de implementaciones: el servicio de la consola de plataforma con
 * una base simulada en memoria.
 *
 *   npm run test:implquotes --workspace=apps/api
 *
 * La base simulada solo conoce las tres tablas del cotizador, el diario del
 * operador y `organization.findUnique`. Cualquier otro modelo lanza: así se
 * comprueba que cotizar no toca planes, cobros, IA ni oportunidades
 * (criterio 12 del documento de trabajo).
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";

process.env.TENANCY_MODE = "multi";

let shared: typeof import("@crm/shared");
let ImplementationsService: typeof import("../src/modules/platform/implementations.service").ImplementationsService;

before(async () => {
  shared = await import("@crm/shared");
  ({ ImplementationsService } = await import("../src/modules/platform/implementations.service"));
});

type Row = Record<string, any>;

const QUOTE_DEFAULTS = {
  status: "DRAFT",
  version: 1,
  currency: "USD",
  planKey: null,
  planPriceCentsSnapshot: null,
  aiBillingMode: "UNDECIDED",
  overheadsCents: 0,
  contingencyBp: 2000,
  targetMarginBp: 4000,
  roundingCents: 1000,
  proposedPriceCents: null,
  diagnosisFeeCents: null,
  diagnosisCredited: false,
  laborCents: 0,
  externalCents: 0,
  baseCostCents: 0,
  contingencyCents: 0,
  budgetedCostCents: 0,
  minimumPriceCents: 0,
  expectedMarginBp: null,
  belowMinimum: false,
  deliverables: "",
  assumptions: "",
  exclusions: "",
  clientRequirements: "",
  timelineNote: "",
  paymentTerms: "",
  externalCostsNote: "",
  taxNote: "",
  supportNote: "",
  validUntil: null,
  exceptionReason: null,
  exceptionBy: null,
  approvedSnapshot: null,
  approvedBy: null,
  approvedAt: null,
  sentAt: null,
  sentNote: null,
  acceptedAt: null,
  rejectedAt: null,
  rejectedReason: null,
  cancelledAt: null,
  supersededById: null,
};

/** Base en memoria con la parte de Prisma que usa el servicio. */
class FakeDb {
  orgs = new Map<string, Row>([["org_1", { id: "org_1", name: "Acme", slug: "acme" }]]);
  assessments = new Map<string, Row>();
  quotes = new Map<string, Row>();
  items = new Map<string, Row>();
  actuals = new Map<string, Row>();
  settingsRow: Row | null = null;
  audit: Row[] = [];
  seq = 0;
  numbers = 0;

  private assessmentWith(a: Row, include?: Row): Row {
    if (!include) return { ...a };
    const quotes = [...this.quotes.values()].filter((q) => q.assessmentId === a.id).sort((x, y) => y.version - x.version);
    return { ...a, org: a.orgId ? (this.orgs.get(a.orgId) ?? null) : null, quotes: quotes.map((q) => ({ ...q })) };
  }

  private quoteWith(q: Row, include?: Row): Row {
    if (!include) return { ...q };
    const items = [...this.items.values()].filter((it) => it.quoteId === q.id).sort((x, y) => x.sortOrder - y.sortOrder);
    const actuals = [...this.actuals.values()].filter((r) => r.quoteId === q.id).sort((x, y) => x.workedOn.getTime() - y.workedOn.getTime());
    const a = this.assessments.get(q.assessmentId)!;
    return { ...q, items: items.map((it) => ({ ...it })), actuals: actuals.map((r) => ({ ...r })), assessment: { ...a, org: a.orgId ? (this.orgs.get(a.orgId) ?? null) : null } };
  }

  client(): any {
    const self = this;
    const base: Row = {
      organization: { findUnique: async ({ where }: Row) => self.orgs.get(where.id) ?? null },
      platformAuditLog: {
        create: async ({ data }: Row) => {
          self.audit.push(data);
          return data;
        },
      },
      implementationAssessment: {
        findMany: async ({ where, include }: Row) =>
          [...self.assessments.values()].filter((a) => (where?.archivedAt === null ? !a.archivedAt : !!a.archivedAt)).map((a) => self.assessmentWith(a, include)),
        create: async ({ data, include }: Row) => {
          const a = { id: `a${++self.seq}`, quoteNumber: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
          self.assessments.set(a.id, a);
          return self.assessmentWith(a, include);
        },
        findUnique: async ({ where, include }: Row) => {
          const a = self.assessments.get(where.id);
          return a ? self.assessmentWith(a, include) : null;
        },
        update: async ({ where, data, include }: Row) => {
          const a = self.assessments.get(where.id);
          if (!a) throw new Error("diagnóstico inexistente");
          Object.assign(a, data, { updatedAt: new Date() });
          return self.assessmentWith(a, include);
        },
      },
      implementationQuote: {
        findUnique: async ({ where, include }: Row) => {
          const q = self.quotes.get(where.id);
          return q ? self.quoteWith(q, include) : null;
        },
        create: async ({ data, include }: Row) => {
          const { items, ...rest } = data;
          const q = { id: `q${++self.seq}`, ...QUOTE_DEFAULTS, createdAt: new Date(), updatedAt: new Date(), ...rest };
          self.quotes.set(q.id, q);
          for (const it of items?.create ?? []) {
            const id = `i${++self.seq}`;
            self.items.set(id, { id, quoteId: q.id, ...it });
          }
          return self.quoteWith(q, include);
        },
        update: async ({ where, data, include }: Row) => {
          const q = self.quotes.get(where.id);
          if (!q) throw new Error("cotización inexistente");
          Object.assign(q, data, { updatedAt: new Date() });
          return self.quoteWith(q, include);
        },
        aggregate: async ({ where }: Row) => {
          const vs = [...self.quotes.values()].filter((q) => q.assessmentId === where.assessmentId).map((q) => q.version);
          return { _max: { version: vs.length ? Math.max(...vs) : null } };
        },
      },
      implementationQuoteItem: {
        deleteMany: async ({ where }: Row) => {
          for (const [id, it] of self.items) if (it.quoteId === where.quoteId) self.items.delete(id);
        },
        createMany: async ({ data }: Row) => {
          for (const it of data) {
            const id = `i${++self.seq}`;
            self.items.set(id, { id, ...it });
          }
        },
      },
      implementationActual: {
        create: async ({ data }: Row) => {
          const id = `x${++self.seq}`;
          const row = { id, createdAt: new Date(), ...data };
          self.actuals.set(id, row);
          return row;
        },
        delete: async ({ where }: Row) => {
          self.actuals.delete(where.id);
        },
      },
      implementationPricingSettings: {
        findUnique: async () => (self.settingsRow ? { ...self.settingsRow } : null),
        upsert: async ({ create, update }: Row) => {
          self.settingsRow = self.settingsRow ? { ...self.settingsRow, ...update, updatedAt: new Date() } : { ...create, updatedAt: new Date() };
          return { ...self.settingsRow };
        },
      },
      $queryRaw: async () => [{ n: BigInt(++self.numbers) }],
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(proxy),
    };
    const proxy: any = new Proxy(base, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        if (typeof prop === "string" && !prop.startsWith("$") && prop !== "then") {
          throw new Error(`El cotizador tocó un modelo que no le corresponde: ${prop}`);
        }
        return undefined;
      },
    });
    return proxy;
  }
}

const ACTOR = "ops@driony.test";

function scope(extra: Partial<Record<string, unknown>> = {}) {
  return shared.assessmentScopeSchema.parse({ complexity: { ...shared.DEFAULT_COMPLEXITY, numbers: "few", agents: "autopilot" }, ...extra });
}

async function setup() {
  const db = new FakeDb();
  const svc = new ImplementationsService(db.client());
  const a = await svc.create(
    shared.createAssessmentSchema.parse({ title: "Clínica Sonrisa", clientName: "Clínica Sonrisa SAC", orgId: "org_1", scope: scope(), riskFlags: ["no_meta_access"] }),
    ACTOR,
  );
  return { db, svc, a };
}

/** Todas las claves de un objeto, anidadas. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k), keysDeep(x, out));
  return out;
}

test("el diagnóstico guarda la complejidad calculada en el servidor y queda en el diario", async () => {
  const { db, a } = await setup();
  assert.equal(a.complexityScore, 4);
  assert.equal(a.complexityBand, "medium");
  assert.equal(a.stage, "diagnosis");
  assert.equal(a.orgName, "Acme");
  assert.equal(a.quoteNumber, null);
  assert.deepEqual(a.riskFlags, ["no_meta_access"]);
  assert.equal(db.audit.length, 1);
  assert.equal(db.audit[0]!.action, "assessment_created");
  assert.equal(db.audit[0]!.orgId, "org_1");
});

test("una empresa inexistente se rechaza", async () => {
  const { svc } = await setup();
  await assert.rejects(
    () => svc.create(shared.createAssessmentSchema.parse({ title: "x", clientName: "y", orgId: "nope", scope: scope() }), ACTOR),
    /no existe/,
  );
});

test("la primera cotización recibe número, versión 1 y vigencia; la segunda no se crea", async () => {
  const { svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  assert.match(q.number, /^COT-\d{4}-0001$/);
  assert.equal(q.version, 1);
  assert.equal(q.status, "DRAFT");
  assert.equal(q.editable, true);
  assert.ok(q.validUntil && new Date(q.validUntil).getTime() > Date.now());
  assert.equal(q.paymentTerms, shared.IMPLEMENTATION_DEFAULTS.paymentTerms);
  assert.deepEqual(q.pricing.alerts, ["no_items", "price_missing"]);
  await assert.rejects(() => svc.createQuote(a.id, ACTOR), /ya tiene cotización/);
  const again = await svc.get(a.id);
  assert.equal(again.quoteNumber, q.number);
  assert.equal(again.stage, "quoting");
});

test("el ejemplo del documento de punta a punta: 800 de mínimo, 590 exige motivo, y se congela al aprobar", async () => {
  const { db, svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);

  const priced = await svc.updateQuote(
    q.id,
    { items: [{ category: "CONFIGURATION", description: "Puesta en marcha", hours: 20, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }], proposedPriceCents: 59000, planKey: "pro" },
    ACTOR,
  );
  assert.equal(priced.pricing.minimumPriceCents, 80000);
  assert.equal(priced.pricing.expectedMarginBp, 1864);
  assert.equal(priced.pricing.belowMinimum, true);
  assert.equal(priced.planPriceCentsSnapshot, 4900, "el precio del plan se congela en centavos al cotizar");
  assert.equal(priced.publicView.plan?.name, "Pro");

  // En borrador no se aprueba; a revisión sí.
  await assert.rejects(() => svc.act(q.id, "approve", {}, ACTOR), /estado DRAFT/);
  const review = await svc.act(q.id, "submit", {}, ACTOR);
  assert.equal(review.status, "READY_FOR_REVIEW");
  assert.equal(review.editable, false);

  // Bajo mínimo sin motivo: no.
  await assert.rejects(() => svc.act(q.id, "approve", {}, ACTOR), /por debajo del mínimo/);
  await assert.rejects(() => svc.act(q.id, "approve", { reason: "   " }, ACTOR), /por debajo del mínimo/);

  const approved = await svc.act(q.id, "approve", { reason: "Primer cliente del sector, caso de referencia" }, ACTOR);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.exceptionReason, "Primer cliente del sector, caso de referencia");
  assert.equal(approved.exceptionBy, ACTOR);
  assert.equal(approved.approvedBy, ACTOR);
  assert.equal(approved.hasApprovedSnapshot, true);
  const snap = db.quotes.get(q.id)!.approvedSnapshot;
  assert.equal(snap.pricing.minimumPriceCents, 80000);
  assert.equal(snap.items.length, 1);

  // Ya no se edita.
  await assert.rejects(() => svc.updateQuote(q.id, { proposedPriceCents: 1 }, ACTOR), /ya no se edita/);

  const actions = db.audit.map((e) => e.action);
  assert.deepEqual(actions, ["assessment_created", "quote_created", "quote_submitted", "quote_exception_approved"]);
  const exc = db.audit.at(-1)!;
  assert.equal(exc.details.proposedCents, 59000);
  assert.equal(exc.details.minimumCents, 80000);
  assert.equal(exc.details.reason, "Primer cliente del sector, caso de referencia");
});

test("a precio igual o mayor que el mínimo se aprueba sin motivo y sin excepción", async () => {
  const { db, svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  await svc.updateQuote(q.id, { items: [{ category: "AGENT", description: "Agente", hours: 20, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }], proposedPriceCents: 80000 }, ACTOR);
  await svc.act(q.id, "submit", {}, ACTOR);
  const ok = await svc.act(q.id, "approve", {}, ACTOR);
  assert.equal(ok.status, "APPROVED");
  assert.equal(ok.exceptionReason, null);
  assert.equal(db.audit.at(-1)!.action, "quote_approved");
});

test("enviar a revisión exige partidas y precio", async () => {
  const { svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  await assert.rejects(() => svc.act(q.id, "submit", {}, ACTOR), /al menos una partida/);
  await svc.updateQuote(q.id, { items: [{ category: "QA", description: "Pruebas", hours: 2, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }] }, ACTOR);
  await assert.rejects(() => svc.act(q.id, "submit", {}, ACTOR), /precio propuesto/);
});

test("enviar, aceptar, y la versión nueva desde una aceptada la deja intacta", async () => {
  const { db, svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  await svc.updateQuote(q.id, { items: [{ category: "AGENT", description: "Agente", hours: 20, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }], proposedPriceCents: 80000, deliverables: "Agente listo" }, ACTOR);
  await svc.act(q.id, "submit", {}, ACTOR);
  await svc.act(q.id, "approve", {}, ACTOR);
  const sent = await svc.act(q.id, "send", { note: "Por WhatsApp al gerente" }, ACTOR);
  assert.equal(sent.status, "SENT");
  assert.equal(sent.sentNote, "Por WhatsApp al gerente");
  assert.deepEqual(sent.actions, ["accept", "reject", "cancel", "revise"]);
  const accepted = await svc.act(q.id, "accept", {}, ACTOR);
  assert.equal(accepted.status, "ACCEPTED");
  assert.deepEqual(accepted.actions, ["revise"]);
  assert.equal((await svc.get(a.id)).stage, "accepted");

  const v2 = await svc.act(q.id, "revise", { reason: "Cambio de alcance: segundo número" }, ACTOR);
  assert.equal(v2.version, 2);
  assert.equal(v2.status, "DRAFT");
  assert.equal(v2.number, q.number, "las versiones comparten número");
  assert.equal(v2.items.length, 1);
  assert.equal(v2.items[0]!.hours, 20);
  assert.equal(v2.deliverables, "Agente listo");
  assert.equal(v2.approvedBy, null);
  assert.equal(v2.hasApprovedSnapshot, false);

  const v1 = await svc.getQuote(q.id);
  assert.equal(v1.status, "ACCEPTED", "el contrato aceptado se queda como está");
  assert.equal(v1.supersededById, v2.id);
  assert.equal(db.audit.at(-1)!.action, "quote_revised");
  assert.equal((await svc.get(a.id)).quotes.length, 2);
});

test("la versión nueva desde una enviada la marca como reemplazada", async () => {
  const { svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  await svc.updateQuote(q.id, { items: [{ category: "AGENT", description: "Agente", hours: 20, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }], proposedPriceCents: 80000 }, ACTOR);
  await svc.act(q.id, "submit", {}, ACTOR);
  await svc.act(q.id, "approve", {}, ACTOR);
  await svc.act(q.id, "send", {}, ACTOR);
  const v2 = await svc.act(q.id, "revise", {}, ACTOR);
  assert.equal((await svc.getQuote(q.id)).status, "SUPERSEDED");
  assert.equal(v2.version, 2);
  // Y una tercera desde la segunda, una vez aprobada y enviada, va a la 3.
  await svc.updateQuote(v2.id, { proposedPriceCents: 90000 }, ACTOR);
  await svc.act(v2.id, "submit", {}, ACTOR);
  await svc.act(v2.id, "approve", {}, ACTOR);
  await svc.act(v2.id, "send", {}, ACTOR);
  const rejected = await svc.act(v2.id, "reject", { reason: "Caro" }, ACTOR);
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.rejectedReason, "Caro");
  const v3 = await svc.act(v2.id, "revise", {}, ACTOR);
  assert.equal(v3.version, 3);
});

test("rechazar exige motivo; cancelar vale desde cualquier estado abierto", async () => {
  const { svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  await svc.updateQuote(q.id, { items: [{ category: "AGENT", description: "Agente", hours: 1, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }], proposedPriceCents: 10000 }, ACTOR);
  await svc.act(q.id, "submit", {}, ACTOR);
  await svc.act(q.id, "approve", {}, ACTOR);
  await svc.act(q.id, "send", {}, ACTOR);
  await assert.rejects(() => svc.act(q.id, "reject", {}, ACTOR), /motivo/);
  const c = await svc.act(q.id, "cancel", { reason: "El cliente cerró" }, ACTOR);
  assert.equal(c.status, "CANCELLED");
  assert.deepEqual(c.actions, []);
  assert.equal((await svc.get(a.id)).stage, "cancelled");
});

test("una enviada con la vigencia pasada se lee vencida: solo cabe una versión nueva", async () => {
  const { db, svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  await svc.updateQuote(q.id, { items: [{ category: "AGENT", description: "Agente", hours: 1, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }], proposedPriceCents: 10000 }, ACTOR);
  await svc.act(q.id, "submit", {}, ACTOR);
  await svc.act(q.id, "approve", {}, ACTOR);
  await svc.act(q.id, "send", {}, ACTOR);
  db.quotes.get(q.id)!.validUntil = new Date(Date.now() - 86_400_000);
  const expired = await svc.getQuote(q.id);
  assert.equal(expired.status, "EXPIRED");
  assert.equal(expired.storedStatus, "SENT");
  assert.deepEqual(expired.actions, ["revise"]);
  await assert.rejects(() => svc.act(q.id, "accept", {}, ACTOR), /EXPIRED/);
  assert.equal((await svc.get(a.id)).stage, "expired");
  const v2 = await svc.act(q.id, "revise", {}, ACTOR);
  assert.equal(v2.version, 2);
});

test("aprobar con la vigencia pasada se rechaza en vez de nacer vencida", async () => {
  const { svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  await svc.updateQuote(
    q.id,
    { items: [{ category: "AGENT", description: "Agente", hours: 1, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }], proposedPriceCents: 10000, validUntil: new Date(Date.now() - 1000).toISOString() },
    ACTOR,
  );
  await svc.act(q.id, "submit", {}, ACTOR);
  await assert.rejects(() => svc.act(q.id, "approve", {}, ACTOR), /vigencia/);
});

test("la vista para el cliente no lleva horas, costos internos, márgenes ni mínimos", async () => {
  const { svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  const full = await svc.updateQuote(
    q.id,
    {
      items: [{ category: "INTEGRATION", description: "Conexión con ERP", hours: 8, hourlyCostCents: 2500, thirdPartyCents: 5000, otherCents: 0 }],
      proposedPriceCents: 120000,
      diagnosisFeeCents: 9900,
      diagnosisCredited: true,
      planKey: "starter",
      aiBillingMode: "BYOK",
      externalCostsNote: "Los mensajes de Meta se pagan aparte",
    },
    ACTOR,
  );
  const pub = full.publicView;
  assert.equal(pub.implementationPriceCents, 120000);
  assert.equal(pub.diagnosisCreditCents, 9900, "el diagnóstico pagado se acredita como línea explícita");
  assert.equal(pub.totalDueCents, 110100);
  assert.deepEqual(pub.plan, { key: "starter", name: "Inicial", monthlyCents: 1900 });
  assert.equal(pub.aiBillingMode, "BYOK");
  assert.deepEqual(pub.lines, [{ category: "INTEGRATION", description: "Conexión con ERP" }]);
  const keys = keysDeep(pub);
  for (const forbidden of ["hours", "hourlyCostCents", "thirdPartyCents", "otherCents", "laborCents", "budgetedCostCents", "minimumPriceCents", "expectedMarginBp", "targetMarginBp", "contingencyBp", "contingencyCents", "belowMinimum", "exceptionReason", "pricing", "items"]) {
    assert.ok(!keys.has(forbidden), `la vista pública lleva «${forbidden}»`);
  }
  // Lo interno sí está en la ficha del operador.
  assert.equal(full.pricing.budgetedCostCents, 30000);
  assert.equal(full.pricing.minimumPriceCents, 50000);
});

test("el diagnóstico se edita con parches y recalcula la complejidad", async () => {
  const { svc, a } = await setup();
  const u = await svc.update(a.id, { scope: scope({ complexity: { numbers: "many", agents: "multiple", automations: "complex", integrations: "custom", data: "migration" } }), riskFlags: ["undocumented_api", "legacy_system"] }, ACTOR);
  assert.equal(u.complexityScore, 22);
  assert.equal(u.complexityBand, "high");
  assert.deepEqual(u.riskFlags, ["undocumented_api", "legacy_system"]);
  const renamed = await svc.update(a.id, { title: "Clínica Sonrisa · fase 2" }, ACTOR);
  assert.equal(renamed.title, "Clínica Sonrisa · fase 2");
  assert.equal(renamed.complexityScore, 22, "sin alcance nuevo, la complejidad se conserva");
  const list = await svc.list("sonrisa");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.title, "Clínica Sonrisa · fase 2");
});

test("los ajustes valen los de código hasta que se guardan, y guardar queda en el diario", async () => {
  const { db, svc, a } = await setup();
  const initial = await svc.settings();
  assert.equal(initial.updatedBy, null);
  assert.deepEqual(initial.settings, shared.DEFAULT_PRICING_SETTINGS);
  assert.equal(initial.settings.templates.length, 3, "Esencial, Híbrida y Personalizada");

  await assert.rejects(
    () => svc.updateSettings({ ...shared.DEFAULT_PRICING_SETTINGS, templates: [{ key: "x", name: "X", description: "", items: [{ category: "QA", description: "Pruebas", hours: 1, rateKey: "inexistente" }] }] }, ACTOR),
    /tarifa que no existe/,
  );
  const saved = await svc.updateSettings({ ...shared.DEFAULT_PRICING_SETTINGS, hourlyCostCents: 2500, validityDays: 30, paymentTerms: "100 % al iniciar" }, ACTOR);
  assert.equal(saved.updatedBy, ACTOR);
  assert.equal(saved.settings.hourlyCostCents, 2500);
  const entry = db.audit.at(-1)!;
  assert.equal(entry.action, "pricing_settings_changed");
  assert.deepEqual(entry.details.changed, ["hourlyCostCents", "validityDays", "paymentTerms"]);
  assert.deepEqual(entry.details.from, { hourlyCostCents: 2000, validityDays: 15 });
  assert.deepEqual(entry.details.to, { hourlyCostCents: 2500, validityDays: 30 });

  // La cotización nueva nace con los ajustes guardados.
  const q = await svc.createQuote(a.id, ACTOR);
  assert.equal(q.paymentTerms, "100 % al iniciar");
  const days = Math.round((new Date(q.validUntil!).getTime() - Date.now()) / 86_400_000);
  assert.equal(days, 30);
  assert.equal(q.diagnosisFeeCents, 9900);
});

test("las horas reales solo van sobre la versión aceptada y comparan con lo presupuestado", async () => {
  const { db, svc, a } = await setup();
  const q = await svc.createQuote(a.id, ACTOR);
  await svc.updateQuote(q.id, { items: [{ category: "AGENT", description: "Agente", hours: 20, hourlyCostCents: 2000, thirdPartyCents: 0, otherCents: 0 }], proposedPriceCents: 80000 }, ACTOR);
  const actual = { category: "AGENT" as const, description: "Prompt y pruebas", hours: 25, hourlyCostCents: 2000, costCents: 5000, workedOn: "2026-11-10", note: "" };
  await assert.rejects(() => svc.addActual(q.id, actual, ACTOR), /versión aceptada/);
  await svc.act(q.id, "submit", {}, ACTOR);
  await svc.act(q.id, "approve", {}, ACTOR);
  await svc.act(q.id, "send", {}, ACTOR);
  await svc.act(q.id, "accept", {}, ACTOR);

  const withActual = await svc.addActual(q.id, actual, ACTOR);
  assert.equal(withActual.actuals.length, 1);
  assert.equal(withActual.actuals[0]!.workedOn, "2026-11-10");
  assert.deepEqual(withActual.actualsSummary, {
    hours: 25,
    laborCents: 50000,
    externalCents: 5000,
    totalCents: 55000,
    budgetedHours: 20,
    budgetedCents: 48000,
    realMarginBp: 3125, // (80 000 − 55 000) / 80 000
  });
  assert.equal(db.audit.at(-1)!.action, "quote_actual_added");
  assert.ok(!JSON.stringify(withActual.publicView).includes("55000"), "lo real no sale en la vista del cliente");

  const removed = await svc.removeActual(q.id, withActual.actuals[0]!.id, ACTOR);
  assert.equal(removed.actuals.length, 0);
  assert.equal(removed.actualsSummary.realMarginBp, null);
  await assert.rejects(() => svc.removeActual(q.id, "nope", ACTOR), /no encontrado/);
});

test("archivar saca el diagnóstico del listado y restaurar lo devuelve", async () => {
  const { db, svc, a } = await setup();
  const archived = await svc.archive(a.id, true, ACTOR);
  assert.ok(archived.archivedAt);
  assert.equal((await svc.list()).length, 0);
  assert.equal((await svc.list("", true)).length, 1);
  assert.equal(db.audit.at(-1)!.action, "assessment_archived");
  await svc.archive(a.id, true, ACTOR);
  assert.equal(db.audit.filter((e) => e.action === "assessment_archived").length, 1, "archivar dos veces no repite el diario");
  const restored = await svc.archive(a.id, false, ACTOR);
  assert.equal(restored.archivedAt, null);
  assert.equal((await svc.list()).length, 1);
  assert.equal(db.audit.at(-1)!.action, "assessment_restored");
});

test("un prospecto sin cuenta cotiza igual y su diario va sin empresa", async () => {
  const db = new FakeDb();
  const svc = new ImplementationsService(db.client());
  const a = await svc.create(shared.createAssessmentSchema.parse({ title: "Ferretería Lima", clientName: "Ferretería Lima", scope: scope() }), ACTOR);
  assert.equal(a.orgId, null);
  assert.equal(a.orgName, null);
  const q = await svc.createQuote(a.id, ACTOR);
  assert.match(q.number, /^COT-/);
  assert.ok(db.audit.every((e) => e.orgId === null));
});
