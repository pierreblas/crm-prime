/**
 * Formularios de Meta (Lead Ads): por formulario, si sus leads entran, a qué
 * etapa del embudo va su oportunidad, su fuente, sus etiquetas y a dónde va
 * cada respuesta. Base de datos y Graph API simuladas.
 *
 *   npm run test:metaforms --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MetaLeadService, type LeadgenNotification } from "../src/modules/meta-leads/meta-lead.service";
import { MetaPageService } from "../src/modules/meta-leads/meta-page.service";
import { mapMetaLeadFields, type MetaFormRule } from "@crm/shared";

type Deal = { id: string; contactId: string; stageId: string; discardedAt: Date | null; discardReason: string | null; createdAt: Date };
const NAME_OF: Record<string, string> = { form: "Formulario de Facebook", whatsapp: "WhatsApp" };
const KIND_OF: Record<string, string> = { "Formulario de Facebook": "form", WhatsApp: "whatsapp" };
const STAGES = [
  { id: "nuevo", pipelineId: "ventas", order: 0, isWon: false, isLost: false, isDefault: true },
  { id: "calificado", pipelineId: "ventas", order: 1, isWon: false, isLost: false, isDefault: true },
  { id: "ganado", pipelineId: "ventas", order: 2, isWon: true, isLost: false, isDefault: true },
  { id: "inscritos", pipelineId: "cursos", order: 0, isWon: false, isLost: false, isDefault: false },
];

function setup(
  page: Record<string, unknown>,
  opts: {
    formId?: string;
    deals?: Deal[];
    contactSource?: string | null;
    sources?: Record<string, string>;
    fields?: Array<{ name: string; value: string }>;
    /** Un lead ya guardado, para reprocesarlo. */
    storedLead?: Record<string, unknown>;
  } = {},
) {
  const deals: Deal[] = [...(opts.deals ?? [])];
  const emitted: Array<{ name: string; payload: { stageId?: string; dealId?: string } }> = [];
  const recorded: Array<{ status: string; createdAt?: Date }> = [];
  // Lo que llega a LeadService.ingestLead, para ver nombre, teléfono, campos y etiquetas.
  const ingested: Array<{ name?: string; phone: string; source?: string; tags: string[]; fields: Record<string, string> }> = [];
  const ingestedOpts: Array<{ silent?: boolean }> = [];
  // Plantillas de bienvenida que se mandaron.
  const welcomes: string[] = [];
  // Fuentes de la empresa por nombre → id, y la del contacto que deja el lead.
  const sources = new Map(Object.entries(opts.sources ?? {}));
  const contact = { sourceId: opts.contactSource ?? null };
  let seq = 0;
  const stageSel = (s: (typeof STAGES)[number] | undefined) => (s ? { id: s.id, pipelineId: s.pipelineId } : null);
  const prisma = {
    source: {
      findUnique: async ({ where }: { where: { id?: string; orgId_name?: { name: string } } }) => {
        const hit = [...sources].find(([name, id]) => (where.id ? id === where.id : name === where.orgId_name!.name));
        return hit ? { id: hit[1], name: hit[0], kind: KIND_OF[hit[0]] ?? null } : null;
      },
      // Las automáticas se reconocen por su `kind` (fuenteAutomatica): aquí, por el nombre con el que nacen.
      findFirst: async ({ where }: { where: { kind: string } }) => {
        const name = NAME_OF[where.kind];
        return name && sources.has(name) ? { id: sources.get(name)! } : null;
      },
      create: async ({ data }: { data: { name: string } }) => {
        if (!sources.has(data.name)) sources.set(data.name, `src-${data.name}`);
        return { id: sources.get(data.name)! };
      },
      update: async () => ({}),
      upsert: async ({ where }: { where: { orgId_name: { name: string } } }) => {
        const name = where.orgId_name.name;
        if (!sources.has(name)) sources.set(name, `src-${name}`);
        return { id: sources.get(name)! };
      },
    },
    contact: {
      updateMany: async ({ where, data }: { where: { OR: Array<{ sourceId: string | null }> }; data: { sourceId: string } }) => {
        if (!where.OR.some((c) => c.sourceId === contact.sourceId)) return { count: 0 };
        contact.sourceId = data.sourceId;
        return { count: 1 };
      },
    },
    tag: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, name: `tag-${id}` })),
    },
    metaLead: {
      findUnique: async ({ where }: { where: { id?: string } }) =>
        where.id && opts.storedLead ? { ...opts.storedLead, page: { isActive: true, accessToken: "tok", ...page } } : null,
      create: async ({ data }: { data: { status: string; createdAt?: Date } }) => void recorded.push(data),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(opts.storedLead!, data);
        return { ...opts.storedLead!, page: { name: "Mi página" } };
      },
    },
    conversation: { findFirst: async () => ({ id: "cv1" }) },
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
    getLead: async () => ({ formId: opts.formId ?? "f-cursos", fields: opts.fields ?? [{ name: "full_name", value: "Ana" }, { name: "phone_number", value: "+51999888777" }] }),
    getFormName: async () => "Formulario de prueba",
    getLeadAdInfo: async () => null,
  };
  // Como LeadService: una fuente con nombre se crea si falta y se pone al contacto.
  const leads = {
    ingestLead: async (input: (typeof ingested)[number], _via: string, o?: { silent?: boolean }) => {
      ingested.push(input);
      ingestedOpts.push(o ?? {});
      if (input.source) {
        if (!sources.has(input.source)) sources.set(input.source, `src-${input.source}`);
        contact.sourceId = sources.get(input.source)!;
      }
      return { id: "ct1", created: true };
    },
  };
  const events = { emit: (name: string, payload: { stageId?: string; dealId?: string }) => void emitted.push({ name, payload }) };
  const messaging = { sendTemplateMessage: async (input: { templateId: string }) => void welcomes.push(input.templateId) };
  const svc = new MetaLeadService(prisma as never, {} as never, graph as never, leads as never, messaging as never, events as never);
  const lead = (extra: Partial<LeadgenNotification> = {}) =>
    svc.processNotification({ leadgenId: `lg${++seq}`, pageId: "p1", formId: opts.formId ?? "f-cursos", ...extra });
  return { svc, lead, deals, emitted, recorded, contact, sources, ingested, ingestedOpts, welcomes };
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

test("sin fuente elegida, el lead recibe «Formulario de Facebook», no «WhatsApp»", async () => {
  const fresh = setup({ ...PAGE, createDeal: false, dealStageId: null, formRules: [] });
  await fresh.lead();
  assert.equal(fresh.contact.sourceId, fresh.sources.get("Formulario de Facebook"), "se crea y se pone");

  // Escribió por el botón de WhatsApp del formulario antes de que llegara el lead.
  const viaWa = setup(
    { ...PAGE, createDeal: false, dealStageId: null, formRules: [] },
    { sources: { WhatsApp: "src-wa" }, contactSource: "src-wa" },
  );
  await viaWa.lead();
  assert.equal(viaWa.contact.sourceId, viaWa.sources.get("Formulario de Facebook"), "la del formulario dice más que «WhatsApp»");

  const manual = setup(
    { ...PAGE, createDeal: false, dealStageId: null, formRules: [] },
    { sources: { Referidos: "src-ref" }, contactSource: "src-ref" },
  );
  await manual.lead();
  assert.equal(manual.contact.sourceId, "src-ref", "una fuente puesta a mano se respeta");

  const chosen = setup(
    { ...PAGE, sourceId: "src-fb", createDeal: false, dealStageId: null, formRules: [] },
    { sources: { "Facebook Ads": "src-fb" } },
  );
  await chosen.lead();
  assert.equal(chosen.contact.sourceId, "src-fb", "la que elige la página");
  assert.equal(chosen.sources.has("Formulario de Facebook"), false, "y no se crea la automática");
});

test("cada formulario puede tener su fuente y sumar etiquetas a las de la página", async () => {
  const rule = { formId: "f-cursos", formName: "Cursos", enabled: true, stage: "page" };
  const own = setup(
    { ...PAGE, sourceId: "src-fb", tagIds: ["t-page"], createDeal: false, dealStageId: null, formRules: [{ ...rule, source: "src-cursos", tagIds: ["t-cursos", "t-page"] }] },
    { sources: { "Facebook Ads": "src-fb", Cursos: "src-cursos" } },
  );
  await own.lead();
  assert.equal(own.contact.sourceId, "src-cursos");
  assert.deepEqual(own.ingested[0]!.tags.sort(), ["tag-t-cursos", "tag-t-page"], "las dos, sin repetir");

  const auto = setup(
    { ...PAGE, sourceId: "src-fb", createDeal: false, dealStageId: null, formRules: [{ ...rule, source: "auto" }] },
    { sources: { "Facebook Ads": "src-fb" } },
  );
  await auto.lead();
  assert.equal(auto.contact.sourceId, auto.sources.get("Formulario de Facebook"), "«automática» aunque la página tenga otra");

  const gone = setup(
    { ...PAGE, sourceId: "src-fb", createDeal: false, dealStageId: null, formRules: [{ ...rule, source: "src-borrada" }] },
    { sources: { "Facebook Ads": "src-fb" } },
  );
  await gone.lead();
  assert.equal(gone.contact.sourceId, "src-fb", "si la del formulario se borró, la de la página");
});

test("las respuestas van a donde se eligió; el resto, solas por el nombre de la pregunta", async () => {
  const t = setup(
    {
      ...PAGE,
      createDeal: false,
      dealStageId: null,
      formRules: [
        {
          formId: "f-cursos",
          formName: "Cursos",
          fieldMap: {
            "¿cuál_es_tu_whatsapp?": "std:phone",
            "nombres": "std:name",
            "apellidos": "std:name",
            "¿qué_curso_te_interesa?": "field:curso",
            "comentario": "skip",
          },
        },
      ],
    },
    {
      fields: [
        { name: "nombres", value: "Ana María" },
        { name: "apellidos", value: "Quispe" },
        { name: "¿cuál_es_tu_whatsapp?", value: "+51 999 888 777" },
        { name: "¿qué_curso_te_interesa?", value: "Excel avanzado" },
        { name: "comentario", value: "llamar de tarde" },
        { name: "ciudad", value: "Arequipa" },
      ],
    },
  );
  await t.lead();
  assert.equal(t.recorded[0]?.status, "PROCESSED", "con el teléfono elegido ya no queda pendiente");
  const got = t.ingested[0]!;
  assert.equal(got.name, "Ana María Quispe");
  assert.equal(got.phone, "+51999888777");
  assert.equal(got.fields.curso, "Excel avanzado");
  assert.equal(got.fields.ciudad, "Arequipa", "sin elegir: como siempre");
  assert.equal(Object.values(got.fields).includes("llamar de tarde"), false, "«No guardar»");

  // Sin reglas, lo de siempre: el teléfono estándar y lo demás como dato.
  const plain = mapMetaLeadFields([
    { name: "phone_number", value: "+51999888777" },
    { name: "full_name", value: "Ana" },
    { name: "¿qué_curso_te_interesa?", value: "Excel" },
  ]);
  assert.deepEqual(plain, { name: "Ana", phone: "+51999888777", email: null, extra: { "¿qué_curso_te_interesa?": "Excel" } });
});

test("un formulario sin regla entra o espera según la política de la página para los nuevos", async () => {
  const waits = setup({ ...PAGE, createDeal: false, dealStageId: null, formRules: [], newFormsEnter: false }, { formId: "f-nuevo" });
  await waits.lead();
  assert.equal(waits.recorded.length, 0, "«esperan a que los actives»: ni se guarda");

  const listed = setup(
    { ...PAGE, createDeal: false, dealStageId: null, formRules: [{ formId: "f-nuevo", formName: "", enabled: true, stage: "page" }], newFormsEnter: false },
    { formId: "f-nuevo" },
  );
  await listed.lead();
  assert.equal(listed.recorded[0]?.status, "PROCESSED", "con regla activa entra aunque la página deje esperar a los nuevos");

  const enters = setup({ ...PAGE, createDeal: false, dealStageId: null, formRules: [], newFormsEnter: true }, { formId: "f-nuevo" });
  await enters.lead();
  assert.equal(enters.recorded[0]?.status, "PROCESSED", "«entran solos», como siempre");
});

test("un lead importado conserva su fecha, no manda la bienvenida ni despierta flujos; la oportunidad sí se crea", async () => {
  const t = setup({ ...PAGE, createDeal: true, dealStageId: "nuevo", welcomeTemplateId: "tpl1", formRules: [] });
  await t.lead({ backfill: true, createdTime: "2026-10-01T10:00:00+0000" });
  assert.equal(t.recorded[0]?.status, "PROCESSED");
  assert.equal(t.recorded[0]?.createdAt?.toISOString(), "2026-10-01T10:00:00.000Z", "la fecha de Meta, con su «+0000»");
  assert.deepEqual(t.welcomes, [], "sin plantilla de bienvenida");
  assert.equal(t.ingestedOpts[0]?.silent, true, "LeadService no despierta los flujos");
  assert.deepEqual(t.deals.map((d) => d.stageId), ["nuevo"]);
  assert.ok(!t.emitted.some((e) => e.name === "deal.stage_changed"), "sin automatizaciones de etapa ni conversiones");
  assert.ok(t.emitted.some((e) => e.name === "pipeline.changed"), "el tablero sí se entera");

  const live = setup({ ...PAGE, createDeal: false, dealStageId: null, welcomeTemplateId: "tpl1", formRules: [] });
  await live.lead();
  assert.deepEqual(live.welcomes, ["tpl1"], "uno recién llegado sí recibe la bienvenida");
  assert.equal(live.ingestedOpts[0]?.silent, false);
  assert.equal(live.recorded[0]?.createdAt, undefined, "y lleva la fecha de ahora");
});

test("reprocesar un lead pendiente con el mapeo corregido crea el contacto en silencio; uno que falló se vuelve a leer en Meta", async () => {
  const pending = {
    id: "ml1",
    leadgenId: "lg-old",
    pageId: "p1",
    formId: "f-cursos",
    formName: "Cursos",
    status: "NO_PHONE",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    phone: null,
    name: "Ana",
    email: null,
    adName: null,
    campaignName: null,
    platform: null,
    fieldData: [
      { name: "full_name", value: "Ana" },
      { name: "¿cuál_es_tu_whatsapp?", value: "+51 999 888 777" },
    ],
  };
  const t = setup(
    { ...PAGE, createDeal: false, dealStageId: null, welcomeTemplateId: "tpl1", formRules: [{ formId: "f-cursos", formName: "Cursos", fieldMap: { "¿cuál_es_tu_whatsapp?": "std:phone" } }] },
    { storedLead: pending },
  );
  const dto = await t.svc.reprocessLead("ml1");
  assert.equal(dto.status, "PROCESSED");
  assert.equal(dto.phone, "+51999888777");
  assert.equal(dto.contactId, "ct1");
  assert.equal(t.ingested[0]?.phone, "+51999888777");
  assert.equal(t.ingestedOpts[0]?.silent, true);
  assert.deepEqual(t.welcomes, [], "no se le escribe: puede ser de hace semanas");

  // Sin teléfono por ningún lado sigue pendiente, pero con los datos al día.
  const still = setup(
    { ...PAGE, createDeal: false, dealStageId: null, formRules: [] },
    { storedLead: { ...pending, status: "NO_PHONE", phone: null, contactId: null, fieldData: [{ name: "full_name", value: "Ana B" }] } },
  );
  const dto2 = await still.svc.reprocessLead("ml1");
  assert.equal(dto2.status, "NO_PHONE");
  assert.equal(dto2.name, "Ana B");
  assert.equal(still.ingested.length, 0);

  // Uno que falló al leerse no tiene respuestas guardadas: se piden a Meta otra vez.
  const failed = setup(
    { ...PAGE, createDeal: false, dealStageId: null, formRules: [] },
    { storedLead: { ...pending, status: "ERROR", error: "token caducado", fieldData: [] }, fields: [{ name: "full_name", value: "Luis" }, { name: "phone_number", value: "+51911111111" }] },
  );
  const dto3 = await failed.svc.reprocessLead("ml1");
  assert.equal(dto3.status, "PROCESSED");
  assert.equal(dto3.error, null);
  assert.equal(failed.ingested[0]?.phone, "+51911111111");

  // Un formulario apagado no se reprocesa.
  const off = setup({ ...PAGE, createDeal: false, dealStageId: null, formRules: [{ formId: "f-cursos", formName: "", enabled: false }] }, { storedLead: { ...pending } });
  await assert.rejects(off.svc.reprocessLead("ml1"), /apagado/);
});

test("al conectar se eligen los formularios: los no marcados quedan apagados y se guarda qué pasa con los nuevos", async () => {
  const saved: Array<Record<string, unknown>> = [];
  const prisma = {
    metaPage: {
      findMany: async () => [],
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => ({ id: "mp1", ...create, formRules: null }),
      update: async ({ data }: { data: Record<string, unknown> }) => void saved.push(data),
    },
    metaLead: { groupBy: async () => [] },
  };
  const forms: Array<{ id: string; name: string; status: string }> | null = [
    { id: "f1", name: "Cursos", status: "ACTIVE" },
    { id: "f2", name: "Promo", status: "ACTIVE" },
    { id: "f3", name: "Viejo", status: "ARCHIVED" },
  ];
  const graph = (listed: typeof forms) => ({
    tokenFromLogin: async () => "user-token",
    listPages: async () => [{ pageId: "p1", name: "Mi página", accessToken: "tok" }],
    listForms: async () => listed,
    subscribePage: async () => undefined,
  });
  const tenant = { orgId: () => "org1" };
  const svc = new MetaPageService(prisma as never, tenant as never, graph(forms) as never, {} as never);
  const { sessionId } = await svc.available({ accessToken: "x" });
  const step = await svc.sessionForms(sessionId, ["p1"]);
  assert.equal(step.pages[0]!.fromMeta, true);
  assert.deepEqual(
    step.pages[0]!.forms.map((f) => [f.formId, f.enabled]),
    [["f1", true], ["f2", true], ["f3", false]],
    "los activos salen marcados, los archivados no",
  );
  await svc.connect(sessionId, ["p1"], undefined, [{ pageId: "p1", formIds: ["f1"] }], false);
  const rules = saved[0]!.formRules as MetaFormRule[];
  assert.deepEqual(rules.map((r) => [r.formId, r.enabled]), [["f1", true], ["f2", false], ["f3", false]]);
  assert.equal(rules[0]!.stage, "page", "lo demás, como la página");
  assert.equal(saved[0]!.newFormsEnter, false);

  // Si Meta no deja listar los formularios no hay qué apagar: la página entra con todos.
  const denied = new MetaPageService(prisma as never, tenant as never, graph(null) as never, {} as never);
  const s2 = await denied.available({ accessToken: "x" });
  const step2 = await denied.sessionForms(s2.sessionId, ["p1"]);
  assert.equal(step2.pages[0]!.fromMeta, false);
  await denied.connect(s2.sessionId, ["p1"], undefined, [{ pageId: "p1", formIds: [] }], false);
  assert.equal(saved.length, 1, "no se guardan reglas ni la política");

  // En la lista, un formulario sin regla sigue la política de la página.
  const waiting = new MetaPageService(
    { metaPage: { findUnique: async () => ({ id: "mp1", pageId: "p1", accessToken: "tok", formRules: [], newFormsEnter: false }) }, metaLead: { groupBy: async () => [] } } as never,
    tenant as never,
    graph(forms) as never,
    {} as never,
  );
  const listed = await waiting.forms("mp1");
  assert.deepEqual(listed.forms.map((f) => f.enabled), [false, false, false], "«esperan a que los actives»");
});

test("importar los leads anteriores encola solo los que no están, marcados como importados", async () => {
  const jobs: Array<{ data: { leadgenId: string; backfill?: boolean }; opts: { jobId: string } }> = [];
  const page = { id: "mp1", pageId: "p1", name: "Mi página", accessToken: "tok", formRules: [], newFormsEnter: true };
  const prisma = {
    metaPage: { findUnique: async () => page },
    metaLead: {
      findMany: async ({ where }: { where: { leadgenId: { in: string[] } } }) => where.leadgenId.in.filter((id) => id === "l2").map((leadgenId) => ({ leadgenId })),
    },
  };
  const graph = {
    listFormLeads: async () => [
      { id: "l1", createdTime: "2026-10-01T10:00:00+0000" },
      { id: "l2", createdTime: null },
      { id: "l3", createdTime: null },
    ],
  };
  const queue = { addBulk: async (j: typeof jobs) => void jobs.push(...j) };
  const svc = new MetaPageService(prisma as never, {} as never, graph as never, queue as never);
  assert.deepEqual(await svc.importForm("mp1", "123"), { found: 3, queued: 2, skipped: 1 });
  assert.deepEqual(jobs.map((j) => j.data.leadgenId), ["l1", "l3"]);
  assert.equal(jobs[0]!.data.backfill, true);
  assert.equal(jobs[0]!.opts.jobId, "lead-l1", "el mismo id que el webhook: no entra dos veces");

  const off = new MetaPageService(
    { metaPage: { findUnique: async () => ({ ...page, formRules: [{ formId: "123", formName: "", enabled: false }] }) } } as never,
    {} as never,
    graph as never,
    queue as never,
  );
  await assert.rejects(off.importForm("mp1", "123"), /apagado/);
  await assert.rejects(svc.importForm("mp1", "../me"), /no válido/);
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

test("las preguntas del formulario: las de Meta con su ejemplo, más las que llegaron en leads", async () => {
  const prisma = {
    metaPage: { findUnique: async () => ({ id: "mp1", pageId: "p1", accessToken: "tok" }) },
    metaLead: {
      findMany: async () => [
        { fieldData: [{ name: "full_name", value: "Ana" }, { name: "ciudad", value: "Cusco" }] },
        { fieldData: [{ name: "full_name", value: "Luis" }, { name: "¿qué_curso?", value: "Excel" }] },
      ],
    },
  };
  const svc = new MetaPageService(prisma as never, {} as never, {
    getFormQuestions: async () => [
      { key: "full_name", label: "Nombre completo" },
      { key: "¿qué_curso?", label: "¿Qué curso te interesa?" },
    ],
  } as never);
  const r = await svc.questions("mp1", "123456");
  assert.equal(r.fromMeta, true);
  assert.deepEqual(r.questions, [
    { key: "full_name", label: "Nombre completo", sample: "Ana", type: null, options: [] },
    { key: "¿qué_curso?", label: "¿Qué curso te interesa?", sample: "Excel", type: null, options: [] },
    { key: "ciudad", label: "Ciudad", sample: "Cusco", type: null, options: [] },
  ]);
  assert.deepEqual(r.sampleLead, [{ name: "full_name", value: "Ana" }, { name: "ciudad", value: "Cusco" }], "el último lead, para la vista previa");
  await assert.rejects(svc.questions("mp1", "../me"), /no válido/, "el id va dentro de la URL de Meta");
});
