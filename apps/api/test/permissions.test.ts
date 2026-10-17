/**
 * Permisos por usuario: valores por defecto, plantillas, alcance de consultas
 * y comprobaciones. Base de datos simulada.
 *
 *   npm run test:permissions --workspace=apps/api
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";

let shared: typeof import("@crm/shared");
let PermissionsService: typeof import("../src/modules/permissions/permissions.service").PermissionsService;

before(async () => {
  shared = await import("@crm/shared");
  ({ PermissionsService } = await import("../src/modules/permissions/permissions.service"));
});

function service(user: { role: string; permissions?: unknown; sources?: string[] }, conversations: Array<{ id: string; assignedAgentId: string | null; sourceId: string | null }> = []) {
  const prisma = {
    user: { findUnique: async () => ({ role: user.role, permissions: user.permissions ?? null, sources: (user.sources ?? []).map((sourceId) => ({ sourceId })) }) },
    conversation: {
      findFirst: async ({ where }: { where: { id: string; assignedAgentId?: string; contact?: { sourceId: { in: string[] } } } }) => {
        const c = conversations.find((x) => x.id === where.id);
        if (!c) return null;
        if (where.assignedAgentId && c.assignedAgentId !== where.assignedAgentId) return null;
        if (where.contact && !where.contact.sourceId.in.includes(c.sourceId ?? "")) return null;
        return { id: c.id };
      },
      findUnique: async ({ where }: { where: { id: string } }) => (conversations.some((x) => x.id === where.id) ? { id: where.id } : null),
    },
    message: { findUnique: async () => ({ conversationId: "c1" }) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PermissionsService(prisma as any);
}

test("permisos en vigor: admin todo; vendedor sin guardar, lo de siempre; parcial se completa", () => {
  const { effectivePermissions, FULL_PERMISSIONS, DEFAULT_AGENT_PERMISSIONS, PERMISSION_PRESETS } = shared;
  assert.deepEqual(effectivePermissions("ADMIN", { scope: "assigned" }), FULL_PERMISSIONS);
  assert.deepEqual(effectivePermissions("AGENT", null), DEFAULT_AGENT_PERMISSIONS);
  const parcial = effectivePermissions("AGENT", { scope: "assigned", actions: { seePhone: false } });
  assert.equal(parcial.scope, "assigned");
  assert.equal(parcial.actions.seePhone, false);
  assert.equal(parcial.actions.reassign, true, "lo que no se dice, por defecto");
  assert.equal(parcial.sections.dashboard, true);
  assert.equal(effectivePermissions("AGENT", { scope: "lo-que-sea" }).scope, "sources", "un alcance raro cae en fuentes");
  assert.equal(PERMISSION_PRESETS.seller.permissions.actions.reassign, false);
  assert.equal(PERMISSION_PRESETS.supervisor.permissions.scope, "all");
});

test("el teléfono enmascarado deja país y final, nada marcable", () => {
  const { maskPhone } = shared;
  assert.equal(maskPhone("+51977060001"), "+51••••••001");
  assert.equal(maskPhone("+1 555 678 0957"), "+15••••••957", "los espacios no cuentan");
  assert.equal(maskPhone("12345"), "1••••");
});

test("alcance: todos, sus fuentes o lo asignado, en conversaciones y contactos", async () => {
  const todo = service({ role: "AGENT", permissions: { scope: "all" } });
  assert.equal(await todo.conversationWhere("u1"), null);
  assert.equal(await todo.contactWhere("u1"), null);

  const fuentes = service({ role: "AGENT", permissions: { scope: "sources" }, sources: ["s1", "s2"] });
  assert.deepEqual(await fuentes.conversationWhere("u1"), { contact: { sourceId: { in: ["s1", "s2"] } } });
  assert.deepEqual(await fuentes.contactWhere("u1"), { sourceId: { in: ["s1", "s2"] } });

  const asignado = service({ role: "AGENT", permissions: { scope: "assigned" } });
  assert.deepEqual(await asignado.conversationWhere("u1"), { assignedAgentId: "u1" });
  assert.deepEqual(await asignado.contactWhere("u1"), { conversations: { some: { assignedAgentId: "u1" } } });

  const admin = service({ role: "ADMIN" });
  assert.equal(await admin.conversationWhere("u1"), null);
});

test("una conversación fuera del alcance es 403; una inexistente, 404", async () => {
  const convs = [
    { id: "c1", assignedAgentId: "u1", sourceId: "s1" },
    { id: "c2", assignedAgentId: "u2", sourceId: "s9" },
  ];
  const svc = service({ role: "AGENT", permissions: { scope: "assigned" } }, convs);
  await assert.doesNotReject(() => svc.assertConversation("u1", "c1"));
  await assert.rejects(() => svc.assertConversation("u1", "c2"), /no está en tu alcance/);
  await assert.rejects(() => svc.assertConversation("u1", "nope"), /no encontrada/);
  await assert.doesNotReject(() => svc.assertMessageConversation("u1", "m1"), "el mensaje de c1 es suyo");
});

test("acciones y secciones: 403 con un mensaje que dice qué falta", async () => {
  const svc = service({ role: "AGENT", permissions: { actions: { reassign: false }, sections: { dashboard: false } } });
  await assert.rejects(() => svc.assertAction("u1", "reassign"), /Asignar chats a otras personas/i);
  await assert.doesNotReject(() => svc.assertAction("u1", "seePhone"));
  await assert.rejects(() => svc.assertSection("u1", "dashboard"), /panel de métricas/i);
  await assert.doesNotReject(() => svc.assertSection("u1", "pipeline"));
  assert.equal(await svc.canSeePhone("u1"), true);
});
