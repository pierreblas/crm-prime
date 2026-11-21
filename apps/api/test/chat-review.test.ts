/**
 * Revisión de conversaciones reales: el revisor del simulador sobre los chats
 * que atendió la IA, con lo que consultó el agente en cada respuesta. Cómo se
 * arma la conversación, cuáles se revisan (solo con algo nuevo de la IA), qué
 * se guarda y la pasada diaria. Sin base de datos ni modelo: dobles.
 *
 *   npm run test:chatreview --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_REVIEW_DAILY_MAX, REPLY_BUTTONS_TOOL } from "@crm/shared";
import { chatReviewLines, type ReviewMessage, type ReviewRun } from "../src/modules/ai/chat-review.lines";
import { ChatReviewService } from "../src/modules/ai/chat-review.service";
import { simulationReviewInput } from "../src/modules/ai/simulation-review";

type Row = Record<string, any>;

const msg = (direction: string, author: string | null, content: string, extra: Partial<ReviewMessage> = {}): ReviewMessage => ({
  direction,
  author,
  type: "TEXT",
  content,
  transcript: null,
  note: null,
  aiRunId: null,
  interactive: null,
  ...extra,
});

const CATALOG = JSON.stringify({ total: 1, note: 'Resultados para "genómica".', products: [{ name: "Genómica bacteriana", price: 50, currency: "USD", missingDetails: ["Temario"] }] });

test("la conversación para el revisor: cliente, IA con lo que consultó y lo que devolvió, y el equipo aparte", () => {
  const runs = new Map<string, ReviewRun>([
    [
      "run1",
      {
        status: "COMPLETED",
        escalationReason: null,
        toolCalls: [
          { toolName: "search_products", input: { query: "genómica" }, output: { result: CATALOG } },
          { toolName: REPLY_BUTTONS_TOOL, input: { options: ["Ver temario", "Datos de pago"] }, output: { result: "Ofreció botones" } },
        ],
      },
    ],
    ["run2", { status: "ESCALATED", escalationReason: "Pide los datos de pago", toolCalls: [] }],
  ]);
  const lines = chatReviewLines(
    [
      msg("INBOUND", null, "Hola, ¿cuánto cuesta el curso de genómica?"),
      // Una respuesta partida en dos mensajes (mismo run): va como una sola línea.
      msg("OUTBOUND", "AI", "¡Hola! El curso cuesta USD 50.", { aiRunId: "run1" }),
      msg("OUTBOUND", "AI", "¿Te comparto el temario o los datos de pago?", {
        aiRunId: "run1",
        interactive: { kind: "buttons", buttons: [{ id: "opt_1", title: "Ver temario" }, { id: "opt_2", title: "Datos de pago" }] },
      }),
      msg("INBOUND", null, "Datos de pago"),
      msg("OUTBOUND", "AI", "Te paso con una persona del equipo para los datos de pago.", { aiRunId: "run2" }),
      msg("OUTBOUND", "HUMAN", "Hola, soy Ana. Te envío los datos por aquí."),
      msg("INBOUND", null, "   "),
      // De la IA pero sin ejecución: un flujo o un aviso programado. De contexto.
      msg("OUTBOUND", "AI", "Rama VIP pendiente"),
    ],
    runs,
  );
  assert.deepEqual(
    lines.map((l) => l.who),
    ["customer", "agent", "customer", "agent", "team", "auto"],
  );
  assert.equal(lines[1]!.text, "¡Hola! El curso cuesta USD 50.\n\n¿Te comparto el temario o los datos de pago?");
  assert.deepEqual(lines[1]!.options, ["Ver temario", "Datos de pago"]);
  assert.equal(lines[1]!.consulted.length, 1, "los botones no son una consulta");
  assert.match(lines[1]!.consulted[0]!, /^search_products «genómica» → Encontró 1: Genómica bacteriana\..*\nDevolvió: .*"price":50/);
  assert.equal(lines[3]!.handoff, "Pide los datos de pago");
  assert.equal(lines[1]!.handoff, null);
  // Y el revisor lo lee así.
  const text = simulationReviewInput({ scenario: { title: "Conversación real", brief: "Cliente real por WhatsApp." }, lines, ended: null }, "Eres Lia.");
  assert.match(text, /EQUIPO dijo: «Hola, soy Ana\. Te envío los datos por aquí\.»/);
  assert.match(text, /Pasó el chat a una persona: Pide los datos de pago/);
  assert.match(text, /AUTOMÁTICO dijo: «Rama VIP pendiente»/);
  assert.doesNotMatch(text, /AGENTE dijo: «Rama VIP/);
});

// ── Cuáles se revisan y qué se guarda ──────────────────────────
const day = (n: number) => new Date(Date.UTC(2026, 10, 19, 12) - n * 3600_000);

function service(opts: { latest?: Row[]; reviewed?: Row[]; review?: Row; fail?: string } = {}) {
  const created: Row[] = [];
  const upserts: Row[] = [];
  const asked: Row[] = [];
  const s = Object.create(ChatReviewService.prototype) as ChatReviewService & Row;
  s.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  s.running = new Map();
  s.tenant = { orgId: () => "org1" };
  s.prisma = {
    message: {
      groupBy: async ({ where }: Row) => {
        asked.push(where);
        return opts.latest ?? [];
      },
      findMany: async () =>
        [
          msg("OUTBOUND", "AI", "¿Te separo un cupo?", { aiRunId: "run1" }),
          msg("INBOUND", null, "¿Cuánto cuesta?"),
        ],
    },
    conversationReview: {
      groupBy: async () => opts.reviewed ?? [],
      create: async ({ data }: Row) => created.push(data),
    },
    conversation: { findUnique: async () => ({ channelKind: "whatsapp" }) },
    aiRun: { findMany: async () => [{ id: "run1", status: "COMPLETED", escalationReason: null, agentConfigId: "bot1", toolCalls: [] }] },
    agentConfig: { findUnique: async () => ({ name: "Venta flyteek", systemPrompt: "Eres Lia.", model: "gpt-4.1-mini" }) },
    aiSetting: { upsert: async (args: Row) => upserts.push(args) },
  };
  s.agent = {
    reviewTranscript: async (input: Row, o: Row) => {
      if (opts.fail) throw new Error(opts.fail);
      asked.push({ input, o });
      return opts.review ?? { verdict: "bad", summary: "Inventó el temario.", findings: [{ kind: "invented", note: "Dio un temario que no tiene.", quote: "El temario incluye…" }], tokens: 4200 };
    },
  };
  return { s, created, upserts, asked };
}

test("se revisan las que tienen mensajes nuevos de la IA desde su última revisión, de la más reciente, hasta el tope", async () => {
  const { s, created, upserts, asked } = service({
    latest: [
      { conversationId: "c_old", _max: { createdAt: day(30) }, _count: { _all: 2 } },
      { conversationId: "c_new", _max: { createdAt: day(1) }, _count: { _all: 4 } },
      { conversationId: "c_same", _max: { createdAt: day(5) }, _count: { _all: 3 } },
      { conversationId: "c_more", _max: { createdAt: day(2) }, _count: { _all: 1 } },
    ],
    // c_same ya se revisó hasta su último mensaje; c_more se revisó antes de que la IA volviera a escribir.
    reviewed: [
      { conversationId: "c_same", _max: { lastMessageAt: day(5) } },
      { conversationId: "c_more", _max: { lastMessageAt: day(10) } },
    ],
  });
  const n = await s.run("org1", 7, 2);
  assert.equal(n, 2);
  assert.deepEqual(created.map((c) => c.conversationId), ["c_new", "c_more"], "la más reciente primero y hasta el tope");
  assert.equal(asked[0]!.orgId, "org1");
  assert.equal(asked[0]!.author, "AI");
  assert.deepEqual(asked[0]!.aiRunId, { not: null }, "solo respuestas del agente, no flujos ni avisos");
  assert.ok(asked[0]!.createdAt.gte.getTime() < Date.now() - 6.9 * 86_400_000, "los últimos 7 días");
  // Lo que se guarda: veredicto, hallazgos, hasta qué mensaje se revisó, el agente y los tokens.
  assert.deepEqual(
    { verdict: created[0]!.verdict, agentName: created[0]!.agentName, lastMessageAt: created[0]!.lastMessageAt, aiMessages: created[0]!.aiMessages, tokens: created[0]!.tokens },
    { verdict: "bad", agentName: "Venta flyteek", lastMessageAt: day(1), aiMessages: 4, tokens: 4200 },
  );
  assert.equal(created[0]!.findings[0].kind, "invented");
  // El revisor recibe una conversación real, las instrucciones del agente y cuenta como «review».
  const call = asked.find((a) => a.input)!;
  assert.equal(call.input.scenario.title, "Conversación real");
  assert.deepEqual({ instructions: call.o.instructions, feature: call.o.feature, conversationId: call.o.conversationId }, { instructions: "Eres Lia.", feature: "review", conversationId: "c_new" });
  assert.equal(upserts.length, 1, "anota la última pasada");
});

test("sin mensajes de la IA no se revisa; si falla la IA (sin clave), se para sin seguir gastando", async () => {
  const empty = service({ latest: [] });
  assert.equal(await empty.s.run("org1", 1, 20), 0);
  assert.equal(empty.created.length, 0);

  const noKey = service({
    latest: [
      { conversationId: "a", _max: { createdAt: day(1) }, _count: { _all: 1 } },
      { conversationId: "b", _max: { createdAt: day(2) }, _count: { _all: 1 } },
    ],
    fail: "Configura tu clave de OpenAI o Anthropic",
  });
  assert.equal(await noKey.s.run("org1", 1, 20), 0);
  assert.equal(noKey.asked.filter((a) => a.createdAt).length, 1);
});

test("la pasada diaria: solo empresas que la activaron, una vez al día y con la IA disponible", async () => {
  const s = Object.create(ChatReviewService.prototype) as ChatReviewService & Row;
  s.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  s.running = new Map();
  s.sweeping = false;
  let where: Row = {};
  s.prisma = {
    aiSetting: {
      findMany: async (args: Row) => {
        where = args.where;
        return [{ orgId: "con_ia" }, { orgId: "sin_ia" }];
      },
    },
  };
  let current = "";
  s.aiSettings = { status: async () => ({ ready: current === "con_ia" }) };
  const runs: Row[] = [];
  s.run = async (orgId: string, days: number, limit: number) => {
    runs.push({ orgId, days, limit });
    return 3;
  };
  const real = s.run;
  s.run = async (orgId: string, days: number, limit: number) => real(orgId, days, limit);
  // El contexto de empresa lo pone runInOrg: lo leemos en status() por el orgId que se procesa.
  const status = s.aiSettings.status;
  s.aiSettings.status = async () => status();
  const origMap = s.running.set.bind(s.running);
  s.running.set = (k: string, v: Row) => {
    current = k;
    return origMap(k, v);
  };
  const total = await s.sweep();
  assert.equal(where.chatReview, true);
  assert.ok(where.OR[1].chatReviewAt.lt.getTime() < Date.now() - 23 * 3600_000, "una vez al día");
  assert.deepEqual(runs, [{ orgId: "con_ia", days: 1, limit: CHAT_REVIEW_DAILY_MAX }]);
  assert.equal(total, 3);
  assert.equal(s.running.size, 0, "al terminar no queda nada «en marcha»");
});

test("el panel: lo de mirar, con el canal y el contacto; marcar como vista y una que no existe", async () => {
  const s = Object.create(ChatReviewService.prototype) as ChatReviewService & Row;
  s.running = new Map([["org1", { done: 1, total: 3 }]]);
  s.tenant = { orgId: () => "org1" };
  const updated: Row[] = [];
  let listWhere: Row = {};
  s.prisma = {
    aiSetting: { findUnique: async () => ({ chatReview: true, chatReviewAt: day(3) }) },
    agentConfig: { findMany: async () => [{ id: "bot1" }] },
    conversationReview: {
      count: async () => 2,
      findMany: async (args: Row) => {
        listWhere = args.where;
        return [
          {
            id: "r1",
            conversationId: "c1",
            agentConfigId: "bot1",
            agentName: "Venta flyteek",
            verdict: "bad",
            summary: "Inventó el temario.",
            findings: [{ kind: "invented", note: "Dio un temario que no tiene.", quote: "El temario incluye…" }],
            aiMessages: 4,
            tokens: 4200,
            status: "open",
            createdAt: day(2),
            lastMessageAt: day(3),
            conversation: { channelKind: "instagram", contact: { name: "", phone: "+51987654321" } },
          },
          {
            id: "r2",
            conversationId: "c2",
            agentConfigId: "borrado",
            agentName: "Agente antiguo",
            verdict: "review",
            summary: "No propuso el siguiente paso.",
            findings: [],
            aiMessages: 2,
            tokens: 900,
            status: "open",
            createdAt: day(2),
            lastMessageAt: day(3),
            conversation: { channelKind: "whatsapp", contact: { name: "Ana", phone: "+51911111111" } },
          },
        ];
      },
      findFirst: async ({ where }: Row) => (where.id === "r1" ? { id: "r1" } : null),
      update: async (args: Row) => updated.push(args),
    },
  };
  const o = await s.overview("open");
  assert.deepEqual(listWhere, { status: "open", verdict: { in: ["review", "bad"] } });
  assert.equal(o.enabled, true);
  assert.deepEqual(o.running, { done: 1, total: 3 });
  assert.equal(o.open, 2);
  assert.equal(o.reviews[0]!.contactName, "+51987654321", "sin nombre, el teléfono");
  assert.equal(o.reviews[0]!.channel, "Instagram");
  // A qué agente iría un caso sacado de ese chat; si el agente ya no existe, a ninguno.
  assert.deepEqual(o.reviews.map((r) => r.agentConfigId), ["bot1", null]);
  await s.setStatus("r1", "done");
  assert.equal(updated[0]!.data.status, "done");
  assert.ok(updated[0]!.data.doneAt instanceof Date);
  await assert.rejects(() => s.setStatus("otra", "done"), /no encontrada/);
});
