/**
 * Formularios de Meta (Lead Ads): por formulario, si sus leads entran y a qué
 * etapa del embudo va su oportunidad. Base de datos y Graph API simuladas.
 *
 *   npm run test:metaforms --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MetaLeadService } from "../src/modules/meta-leads/meta-lead.service";
import { MetaPageService } from "../src/modules/meta-leads/meta-page.service";

type Deal = { id: string; contactId: string; stageId: string; discardedAt: Date | null; discardReason: string | null; createdAt: Date };
const STAGES = [
  { id: "nuevo", pipelineId: "ventas", order: 0, isWon: false, isLost: false, isDefault: true },
  { id: "calificado", pipelineId: "ventas", order: 1, isWon: false, isLost: false, isDefault: true },
  { id: "ganado", pipelineId: "ventas", order: 2, isWon: true, isLost: false, isDefault: true },
  { id: "inscritos", pipelineId: "cursos", order: 0, isWon: false, isLost: false, isDefault: false },
];

function setup(page: Record<string, unknown>, opts: { formId?: string; deals?: Deal[] } = {}) {
  const deals: Deal[] = [...(opts.deals ?? [])];
  const emitted: Array<{ name: string; payload: { stageId?: string; dealId?: string } }> = [];
  const recorded: Array<{ status: string }> = [];
  let seq = 0;
  const stageSel = (s: (typeof STAGES)[number] | undefined) => (s ? { id: s.id, pipelineId: s.pipelineId } : null);
  const prisma = {
    metaLead: {
      findUnique: async () => null,
      create: async ({ data }: { data: { status: string } }) => void recorded.push(data),
    },
    metaPage: { findUnique: async () => ({ isActive: true, accessToken: "tok", ...page }) },
    whatsappConnection: { findFirst: async () => null },
    pipelineStage: {
      findUnique: async ({ where }: { where: { id: string } }) => stageSel(STAGES.find((s) => s.id === where.id)),
      findFirst: async () => stageSel(STAGES.find((s) => s.isDefault && s.order === 0)),
    },
    deal: {
      findFirst: async ({ where }: { where: { contactId: string } }) => {
        const d = deals.filter((x) => x.contactId === where.contactId).at(-1);
        if (!d) return null;
        const s = STAGES.find((x) => x.id === d.stageId)!;
        return { ...d, stage: { isWon: s.isWon, isLost: s.isLost, pipelineId: s.pipelineId } };
      },
      create: async ({ data }: { data: { contactId: string; stageId: string } }) => {
        const d = { id: `d${++seq}`, discardedAt: null, discardReason: null, createdAt: new Date(), ...data };
        deals.push(d);
        return d;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Deal> }) => {
        const d = deals.find((x) => x.id === where.id)!;
        Object.assign(d, data);
        return d;
      },
    },
  };
  const graph = {
    getLead: async () => ({ formId: opts.formId ?? "f-cursos", fields: [{ name: "full_name", value: "Ana" }, { name: "phone_number", value: "+51999888777" }] }),
    getFormName: async () => "Formulario de prueba",
    getLeadAdInfo: async () => null,
  };
  const leads = { ingestLead: async () => ({ id: "ct1", created: true }) };
  const events = { emit: (name: string, payload: { stageId?: string; dealId?: string }) => void emitted.push({ name, payload }) };
  const svc = new MetaLeadService(prisma as never, {} as never, graph as never, leads as never, {} as never, events as never);
  const lead = () => svc.processNotification({ leadgenId: `lg${++seq}`, pageId: "p1", formId: opts.formId ?? "f-cursos" });
  return { lead, deals, emitted, recorded };
}

const PAGE = { orgId: "org1", pageId: "p1", name: "Mi página", sourceId: null, tagIds: [], welcomeTemplateId: null };

test("cada formulario entra en la etapa elegida, también de otro embudo", async () => {
  const t = setup(
    { ...PAGE, createDeal: true, dealStageId: "nuevo", formRules: [{ formId: "f-cursos", formName: "Cursos", enabled: true, stage: "inscritos" }] },
    { formId: "f-cursos" },
  );
  await t.lead();
  assert.deepEqual(t.deals.map((d) => d.stageId), ["inscritos"]);
  assert.ok(
    t.emitted.some((e) => e.name === "deal.stage_changed" && e.payload.stageId === "inscritos"),
    "avisa del cambio de etapa: corren sus automatizaciones, conversiones y flujos",
  );
});

test("un formulario sin regla sigue a la página, y la página puede elegir su etapa", async () => {
  const t = setup({ ...PAGE, createDeal: true, dealStageId: "calificado", formRules: [] }, { formId: "f-otro" });
  await t.lead();
  assert.deepEqual(t.deals.map((d) => d.stageId), ["calificado"]);

  const legacy = setup({ ...PAGE, createDeal: true, dealStageId: null, formRules: [] });
  await legacy.lead();
  assert.deepEqual(legacy.deals.map((d) => d.stageId), ["nuevo"], "sin etapa: la primera del embudo predeterminado, como antes");
});

test("un formulario apagado no entra; «sin oportunidad» crea el contacto pero no la oportunidad", async () => {
  const off = setup({ ...PAGE, createDeal: true, dealStageId: null, formRules: [{ formId: "f-cursos", formName: "", enabled: false, stage: "page" }] });
  await off.lead();
  assert.equal(off.recorded.length, 0, "ni se guarda el lead");
  assert.equal(off.deals.length, 0);

  const none = setup({ ...PAGE, createDeal: true, dealStageId: null, formRules: [{ formId: "f-cursos", formName: "", enabled: true, stage: "none" }] });
  await none.lead();
  assert.equal(none.recorded[0]?.status, "PROCESSED");
  assert.equal(none.deals.length, 0);
});

test("la regla del formulario manda aunque la página no cree oportunidades", async () => {
  const t = setup({ ...PAGE, createDeal: false, dealStageId: null, formRules: [{ formId: "f-cursos", formName: "", enabled: true, stage: "calificado" }] });
  await t.lead();
  assert.deepEqual(t.deals.map((d) => d.stageId), ["calificado"]);
});

test("si ya tiene una oportunidad en curso no se duplica; una ganada sí abre otra", async () => {
  const open = setup(
    { ...PAGE, createDeal: true, dealStageId: "nuevo", formRules: [] },
    { deals: [{ id: "d0", contactId: "ct1", stageId: "calificado", discardedAt: null, discardReason: null, createdAt: new Date() }] },
  );
  await open.lead();
  assert.equal(open.deals.length, 1);

  const won = setup(
    { ...PAGE, createDeal: true, dealStageId: "nuevo", formRules: [] },
    { deals: [{ id: "d0", contactId: "ct1", stageId: "ganado", discardedAt: null, discardReason: null, createdAt: new Date() }] },
  );
  await won.lead();
  assert.deepEqual(won.deals.map((d) => d.stageId), ["ganado", "nuevo"]);
});

test("la lista de formularios junta los de Meta, los que trajeron leads y las reglas guardadas", async () => {
  const page = {
    id: "mp1",
    pageId: "p1",
    accessToken: "tok",
    formRules: [{ formId: "f2", formName: "Cursos", enabled: false, stage: "none" }],
  };
  const prisma = {
    metaPage: { findUnique: async () => page },
    metaLead: {
      groupBy: async () => [
        { formId: "f2", formName: "Cursos", _count: { _all: 3 }, _max: { createdAt: new Date("2026-11-01T10:00:00Z") } },
        { formId: "f9", formName: "Viejo", _count: { _all: 1 }, _max: { createdAt: new Date("2026-10-01T10:00:00Z") } },
      ],
    },
  };
  const withMeta = new MetaPageService(prisma as never, {} as never, {
    listForms: async () => [
      { id: "f1", name: "Promo noviembre", status: "ACTIVE" },
      { id: "f2", name: "Cursos", status: "ACTIVE" },
    ],
  } as never);
  const r = await withMeta.forms("mp1");
  assert.equal(r.fromMeta, true);
  const byId = Object.fromEntries(r.forms.map((f) => [f.formId, f]));
  assert.deepEqual(Object.keys(byId).sort(), ["f1", "f2", "f9"]);
  assert.equal(byId.f1!.stage, "page", "sin regla: como la página");
  assert.equal(byId.f2!.enabled, false);
  assert.equal(byId.f2!.leadCount, 3);
  assert.equal(r.forms[0]!.formId, "f2", "primero el que trajo leads hace menos");

  const noMeta = new MetaPageService(prisma as never, {} as never, { listForms: async () => null } as never);
  const r2 = await noMeta.forms("mp1");
  assert.equal(r2.fromMeta, false, "Meta no deja listarlos: solo los que mandaron leads");
  assert.deepEqual(r2.forms.map((f) => f.formId).sort(), ["f2", "f9"]);
});
