/**
 * El agente lee lo que ya mandó la automatización (la bienvenida de un
 * formulario, una difusión, un flujo) y no presenta lo mismo otra vez. Lo que
 * no llegó (fallido) no cuenta como dicho. Sin base de datos ni modelo: dobles.
 *
 *   npm run test:agenthistory --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_SENT_RULE, HISTORY_MAX, openHistory, repliedToAutomatic } from "../src/modules/ai/agent-history";
import { AgentService } from "../src/modules/ai/agent.service";

type Row = Record<string, unknown>;
const tpl = (content: string, o: Row = {}): Row => ({ direction: "OUTBOUND", type: "TEMPLATE", author: "AI", content, templateId: "t1", aiRunId: null, status: "DELIVERED", ...o });
const inb = (content: string): Row => ({ direction: "INBOUND", type: "TEXT", author: "CONTACT", content, templateId: null, aiRunId: null, status: "DELIVERED" });
const ai = (content: string): Row => ({ direction: "OUTBOUND", type: "TEXT", author: "AI", content, templateId: null, aiRunId: "run1", status: "READ" });
const flow = (content: string): Row => ({ ...ai(content), aiRunId: null });
const human = (content: string): Row => ({ ...ai(content), author: "HUMAN", aiRunId: null });
const PITCH = "Hola Ana, Power BI cuesta S/ 249 y empieza el 30 de noviembre.";

function agent(rows: Row[]) {
  let asked: { where?: Row; take?: number } = {};
  const svc = Object.create(AgentService.prototype) as Record<string, unknown>;
  svc.prisma = {
    conversation: { findUnique: async () => ({ contactId: "c1" }) },
    message: { findMany: async (a: typeof asked) => ((asked = a), [...rows].reverse().slice(0, a.take)) },
  };
  const load = () => (svc as unknown as { loadHistory(id: string): Promise<{ messages: { role: string; content: string }[]; autoSent: boolean }> }).loadHistory("cv1");
  return { load, asked: () => asked };
}

test("la bienvenida del formulario entra en lo que lee el agente (antes se borraba)", async () => {
  const { messages, autoSent } = await agent([tpl(PITCH), inb("Sí, me interesa")]).load();
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(messages[1]!.content, PITCH);
  assert.match(messages[0]!.content, /todavía no había escrito/);
  assert.equal(messages[2]!.content, "Sí, me interesa");
  assert.equal(autoSent, true);
});

test("varios mensajes seguidos de un flujo, en su orden", async () => {
  const { messages } = await agent([tpl(PITCH), flow("Te dejo el temario"), inb("ok")]).load();
  assert.deepEqual(messages.slice(1).map((m) => m.content), [PITCH, "Te dejo el temario", "ok"]);
});

test("un envío fallido no cuenta como dicho: el cliente no lo recibió", async () => {
  const a = agent([inb("Hola")]);
  await a.load();
  assert.deepEqual(a.asked().where?.NOT, { direction: "OUTBOUND", status: "FAILED" });
});

test("una conversación que empezó el cliente queda igual", async () => {
  const { messages, autoSent } = await agent([inb("Hola"), ai("¿Qué curso buscas?"), inb("Power BI")]).load();
  assert.deepEqual(messages, [
    { role: "user", content: "Hola" },
    { role: "assistant", content: "¿Qué curso buscas?" },
    { role: "user", content: "Power BI" },
  ]);
  assert.equal(autoSent, false);
});

test("recortada a los últimos mensajes: lo primero no es el principio", async () => {
  const rows = [tpl(PITCH), ...Array.from({ length: HISTORY_MAX }, (_, i) => (i % 2 ? inb(`m${i}`) : ai(`r${i}`)))];
  const { messages } = await agent(rows).load();
  assert.equal(messages[0]!.role, "user");
  assert.doesNotMatch(messages[0]!.content, /todavía no había escrito/);
  assert.deepEqual(openHistory([], false).messages, [{ role: "user", content: "(el contacto inició la conversación)" }]);
});

test("qué cuenta como automático: plantillas y flujos, no lo que redacta el agente ni una persona", () => {
  const cast = (rows: Row[]) => repliedToAutomatic(rows as never);
  assert.equal(cast([inb("Hola"), ai("Info"), tpl(PITCH), inb("Sí")]), true, "una difusión a mitad de la relación");
  assert.equal(cast([inb("Hola"), flow("Menú: 1) Cursos"), inb("1")]), true);
  assert.equal(cast([tpl(PITCH), inb("Sí"), ai("¿Te separo un cupo?"), inb("dale")]), false, "ya contestó al agente");
  assert.equal(cast([inb("Hola"), human("¿En qué te ayudo?"), inb("precio")]), false);
  assert.equal(cast([inb("Hola")]), false);
  assert.equal(cast([tpl(PITCH)]), false, "todavía no contestó");
  assert.equal(cast([tpl(PITCH), inb("Hola"), inb("¿precio?")]), true, "varios mensajes seguidos del cliente");
  // La foto, el archivo y los datos de pago que manda el agente no llevan su ejecución.
  const photo = { ...flow(""), type: "IMAGE" };
  assert.equal(cast([inb("info"), ai("Power BI cuesta S/ 249"), photo, inb("ok")]), false, "su foto va con su respuesta");
  assert.equal(cast([inb("info"), photo, ai("Power BI cuesta S/ 249"), inb("ok")]), false);
  assert.equal(cast([inb("info"), ai("Te aviso"), tpl(PITCH), inb("ok")]), true, "una difusión después de su respuesta");
  assert.equal(cast([inb("info"), human("Te aviso"), flow("Seguimos aquí"), inb("ok")]), false, "ya contestó una persona");
});

test("el probador sigue la misma regla que un chat real", async () => {
  const seen: { autoSent?: boolean; messages?: { role: string; content: string }[] } = {};
  const svc = Object.create(AgentService.prototype) as Record<string, unknown>;
  const none = { findMany: async () => [] };
  Object.assign(svc, {
    prisma: { agentConfig: { findUnique: async () => null }, productField: none, customField: none },
    bots: { resolveForChannel: async () => null },
    actions: { loadContext: async () => ({}) },
    bookingContext: async () => "",
    buildSystemParts: (_p: string, _c: unknown, _t: string[], _s: boolean, extra: { autoSent?: boolean }) => ((seen.autoSent = extra.autoSent), { system: "s", systemDynamic: "" }),
    llm: { generate: async (a: { messages: typeof seen.messages }) => { seen.messages = a.messages; throw new Error("basta"); } },
  });
  const run = (history: unknown[], message = "Sí, me interesa") => (svc as unknown as AgentService).playground({ message, history } as never).catch(() => undefined);
  await run([{ role: "assistant", content: PITCH }]);
  assert.equal(seen.autoSent, true);
  assert.equal(seen.messages?.[1]?.content, PITCH);
  await run([{ role: "user", content: "Hola" }, { role: "assistant", content: "¿Qué curso?" }]);
  assert.equal(seen.autoSent, false);
  await run([]);
  assert.equal(seen.autoSent, false);
});

test("al agente se le dice que no lo repita, solo cuando toca", () => {
  const svc = Object.create(AgentService.prototype) as unknown as { buildSystemParts(p: string, c: unknown, t: string[], s: boolean, e: unknown): { system: string; systemDynamic: string } };
  const contact = { name: "Ana", phone: "+51987654321" };
  const on = svc.buildSystemParts("Eres Lia.", contact, [], false, { autoSent: true });
  const off = svc.buildSystemParts("Eres Lia.", contact, [], false, {});
  assert.ok(on.systemDynamic.includes(AUTO_SENT_RULE));
  assert.ok(!off.systemDynamic.includes("Ya se le envió"));
  assert.equal(on.system, off.system, "la parte fija no cambia: no rompe la caché");
});
