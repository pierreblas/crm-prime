/**
 * Cuándo arranca un flujo por palabra clave y qué pasa con el que ya estaba a
 * medias. Corre el motor de verdad sobre una base y una mensajería de mentira.
 *
 *   npm run test:flowtriggers --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { FlowEngineService } from "../src/modules/ai/flow-engine.service";

type Msg = { id: string; conversationId: string; direction: string; type: string; content: string | null; transcript: null; buttonPayload: string | null; referral: null; createdAt: Date };
type Session = { id: string; conversationId: string; flowId: string; currentNodeId: string | null; variables: Record<string, string>; status: string; startedAt: Date | null; createdAt: Date; updatedAt: Date };

const CONV = "cv1";
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, sourceHandle: sourceHandle ?? null });
const trigger = (type: string, keywords: string[] = []) => [{ id: "t1", type, keywords }];

const FLOWS = [
  {
    id: "info",
    name: "Información",
    triggers: trigger("keyword", ["información"]),
    nodes: [node("s", "start"), node("m", "sendMessage", { text: "Te paso la información" })],
    edges: [edge("s", "m")],
  },
  {
    id: "welcome",
    name: "Bienvenida",
    triggers: trigger("conversation_start"),
    nodes: [
      node("s", "start"),
      node("b", "buttons", { text: "¿Qué buscas?", buttons: [{ id: "b1", title: "Sí" }, { id: "b2", title: "Ver catálogo" }] }),
      node("yes", "sendMessage", { text: "Genial" }),
      node("cat", "sendMessage", { text: "Catálogo" }),
    ],
    // Sin «otra respuesta»: lo que no sea un botón no tiene a dónde ir.
    edges: [edge("s", "b"), edge("b", "yes", "b1"), edge("b", "cat", "b2")],
  },
  {
    id: "survey",
    name: "Encuesta",
    triggers: trigger("keyword", ["encuesta"]),
    nodes: [node("s", "start"), node("q", "askQuestion", { text: "¿Del 1 al 5?", variable: "nota" }), node("m", "sendMessage", { text: "Gracias: {{nota}}" })],
    edges: [edge("s", "q"), edge("q", "m")],
  },
  {
    id: "pause",
    name: "Recordatorio",
    triggers: trigger("keyword", ["recordar"]),
    nodes: [node("s", "start"), node("a", "sendMessage", { text: "Te escribo en un rato" }), node("d", "delay", { delayValue: 30, delayUnit: "minutes" }), node("b", "sendMessage", { text: "¿Seguimos?" })],
    edges: [edge("s", "a"), edge("a", "d"), edge("d", "b")],
  },
  {
    id: "menu",
    name: "Menú",
    triggers: trigger("keyword", ["menu"]),
    nodes: [node("s", "start"), node("b", "buttons", { text: "¿Qué necesitas?", buttons: [{ id: "p1", title: "Precios" }] }), node("p", "sendMessage", { text: "Lista de precios" })],
    edges: [edge("s", "b"), edge("b", "p", "p1")],
  },
].map((f) => ({ ...f, isActive: true, channelId: null, updatedAt: new Date() }));

function setup() {
  const messages: Msg[] = [];
  const sessions = new Map<string, Session>();
  const sent: string[] = [];
  const jobs: Array<{ name: string; data: { conversationId: string; run?: string } }> = [];
  let seq = 0;
  const contact = { id: "ct1", orgId: "org1", phone: "+51999999999", name: "Ana", optIn: true, sourceId: null, metadata: null, tags: [] };
  const convo = { id: CONV, orgId: "org1", contactId: contact.id, channelId: null, status: "OPEN", referral: null, assignedAgentId: null, aiMode: "OFF", updatedAt: new Date() };
  const lastOf = (where: { conversationId: string; direction?: string }) =>
    messages.filter((m) => m.conversationId === where.conversationId && (!where.direction || m.direction === where.direction)).at(-1) ?? null;

  const prisma = {
    conversation: {
      findUnique: async () => ({ ...convo, contact }),
      findFirst: async () => ({ id: convo.id, channelId: null }),
    },
    contact: { findUnique: async () => contact },
    deal: { findFirst: async () => null },
    message: {
      findFirst: async ({ where }: { where: { conversationId: string; direction?: string; id?: string } }) =>
        where.id ? (messages.find((m) => m.id === where.id && m.conversationId === where.conversationId) ?? null) : lastOf(where),
      count: async ({ where }: { where: { conversationId: string; direction?: string } }) =>
        messages.filter((m) => m.conversationId === where.conversationId && (!where.direction || m.direction === where.direction)).length,
    },
    flow: {
      findMany: async ({ where }: { where: { triggers: { array_contains: Array<{ type: string }> } } }) =>
        FLOWS.filter((f) => f.isActive && f.triggers.some((t) => t.type === where.triggers.array_contains[0]!.type)),
      findUnique: async ({ where }: { where: { id: string } }) => FLOWS.find((f) => f.id === where.id) ?? null,
    },
    flowSession: {
      findUnique: async ({ where }: { where: { conversationId: string } }) => {
        const s = sessions.get(where.conversationId);
        return s ? { ...s } : null;
      },
      upsert: async ({ where, create, update }: { where: { conversationId: string }; create: Partial<Session>; update: Partial<Session> }) => {
        const prev = sessions.get(where.conversationId);
        const next = prev
          ? { ...prev, ...update, updatedAt: new Date() }
          : ({ id: `fs${++seq}`, currentNodeId: null, createdAt: new Date(), startedAt: null, ...create, updatedAt: new Date() } as Session);
        sessions.set(where.conversationId, next);
        return next;
      },
      update: async ({ where, data }: { where: { conversationId: string }; data: Partial<Session> }) => {
        const next = { ...sessions.get(where.conversationId)!, ...data, updatedAt: new Date() };
        sessions.set(where.conversationId, next);
        return next;
      },
    },
  };
  const messaging = {
    queueOutbound: async (d: { text?: string; caption?: string; type: string }) => void sent.push(d.text ?? d.caption ?? `[${d.type}]`),
    queueInteractive: async (d: { body: string }) => void sent.push(d.body),
    setStatus: async () => undefined,
    setAiMode: async () => undefined,
    addNote: async () => undefined,
  };
  const queue = { add: async (name: string, data: { conversationId: string; run?: string }) => void jobs.push({ name, data }) };
  const engine = new FlowEngineService(
    prisma as never,
    {} as never,
    messaging as never,
    {} as never,
    queue as never,
    { emit: () => true } as never,
  );

  /** Llega un mensaje del cliente (se guarda; aún no se procesa). */
  const push = (content: string, payload: string | null = null) => {
    const id = `m${++seq}`;
    messages.push({ id, conversationId: CONV, direction: "INBOUND", type: "TEXT", content, transcript: null, buttonPayload: payload, referral: null, createdAt: new Date() });
    return id;
  };
  /** Escribe el cliente: el mensaje se guarda y el motor lo procesa como en producción. */
  const says = async (content: string, payload: string | null = null) => engine.onInbound(CONV, push(content, payload));
  const session = () => sessions.get(CONV) ?? null;
  /** Como si el flujo hubiera arrancado y se hubiera puesto a esperar hace `hours` horas. */
  const age = (hours: number) => {
    const s = sessions.get(CONV)!;
    const then = new Date(Date.now() - hours * 3600_000);
    sessions.set(CONV, { ...s, updatedAt: then, startedAt: then });
  };
  const firstMessage = async (content: string) => {
    messages.push({ id: `m${++seq}`, conversationId: CONV, direction: "INBOUND", type: "TEXT", content, transcript: null, buttonPayload: null, referral: null, createdAt: new Date() });
    return engine.onCreated(CONV);
  };
  return { engine, says, push, firstMessage, session, age, sent, jobs };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("la palabra clave se reconoce sin tildes ni mayúsculas", async () => {
  const t = setup();
  assert.equal(await t.says("Hola, quiero INFORMACION de los cursos"), true);
  assert.deepEqual(t.sent, ["Te paso la información"]);
});

test("la condición «el mensaje contiene» tampoco mira las tildes", async () => {
  const t = setup();
  const rule = { id: "r1", field: "message" as const, op: "contains" as const, value: "información, catálogo" };
  assert.equal(await t.engine.rulesMatch(CONV, [rule], "all", "me pasas el catalogo?"), true);
  assert.equal(await t.engine.rulesMatch(CONV, [rule], "all", "hola"), false);
});

test("si el primer mensaje trae una palabra clave, arranca ese flujo y no el de bienvenida", async () => {
  const t = setup();
  assert.equal(await t.firstMessage("Hola! Vi su anuncio, quiero información"), true);
  assert.deepEqual(t.sent, ["Te paso la información"]);

  const u = setup();
  assert.equal(await u.firstMessage("Hola"), true);
  assert.deepEqual(u.sent, ["¿Qué buscas?"], "sin palabra clave, la bienvenida de siempre");
});

test("con el menú de otro flujo sin contestar, la palabra clave arranca su flujo", async () => {
  const t = setup();
  await t.firstMessage("Hola");
  assert.equal(t.session()?.currentNodeId, "b");
  assert.equal(await t.says("en realidad quiero información"), true);
  assert.deepEqual(t.sent, ["¿Qué buscas?", "Te paso la información"]);
  assert.equal(t.session()?.flowId, "info");
});

test("pulsar un botón del menú sigue siendo la respuesta, también escrito sin tilde", async () => {
  const t = setup();
  await t.firstMessage("Hola");
  assert.equal(await t.says("Ver catálogo", "b2"), true);
  assert.deepEqual(t.sent.slice(1), ["Catálogo"]);

  const u = setup();
  await u.firstMessage("Hola");
  assert.equal(await u.says("si"), true, "«si» es el botón «Sí»");
  assert.deepEqual(u.sent.slice(1), ["Genial"]);
});

test("un texto que no es un botón ni tiene «otra respuesta» no corta el menú: lo atiende la IA y el botón sigue valiendo", async () => {
  const t = setup();
  await t.firstMessage("Hola");
  assert.equal(await t.says("cuánto cuesta el envío?"), false, "el mensaje sigue a la IA");
  assert.equal(t.session()?.currentNodeId, "b", "el menú sigue esperando");
  assert.equal(await t.says("Sí", "b1"), true);
  assert.deepEqual(t.sent, ["¿Qué buscas?", "Genial"]);
});

test("la palabra clave del mismo flujo, mientras contesta a su pregunta, es la respuesta", async () => {
  const t = setup();
  await t.says("quiero hacer la encuesta");
  assert.equal(await t.says("la encuesta un 5"), true);
  assert.deepEqual(t.sent, ["¿Del 1 al 5?", "Gracias: la encuesta un 5"]);
});

test("una pregunta sin contestar en 24 h ya no retiene los mensajes ni bloquea otros flujos", async () => {
  const t = setup();
  await t.says("encuesta");
  t.age(30);
  assert.equal(await t.says("hola, siguen abiertos?"), false, "no se toma como la nota de la encuesta");
  assert.equal(await t.says("encuesta"), true, "la misma palabra la vuelve a empezar");
  assert.deepEqual(t.sent, ["¿Del 1 al 5?", "¿Del 1 al 5?"]);
  t.age(30);
  assert.equal(await t.engine.runFlowForContact("info", "ct1"), true, "un flujo por evento ya puede arrancar");
});

test("en un menú de hace días, «2 polos» no elige la opción 2", async () => {
  const t = setup();
  await t.firstMessage("Hola");
  t.age(48);
  assert.equal(await t.says("2 polos por favor"), false);
  assert.deepEqual(t.sent, ["¿Qué buscas?"]);
  assert.equal(await t.says("Ver catálogo", "b2"), true, "pulsarlo sigue valiendo");
  assert.deepEqual(t.sent, ["¿Qué buscas?", "Catálogo"]);
});

test("durante un «Esperar», una palabra clave arranca su flujo y el temporizador viejo no reanuda al nuevo", async () => {
  const t = setup();
  await t.says("recordar");
  assert.equal(t.session()?.status, "waiting_timer");
  const first = t.jobs.at(-1)!;
  assert.ok(first.data.run, "el trabajo lleva el arranque que lo programó");

  assert.equal(await t.says("ok"), true, "lo demás se ignora durante la pausa");
  assert.deepEqual(t.sent, ["Te escribo en un rato"]);

  assert.equal(await t.says("mejor mándame la información"), true);
  assert.deepEqual(t.sent, ["Te escribo en un rato", "Te paso la información"]);

  // Vuelve a pedir el recordatorio: otra pausa, otro arranque.
  await tick();
  await t.says("recordar");
  const second = t.jobs.at(-1)!;
  assert.notEqual(second.data.run, first.data.run);
  await t.engine.resumeTimer(CONV, first.data.run);
  assert.equal(t.session()?.status, "waiting_timer", "el trabajo de la primera pausa no toca la segunda");
  await t.engine.resumeTimer(CONV, second.data.run);
  assert.equal(t.sent.at(-1), "¿Seguimos?");
  assert.equal(t.session()?.status, "completed");
});

test("escribir la palabra clave de su propio menú no lo vuelve a mandar", async () => {
  const t = setup();
  await t.says("menu");
  assert.equal(t.session()?.currentNodeId, "b");
  assert.equal(await t.says("el menu otra vez?"), false);
  assert.deepEqual(t.sent, ["¿Qué necesitas?"], "el menú sale una sola vez");
  assert.equal(await t.says("Precios", "p1"), true, "y el botón sigue valiendo");
  assert.deepEqual(t.sent, ["¿Qué necesitas?", "Lista de precios"]);
});

test("dos mensajes seguidos se atienden cada uno con su texto: el flujo sale una vez", async () => {
  const t = setup();
  // Llegan los dos antes de que se procese el primero.
  const first = t.push("hola, quiero información");
  const second = t.push("gracias");
  assert.equal(await t.engine.onInbound(CONV, first), true, "la palabra clave del primero no se pierde");
  assert.equal(await t.engine.onInbound(CONV, second), false);
  assert.deepEqual(t.sent, ["Te paso la información"]);
});
