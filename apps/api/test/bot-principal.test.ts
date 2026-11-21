/**
 * El agente principal: el que contesta en los números de WhatsApp que no
 * tienen un agente propio. Elegir «Todos los números sin agente propio» en un
 * agente lo hace principal y se lo quita al anterior; el principal no se queda
 * sin serlo si nadie lo releva. Sin base de datos: un doble de Prisma.
 *
 *   npm run test:botprincipal --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createBotSchema, updateBotSchema } from "@crm/shared";
import { BotService } from "../src/modules/ai/bot.service";

type Row = Record<string, any>;

function agent(id: string, extra: Row = {}): Row {
  return {
    id,
    orgId: "o1",
    name: id,
    model: "gpt-4.1-mini",
    effort: "medium",
    systemPrompt: `Eres ${id}.`,
    enabledTools: [],
    maxIterations: 6,
    escalationRules: {},
    monthlyTokenBudget: 0,
    isDefault: false,
    isActive: true,
    channelId: null,
    autopilotByDefault: false,
    replyDelaySec: 4,
    splitReplies: false,
    welcomeEnabled: false,
    welcomeMessage: null,
    businessHoursEnabled: false,
    businessHours: null,
    keywordTriggers: [],
    followUps: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    ...extra,
  };
}

/** Lo justo de Prisma para crear, editar y borrar agentes, con el índice «un principal por empresa». */
function fakePrisma(rows: Row[]) {
  const matches = (r: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "not" in v ? r[k] !== v.not : r[k] === v));
  const checkOnePrincipal = () => {
    const orgs = rows.filter((r) => r.isDefault).map((r) => r.orgId);
    if (new Set(orgs).size !== orgs.length) throw new Error("Unique constraint failed: dos agentes principales en la misma empresa");
  };
  const withChannel = (r: Row) => ({ ...r, channel: null });
  const agentConfig = {
    findUnique: async ({ where }: Row) => rows.find((r) => r.id === where.id) ?? null,
    findFirst: async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: Row) => {
      const r = agent(`a${rows.length + 1}`, data);
      rows.push(r);
      checkOnePrincipal();
      return withChannel(r);
    },
    update: async ({ where, data }: Row) => {
      const r = rows.find((x) => x.id === where.id);
      if (!r) throw new Error("no existe");
      Object.assign(r, data);
      checkOnePrincipal();
      return withChannel(r);
    },
    updateMany: async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      checkOnePrincipal();
      return { count: hit.length };
    },
    delete: async ({ where }: Row) => {
      const i = rows.findIndex((r) => r.id === where.id);
      return rows.splice(i, 1)[0];
    },
  };
  return {
    agentConfig,
    // En orden, como Prisma con una lista de operaciones.
    $transaction: async (ops: Promise<unknown>[]) => {
      const out = [];
      for (const op of ops) out.push(await op);
      return out;
    },
  };
}

function service(rows: Row[]) {
  return new BotService(fakePrisma(rows) as any, { orgId: () => "o1" } as any, {} as any);
}

const principals = (rows: Row[]) => rows.filter((r) => r.isDefault).map((r) => r.id);

test("elegir «Todos los números» en otro agente lo hace principal y se lo quita al anterior", async () => {
  const rows = [agent("viejo", { isDefault: true }), agent("lia")];
  const bot = await service(rows).update("lia", updateBotSchema.parse({ isDefault: true, channelId: null }));
  assert.equal(bot.isDefault, true);
  assert.deepEqual(principals(rows), ["lia"], "queda un solo principal");
  assert.equal(rows[0]!.channelId, null, "el anterior se queda sin número");
});

test("el anterior principal con número propio lo conserva al dejar de ser principal", async () => {
  const rows = [agent("viejo", { isDefault: true, channelId: "ch1" }), agent("lia")];
  await service(rows).update("lia", updateBotSchema.parse({ isDefault: true }));
  assert.deepEqual(principals(rows), ["lia"]);
  assert.equal(rows[0]!.channelId, "ch1");
});

test("crear un agente con «Todos los números» lo deja de principal", async () => {
  const rows = [agent("viejo", { isDefault: true })];
  const bot = await service(rows).create(createBotSchema.parse({ name: "Lia", systemPrompt: "Eres Lia.", isDefault: true }));
  assert.equal(bot.isDefault, true);
  assert.deepEqual(principals(rows), [bot.id]);
});

test("un agente nuevo, sin decir nada, no es principal", async () => {
  const rows = [agent("viejo", { isDefault: true })];
  const bot = await service(rows).create(createBotSchema.parse({ name: "Lia", systemPrompt: "Eres Lia." }));
  assert.equal(bot.isDefault, false);
  assert.deepEqual(principals(rows), ["viejo"]);
});

test("el principal no deja de serlo si nadie lo releva", async () => {
  const rows = [agent("viejo", { isDefault: true }), agent("lia")];
  await assert.rejects(
    service(rows).update("viejo", updateBotSchema.parse({ isDefault: false })),
    (e: any) => e.status === 400 && /Todos los números sin agente propio/.test(e.message) && /otro agente/.test(e.message),
  );
  assert.deepEqual(principals(rows), ["viejo"]);
});

test("«no es principal» sobre otro agente, o «es principal» sobre el que ya lo es, no cambia nada", async () => {
  const rows = [agent("viejo", { isDefault: true }), agent("lia")];
  const svc = service(rows);
  await svc.update("lia", updateBotSchema.parse({ isDefault: false, name: "Lia" }));
  await svc.update("viejo", updateBotSchema.parse({ isDefault: true, name: "Viejo" }));
  assert.deepEqual(principals(rows), ["viejo"]);
  assert.equal(rows[1]!.name, "Lia", "lo demás se guarda igual");
});

test("borrar el principal se rechaza y dice cómo cambiarlo", async () => {
  const rows = [agent("viejo", { isDefault: true })];
  await assert.rejects(service(rows).remove("viejo"), (e: any) => e.status === 400 && /Todos los números sin agente propio/.test(e.message));
  assert.equal(rows.length, 1);
});
