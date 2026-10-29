/**
 * Planes del SaaS: límites al añadir, características por plan, y que en una
 * instalación propia no hay límites. Base de datos simulada.
 *
 *   npm run test:plans --workspace=apps/api
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";

// El modo se lee al importar el contexto, así que se fija antes y los módulos
// se cargan después (los `import` estáticos se adelantarían a esta línea).
process.env.TENANCY_MODE = "multi";

let shared: typeof import("@crm/shared");
let PlansService: typeof import("../src/modules/plans/plans.service").PlansService;

before(async () => {
  shared = await import("@crm/shared");
  ({ PlansService } = await import("../src/modules/plans/plans.service"));
});

function service(state: { plan: string | null; numbers: number; users: number; contacts?: number; deals?: number; activeContacts?: number }) {
  const prisma = {
    organization: { findUnique: async () => (state.plan === null ? null : { plan: state.plan }) },
    whatsappConnection: { count: async () => state.numbers },
    user: { count: async () => state.users },
    contact: { count: async () => state.contacts ?? 0 },
    deal: { count: async () => state.deals ?? 0 },
    $queryRaw: async () => [{ count: BigInt(state.activeContacts ?? 0) }],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PlansService(prisma as any, { orgId: () => "org_1" } as any);
}

test("el catálogo es coherente: cada plan superior incluye lo del anterior", () => {
  const { PLANS, planFor, planWithFeature, formatPlanPrice } = shared;
  assert.equal(PLANS.free.limits.numbers, 1);
  assert.equal(PLANS.pro.features.coexistence, true);
  assert.equal(PLANS.business.limits.numbers, null, "Empresa no tiene tope de números");
  assert.equal(planWithFeature("coexistence")?.key, "pro");
  assert.equal(planWithFeature("prioritySupport")?.key, "business");
  assert.equal(planFor("desconocido").key, "free", "un plan raro cae en Gratis");
  assert.equal(planFor(null).key, "free");
  assert.equal(formatPlanPrice(PLANS.free), "Sin costo");
  assert.equal(formatPlanPrice(PLANS.pro), "USD 49/mes");
});

test("Gratis: un número, dos usuarios, sin coexistencia", async () => {
  const svc = service({ plan: "free", numbers: 1, users: 2 });
  await assert.rejects(() => svc.assertCanAdd("numbers"), /admite 1 número de WhatsApp/);
  await assert.rejects(() => svc.assertCanAdd("users"), /admite 2 usuarios/);
  await assert.rejects(() => svc.assertFeature("coexistence"), /a partir del plan Pro/);
  await assert.rejects(() => svc.assertFeature("broadcasts"), /Difusiones/);
});

test("por debajo del límite se puede añadir", async () => {
  const svc = service({ plan: "free", numbers: 0, users: 1 });
  await assert.doesNotReject(() => svc.assertCanAdd("numbers"));
  await assert.doesNotReject(() => svc.assertCanAdd("users"));
});

test("Pro incluye coexistencia y difusiones; Empresa no tiene topes", async () => {
  const pro = service({ plan: "pro", numbers: 3, users: 10 });
  await assert.doesNotReject(() => pro.assertFeature("coexistence"));
  await assert.doesNotReject(() => pro.assertFeature("broadcasts"));
  await assert.rejects(() => pro.assertCanAdd("numbers"), /admite 3 números/);
  await assert.rejects(() => pro.assertFeature("prioritySupport"), /Empresa/);

  const business = service({ plan: "business", numbers: 40, users: 200 });
  await assert.doesNotReject(() => business.assertCanAdd("numbers"));
  await assert.doesNotReject(() => business.assertCanAdd("users"));
});

test("contactos y oportunidades: topes blandos que frenan lo manual", async () => {
  const { PLANS, formatPlanLimit } = shared;
  assert.equal(PLANS.free.limits.contacts, 500);
  assert.equal(PLANS.pro.limits.deals, 2000);
  assert.equal(PLANS.business.limits.contacts, null, "Empresa no tiene tope de contactos");
  assert.equal(formatPlanLimit("contacts", 500), "Hasta 500 contactos");
  assert.equal(formatPlanLimit("deals", null), "Oportunidades abiertas sin límite");

  const lleno = service({ plan: "free", numbers: 0, users: 1, contacts: 500, deals: 200 });
  await assert.rejects(() => lleno.assertCanAdd("contacts"), /admite 500 contactos.*escriben por WhatsApp entran igual/);
  await assert.rejects(() => lleno.assertCanAdd("deals"), /admite 200 oportunidades abiertas/);
  const holgado = service({ plan: "free", numbers: 0, users: 1, contacts: 499, deals: 10 });
  await assert.doesNotReject(() => holgado.assertCanAdd("contacts"));
  await assert.doesNotReject(() => holgado.assertCanAdd("deals"));
  const empresa = service({ plan: "business", numbers: 0, users: 1, contacts: 90000, deals: 9000 });
  await assert.doesNotReject(() => empresa.assertCanAdd("contacts"));
});

test("mine() devuelve el plan, el uso y el catálogo", async () => {
  const svc = service({ plan: "pro", numbers: 2, users: 4 });
  const mine = await svc.mine();
  assert.equal(mine.saas, true);
  assert.equal(mine.plan.key, "pro");
  assert.deepEqual(mine.usage, { numbers: 2, users: 4, contacts: 0, deals: 0, activeContacts: 0, aiConversations: 0 });
  assert.deepEqual(
    mine.plans.map((p) => p.key),
    ["free", "pro", "business"],
  );
});

test("contactos activos y retención: orientativos, con sus textos", async () => {
  const { PLANS, SELF_HOSTED_PLAN, formatPlanLimit, formatRetention } = shared;
  assert.equal(PLANS.free.limits.activeContacts, 300);
  assert.equal(PLANS.business.mediaRetentionDays, 1095);
  assert.equal(SELF_HOSTED_PLAN.mediaRetentionDays, null, "en instalación propia no se borra nada");
  // En español los números de cuatro cifras van sin separador (CLDR): "3000", no "3.000".
  assert.equal(formatPlanLimit("activeContacts", 3000), "Hasta 3000 contactos activos al mes");
  assert.equal(formatPlanLimit("activeContacts", 15000), "Hasta 15.000 contactos activos al mes");
  assert.equal(formatRetention(90), "Adjuntos guardados 90 días");
  assert.equal(formatRetention(365), "Adjuntos guardados 1 año");
  assert.equal(formatRetention(1095), "Adjuntos guardados 3 años");
  const svc = service({ plan: "free", numbers: 0, users: 1, activeContacts: 412 });
  assert.equal((await svc.usage()).activeContacts, 412, "los activos del mes salen de la consulta");
});

test("la retención borra solo los adjuntos antiguos del almacén y marca el mensaje", async () => {
  const { MediaRetentionService } = await import("../src/modules/plans/media-retention.service");
  const viejo = new Date(Date.now() - 100 * 86_400_000);
  const nuevo = new Date(Date.now() - 10 * 86_400_000);
  const mensajes = [
    { id: "m1", orgId: "o1", mediaUrl: "storage://a.jpg", mediaPurgedAt: null, createdAt: viejo },
    { id: "m2", orgId: "o1", mediaUrl: "storage://b.ogg", mediaPurgedAt: null, createdAt: nuevo },
    { id: "m3", orgId: "o1", mediaUrl: "https://externo/x.png", mediaPurgedAt: null, createdAt: viejo },
  ];
  const marcados: string[] = [];
  const prisma = {
    organization: { findMany: async () => [{ id: "o1", plan: "free", name: "Uno" }, { id: "o2", plan: "business", name: "Dos" }] },
    message: {
      findMany: async ({ where, take }: { where: { orgId: string; createdAt: { lt: Date } }; take: number }) =>
        mensajes
          .filter((m) => m.orgId === where.orgId && m.mediaUrl.startsWith("storage://") && !marcados.includes(m.id) && m.createdAt < where.createdAt.lt)
          .slice(0, take)
          .map((m) => ({ id: m.id, mediaUrl: m.mediaUrl })),
      updateMany: async ({ where }: { where: { id: { in: string[] } } }) => { marcados.push(...where.id.in); return { count: where.id.in.length }; },
    },
  };
  const borrados: string[] = [];
  const storage = { remove: async (id: string) => { borrados.push(id); } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new MediaRetentionService(prisma as any, storage as any);
  const n = await svc.sweep();
  assert.equal(n, 1, "solo el adjunto de más de 90 días del plan Gratis");
  assert.deepEqual(borrados, ["a.jpg"]);
  assert.deepEqual(marcados, ["m1"]);
});
