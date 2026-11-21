/**
 * Entrada de leads (webhook, API, formularios de Meta): qué queda en el
 * contacto. Los utm_* son la campaña que lo trajo; el resto, datos del negocio.
 * Base de datos simulada.
 *
 *   npm run test:leadingest --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LeadService } from "../src/modules/leads/lead.service";

type Row = { id: string; phone: string; name: string | null; metadata: Record<string, string> };

function setup(defs: Array<{ key: string; label: string }> = []) {
  const contacts = new Map<string, Row>();
  let seq = 0;
  const prisma = {
    contact: {
      findFirst: async ({ where }: { where: { phone: string | { in: string[] } } }) =>
        typeof where.phone === "string"
          ? (contacts.get(where.phone) ?? null)
          : (where.phone.in.map((p) => contacts.get(p)).find(Boolean) ?? null),
      upsert: async ({ where, create, update }: { where: { orgId_phone: { phone: string } }; create: Omit<Row, "id">; update: Partial<Row> }) => {
        const row = contacts.get(where.orgId_phone.phone);
        if (row) return Object.assign(row, update);
        const made = { id: `ct${++seq}`, ...create };
        contacts.set(made.phone, made);
        return made;
      },
    },
    source: { upsert: async () => ({ id: "src1" }) },
    customField: { findMany: async () => defs },
    tag: { upsert: async () => ({ id: "t1", name: "t" }) },
    contactTag: { create: async () => ({}) },
  };
  const svc = new LeadService(prisma as never, { orgId: () => "org1" } as never, { emit: () => true } as never);
  return { svc, contacts };
}

test("los utm_* de un lead quedan como la campaña del contacto, lleguen escritos como lleguen", async () => {
  const t = setup([{ key: "curso", label: "Curso de interés" }]);
  await t.svc.ingestLead({
    phone: "+51999888777",
    name: "Ana",
    // Así los escribe quien arma el formulario en Meta: mayúsculas, espacios, guiones.
    fields: { UTM_Source: "facebook", "utm campaign": "cursos_nov", "Utm-Medium": "paid_social", "Curso de interés": "Excel" },
  });
  const meta = t.contacts.get("+51999888777")!.metadata;
  assert.equal(meta.utm_source, "facebook");
  assert.equal(meta.utm_campaign, "cursos_nov");
  assert.equal(meta.utm_medium, "paid_social");
  assert.equal(meta.curso, "Excel", "y los datos del negocio van a su campo");
});

test("otro lead de la misma persona no mezcla dos campañas: se queda la que la trajo primero", async () => {
  const t = setup();
  await t.svc.ingestLead({
    phone: "+51999888777",
    name: "Ana",
    fields: { utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "cursos_nov", utm_content: "video_testimonio", formulario: "Cursos" },
  });
  await t.svc.ingestLead({
    phone: "+51999888777",
    fields: { utm_source: "instagram", utm_campaign: "remarketing", formulario: "Remarketing", ciudad: "Lima" },
  });
  const meta = t.contacts.get("+51999888777")!.metadata;
  assert.deepEqual(
    [meta.utm_source, meta.utm_medium, meta.utm_campaign, meta.utm_content],
    ["facebook", "paid_social", "cursos_nov", "video_testimonio"],
    "ni «instagram + paid_social», una campaña que nunca existió",
  );
  assert.equal(meta.formulario, "Remarketing", "los demás datos sí se actualizan");
  assert.equal(meta.ciudad, "Lima");

  // Sin campaña previa, la del lead entra entera.
  const fresh = setup();
  await fresh.svc.ingestLead({ phone: "+51911111111", fields: { ciudad: "Cusco" } });
  await fresh.svc.ingestLead({ phone: "+51911111111", fields: { utm_source: "instagram", utm_campaign: "remarketing" } });
  const later = fresh.contacts.get("+51911111111")!.metadata;
  assert.deepEqual([later.utm_source, later.utm_campaign, later.ciudad], ["instagram", "remarketing", "Cusco"]);
});
