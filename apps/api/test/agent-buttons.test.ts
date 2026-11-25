/**
 * Botones en la respuesta del agente. El agente escribe su mensaje como
 * siempre; si su agente tiene «Responder con botones» y el mensaje termina en
 * una pregunta para elegir, un paso corto saca las opciones, y al enviarse
 * salen como botones (hasta 3 cortos) o como lista. Sin base de datos ni
 * modelo: dobles de Prisma, de la mensajería y del LLM.
 *
 *   npm run test:agentbuttons --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cleanReplyOptions, interactiveFromOptions, optionsNote, REPLY_BUTTONS_TOOL, stripOptionsNote } from "@crm/shared";
import { AgentService } from "../src/modules/ai/agent.service";
import { AutopilotService } from "../src/modules/ai/autopilot.service";
import { availableTools, resolveTools } from "../src/modules/ai/tools.registry";
import { traceToolCall } from "../src/modules/ai/playground-trace";
import { buttonRules, endsWithQuestion, parseReplyOptions, REPLY_OPTIONS_SYSTEM, replyOptionsInput } from "../src/modules/ai/reply-options";

type Row = Record<string, any>;

const text = (t: string) => ({ stopReason: "end_turn", content: [{ type: "text", text: t }] });

test("las opciones se limpian: sin vacías ni repetidas, como mucho 10; con menos de 2 no hay botones", () => {
  assert.deepEqual(cleanReplyOptions(["  Sí, sepárame ", "Tengo dudas", "sí, sepárame", "", 3]), ["Sí, sepárame", "Tengo dudas"]);
  assert.deepEqual(cleanReplyOptions(["Solo una"]), []);
  assert.deepEqual(cleanReplyOptions("no es lista"), []);
  assert.equal(cleanReplyOptions(Array.from({ length: 14 }, (_, i) => `Opción ${i}`)).length, 10);
  assert.deepEqual(parseReplyOptions('Claro: {"options": ["Transferencia", "Yape"]}'), ["Transferencia", "Yape"]);
  assert.deepEqual(parseReplyOptions('{"options": []}'), []);
  assert.deepEqual(parseReplyOptions("no es JSON"), []);
});

test("hasta 3 opciones cortas van como botones; más, o una que no cabe, como lista", () => {
  assert.deepEqual(interactiveFromOptions(["Sí, sepárame", "Tengo dudas"]), {
    buttons: [
      { id: "opt_1", title: "Sí, sepárame" },
      { id: "opt_2", title: "Tengo dudas" },
    ],
  });
  const four = interactiveFromOptions(["Mañana", "Tarde", "Noche", "Fin de semana"]);
  assert.deepEqual(four.buttons, []);
  assert.equal(four.list?.button, "Ver opciones");
  assert.deepEqual(four.list?.rows.map((r) => r.title), ["Mañana", "Tarde", "Noche", "Fin de semana"]);
  // Una de más de 20 caracteres no cabe en un botón: lista, con el título recortado y entera en la descripción.
  const long = interactiveFromOptions(["Sí", "Quiero el curso de genómica bacteriana"]);
  assert.equal(long.list?.rows[1]?.title.length, 24);
  assert.equal(long.list?.rows[1]?.description, "Quiero el curso de genómica bacteriana");
  assert.equal(optionsNote(["Sí", "No"]), "[Botones: Sí · No]");
});

test("se activa en el agente junto a sus herramientas, pero el modelo no la recibe como herramienta", () => {
  const info = availableTools().find((t) => t.name === REPLY_BUTTONS_TOOL);
  assert.equal(info?.label, "Ofrecer botones y listas");
  assert.equal(info?.isAction, false);
  assert.deepEqual(resolveTools([REPLY_BUTTONS_TOOL]), []);
  assert.equal(endsWithQuestion("¿Prefieres transferencia o Yape?"), true);
  assert.equal(endsWithQuestion("¿Te separo un cupo? 😊"), true);
  assert.equal(endsWithQuestion("Listo, te esperamos el lunes."), false);
});

// ── La respuesta en una conversación real (bandeja) ────────────
function agent(opts: { replies: Row[]; tools?: string[]; history?: Row[]; escalateRule?: boolean; prompt?: string }) {
  const calls: Row[] = [];
  const saved: Row[] = [];
  const service = Object.create(AgentService.prototype) as AgentService & Row;
  service.logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
  service.prisma = {
    conversation: {
      findUnique: async () => ({
        id: "cv1",
        contactId: "ct1",
        aiMode: "COPILOT",
        channelKind: "whatsapp",
        referral: null,
        windowExpiresAt: new Date(Date.now() + 3600_000),
        contact: { id: "ct1", name: "Ana", phone: "+51987654321", metadata: {}, aiMemory: null, optIn: true, lastMessageAt: null },
      }),
    },
    productField: { findMany: async () => [] },
    customField: { findMany: async () => [] },
    // El agente lee los datos del lead abierto del contacto (aquí, ninguno).
    deal: { findFirst: async () => null },
    message: {
      findMany: async () => opts.history ?? [{ direction: "INBOUND", type: "TEXT", content: "Me interesa, ¿cómo pago?", interactive: null }],
      findFirst: async () => ({ type: "TEXT" }),
    },
    aiRun: { create: async () => ({ id: "run1" }), update: async ({ data }: Row) => saved.push({ run: data }) },
    aiToolCall: { create: async ({ data }: Row) => saved.push(data) },
  };
  service.bots = {
    resolveForConversation: async () => ({
      id: "bot1",
      name: "Ventas",
      systemPrompt: opts.prompt ?? "Eres Lia.",
      enabledTools: opts.tools ?? [REPLY_BUTTONS_TOOL],
      model: "gpt-4.1-mini",
      effort: "medium",
      maxIterations: 4,
      escalationRules: opts.escalateRule ? { keywords: ["humano"] } : null,
      monthlyTokenBudget: 0,
    }),
  };
  service.actions = { loadContext: async () => ({}), pendingFor: async () => [] };
  service.aiSettings = { allowsConversation: async () => true };
  service.knowledge = { retrieve: async () => [] };
  service.bookings = { agentContextText: async () => "" };
  service.llm = {
    name: "openai",
    classify: async () => ({ intent: "compra", sentiment: "positive", urgency: "low", requiresHuman: false }),
    generate: async (req: Row) => {
      calls.push(JSON.parse(JSON.stringify(req)));
      const r = opts.replies[Math.min(calls.length - 1, opts.replies.length - 1)]!;
      if (r instanceof Error) throw r;
      return { ...r, usage: { inputTokens: 100, outputTokens: 10 }, model: "gpt-4.1-mini" };
    },
  };
  return { service, calls, saved };
}

test("si la respuesta termina en una pregunta para elegir, un paso corto saca las opciones", async () => {
  const { service, calls, saved } = agent({
    replies: [text("¡Perfecto! 👍 ¿Prefieres pagar por transferencia o Yape?"), text('{"options": ["Transferencia", "Yape"]}')],
  });
  const r = await service.suggest("cv1");
  assert.equal(r.suggestion, "¡Perfecto! 👍 ¿Prefieres pagar por transferencia o Yape?");
  assert.deepEqual(r.options, ["Transferencia", "Yape"]);
  assert.equal(calls.length, 2);
  // El segundo paso: corto, con el mismo modelo y contado como el agente.
  assert.equal(calls[1]!.system, REPLY_OPTIONS_SYSTEM);
  assert.equal(calls[1]!.messages[0].content, "¡Perfecto! 👍 ¿Prefieres pagar por transferencia o Yape?");
  assert.equal(calls[1]!.feature, "agent");
  assert.equal(calls[1]!.model, "gpt-4.1-mini");
  assert.equal(saved.find((d) => d.run)?.run.inputTokens, 200, "sus tokens suman en la respuesta");
  // Queda para «¿Por qué respondió esto?».
  const trace = saved.find((d) => d.toolName === REPLY_BUTTONS_TOOL);
  assert.equal(traceToolCall(REPLY_BUTTONS_TOOL, trace?.input, trace?.output.result).summary, "Ofreció botones: «Transferencia» · «Yape»");
  // Al agente se le pide que la pregunta final nombre las opciones.
  assert.match(calls[0]!.system, /haz una sola pregunta al final y nombra en ella las opciones/);
});

test("no se gasta la llamada sin la opción activa, sin pregunta al final ni si el chat pasa a una persona", async () => {
  const off = agent({ tools: [], replies: [text("¿Prefieres transferencia o Yape?")] });
  assert.deepEqual((await off.service.suggest("cv1")).options, []);
  assert.equal(off.calls.length, 1);
  assert.doesNotMatch(off.calls[0]!.system, /Botones:/);

  const statement = agent({ replies: [text("Listo, te espero el lunes.")] });
  assert.deepEqual((await statement.service.suggest("cv1")).options, []);
  assert.equal(statement.calls.length, 1);

  const handoff = agent({
    escalateRule: true,
    history: [{ direction: "INBOUND", type: "TEXT", content: "Quiero hablar con un humano", interactive: null }],
    replies: [text("Te paso con una persona. ¿Te parece?")],
  });
  const h = await handoff.service.suggest("cv1");
  assert.equal(h.escalate, true);
  assert.deepEqual(h.options, []);
  assert.equal(handoff.calls.length, 1);
});

test("si el paso de los botones falla o no ve opciones, la respuesta sale igual, sin botones", async () => {
  const failed = await agent({ replies: [text("¿Te separo un cupo?"), new Error("timeout") as any] }).service.suggest("cv1");
  assert.equal(failed.suggestion, "¿Te separo un cupo?");
  assert.deepEqual(failed.options, []);
  const open = await agent({ replies: [text("¿Qué curso te interesa?"), text('{"options": []}')] }).service.suggest("cv1");
  assert.deepEqual(open.options, []);
});

test("en el historial, un mensaje con botones va sin la nota «[Botones: …]» (el modelo la copiaba en su respuesta)", async () => {
  const { service, calls } = agent({
    tools: [],
    history: [
      { direction: "INBOUND", type: "TEXT", content: "Hola", interactive: null },
      { direction: "OUTBOUND", type: "TEXT", content: "¿Te separo el cupo?", interactive: { kind: "buttons", buttons: [{ id: "opt_1", title: "Sí, sepárame" }, { id: "opt_2", title: "Tengo dudas" }] } },
      { direction: "INBOUND", type: "TEXT", content: "Sí, sepárame", interactive: null },
    ].reverse(),
    replies: [text("¡Listo!")],
  });
  await service.suggest("cv1");
  const offered = calls[0]!.messages.find((m: Row) => m.role === "assistant");
  assert.equal(offered.content, "¿Te separo el cupo?");
});

// ── «Probar conversación» ─────────────────────────────────────
test("en la prueba también: la respuesta trae sus opciones y la traza dice qué ofreció", async () => {
  const service = Object.create(AgentService.prototype) as AgentService & Row;
  service.logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
  service.prisma = {
    agentConfig: { findUnique: async () => ({ id: "bot1", systemPrompt: "Eres Lia.", enabledTools: [REPLY_BUTTONS_TOOL], model: "gpt-4.1-mini", maxIterations: 4 }) },
    productField: { findMany: async () => [] },
    customField: { findMany: async () => [] },
    // El agente lee los datos del lead abierto del contacto (aquí, ninguno).
    deal: { findFirst: async () => null },
  };
  service.actions = { loadContext: async () => ({}) };
  service.bookings = { agentContextText: async () => "" };
  service.knowledge = { retrieve: async () => [] };
  const replies = [text("¡Genial! ¿En qué horario te acomoda: mañana, tarde, noche o sábado?"), text('{"options": ["Mañana", "Tarde", "Noche", "Sábado"]}')];
  const calls: Row[] = [];
  service.llm = {
    name: "openai",
    generate: async (req: Row) => {
      calls.push(req);
      return { ...replies[calls.length - 1]!, usage: { inputTokens: 10, outputTokens: 5 }, model: "gpt-4.1-mini" };
    },
  };
  const r = await service.playground({ message: "Quiero inscribirme", botId: "bot1", history: [] });
  assert.deepEqual(r.options, ["Mañana", "Tarde", "Noche", "Sábado"]);
  assert.equal(calls[1]!.feature, "playground");
  assert.equal(r.toolCalls.at(-1)?.summary, "Ofreció una lista: «Mañana» · «Tarde» · «Noche» · «Sábado»");
});

// ── El envío del Autopilot ────────────────────────────────────
function autopilot(opts: { split?: boolean; failInteractive?: boolean } = {}) {
  const out: Row[] = [];
  const service = Object.create(AutopilotService.prototype) as Row;
  service.logger = { log: () => undefined, warn: () => undefined };
  service.bots = { resolveForConversation: async () => ({ splitReplies: !!opts.split }) };
  service.showTyping = async () => undefined;
  service.messaging = {
    queueOutbound: async (input: Row, author: string, o: Row) => out.push({ kind: "text", text: input.text, author, o }),
    queueInteractive: async (input: Row, author: string, o: Row) => {
      if (opts.failInteractive) throw new Error("Fuera de la ventana de 24h");
      out.push({ kind: "interactive", input, author, o });
    },
  };
  return { service, out };
}

test("el Autopilot pone los botones en el último mensaje, enlazado a su respuesta", async () => {
  const { service, out } = autopilot({ split: true });
  await service.sendReply(
    "cv1",
    "¡Hola, Ana! 👋 Te cuento lo del curso de genómica bacteriana.\n\nEmpieza el 29 de junio, en vivo por Zoom. ¿Te separo un cupo?",
    { channelId: null, contactId: "ct1" },
    "run1",
    ["Sí, sepárame", "Tengo dudas"],
  );
  assert.deepEqual(out.map((m) => m.kind), ["text", "interactive"]);
  const last = out.at(-1)!;
  assert.equal(last.author, "AI");
  assert.deepEqual(last.o, { aiRunId: "run1" });
  assert.match(last.input.body, /¿Te separo un cupo\?$/);
  assert.deepEqual(last.input.buttons.map((b: Row) => b.title), ["Sí, sepárame", "Tengo dudas"]);
});

test("con más de 3 opciones sale una lista; sin opciones, texto; si los botones fallan, sale el texto igual", async () => {
  const list = autopilot();
  await list.service.sendReply("cv1", "¿Qué horario prefieres?", { channelId: null, contactId: "ct1" }, "run1", ["Mañana", "Tarde", "Noche", "Sábado"]);
  assert.equal(list.out[0]!.input.list.rows.length, 4);

  const plain = autopilot();
  await plain.service.sendReply("cv1", "Gracias", { channelId: null, contactId: "ct1" }, "run1");
  assert.deepEqual(plain.out.map((m) => m.kind), ["text"]);

  const failed = autopilot({ failInteractive: true });
  await failed.service.sendReply("cv1", "¿Te separo un cupo?", { channelId: null, contactId: "ct1" }, "run1", ["Sí", "No"]);
  assert.deepEqual(failed.out, [{ kind: "text", text: "¿Te separo un cupo?", author: "AI", o: { aiRunId: "run1" } }]);
});

// ── Las reglas de botones que escribe quien configura el agente ──
const PROMPT = [
  "Eres Lia, asesora de cursos de Flyteek.",
  "PAGOS",
  "- Al preguntar cómo quiere pagar, usa los botones «Yape», «Transferencia» y «Tarjeta».",
  "* Cuando le preguntes si quiere separar su cupo, usa los botones «Sí, sepárame» y «Tengo dudas».",
  "Nunca uses botones cuando le pidas su nombre o su correo.",
  "Saluda siempre por su nombre. Ofrece el temario si lo pide. Al cerrar la venta, no pongas botones si el cliente ya pagó y solo agradece; " +
    "en cambio, si pregunta por fechas, contesta con la fecha del producto. ".repeat(4),
  "Nunca uses botones cuando le pidas su nombre o su correo.",
].join("\n");

test("las reglas de botones se toman de «Cómo debe atender»: las frases que hablan de botones, sin viñetas ni repetidas", () => {
  const rules = buttonRules(PROMPT);
  assert.deepEqual(rules.slice(0, 3), [
    "Al preguntar cómo quiere pagar, usa los botones «Yape», «Transferencia» y «Tarjeta».",
    "Cuando le preguntes si quiere separar su cupo, usa los botones «Sí, sepárame» y «Tengo dudas».",
    "Nunca uses botones cuando le pidas su nombre o su correo.",
  ]);
  // Una línea larga: solo la frase que habla de botones.
  assert.equal(rules[3], "Al cerrar la venta, no pongas botones si el cliente ya pagó y solo agradece; en cambio, si pregunta por fechas, contesta con la fecha del producto.");
  assert.equal(rules.length, 4, "la repetida no se cuenta dos veces");
  assert.deepEqual(buttonRules("Eres Lia. Responde corto."), []);
  assert.deepEqual(buttonRules(null), []);
  assert.equal(buttonRules(Array.from({ length: 20 }, (_, i) => `Regla ${i}: usa botones.`).join("\n")).length, 12);
});

test("el paso de los botones lee las reglas del negocio antes del mensaje; sin reglas, solo el mensaje", () => {
  const input = replyOptionsInput("¿Cómo prefieres pagar?", ["Al preguntar cómo quiere pagar, usa los botones «Yape» y «Transferencia»."]);
  assert.equal(input, "## Reglas del negocio sobre botones\n- Al preguntar cómo quiere pagar, usa los botones «Yape» y «Transferencia».\n\n## Mensaje\n¿Cómo prefieres pagar?");
  assert.equal(replyOptionsInput("¿Cómo prefieres pagar?", []), "¿Cómo prefieres pagar?");
  assert.match(REPLY_OPTIONS_SYSTEM, /usa exactamente los textos que indica/);
});

test("en la bandeja, el agente pasa sus reglas de botones y sale con los textos que eligió el negocio", async () => {
  const { service, calls } = agent({
    prompt: PROMPT,
    replies: [text("¡Genial, Ana! ¿Cómo prefieres pagar?"), text('{"options": ["Yape", "Transferencia", "Tarjeta"]}')],
  });
  const r = await service.suggest("cv1");
  assert.deepEqual(r.options, ["Yape", "Transferencia", "Tarjeta"]);
  assert.match(calls[1]!.messages[0].content, /## Reglas del negocio sobre botones\n- Al preguntar cómo quiere pagar, usa los botones «Yape», «Transferencia» y «Tarjeta»\./);
  assert.match(calls[1]!.messages[0].content, /## Mensaje\n¡Genial, Ana! ¿Cómo prefieres pagar\?$/);
  // Al agente: con reglas propias basta la pregunta.
  assert.match(calls[0]!.system, /Si tus instrucciones dicen qué botones usar en un caso, haz la pregunta y no escribas el texto de los botones/);
});

test("si el agente escribe una línea «[Botones: …]», se quita: nunca le llega al cliente", async () => {
  assert.equal(stripOptionsNote("¿Te separo un cupo?\n[Botones: Sí, sepárame · Tengo dudas]"), "¿Te separo un cupo?");
  assert.equal(stripOptionsNote("Hola\n\n[botones: A · B]\n\n¿Seguimos?"), "Hola\n\n¿Seguimos?");
  assert.equal(stripOptionsNote("Pulsa el botón de abajo [Botones son opcionales]"), "Pulsa el botón de abajo [Botones son opcionales]", "solo líneas enteras con esa forma");
  const { service } = agent({
    tools: [],
    replies: [text("El precio es 50 USD. ¿Quieres los datos de pago?\n[Botones: Datos de pago · Ver temario]")],
  });
  assert.equal((await service.suggest("cv1")).suggestion, "El precio es 50 USD. ¿Quieres los datos de pago?");
});

test("en la prueba y el simulador, el historial llega con la nota (la usa el cliente simulado) y al agente se le quita", async () => {
  const service = Object.create(AgentService.prototype) as AgentService & Row;
  service.logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
  service.prisma = {
    agentConfig: { findUnique: async () => ({ id: "bot1", systemPrompt: "Eres Lia.", enabledTools: [], model: "gpt-4.1-mini", maxIterations: 4 }) },
    productField: { findMany: async () => [] },
    customField: { findMany: async () => [] },
    // El agente lee los datos del lead abierto del contacto (aquí, ninguno).
    deal: { findFirst: async () => null },
  };
  service.actions = { loadContext: async () => ({}) };
  service.bookings = { agentContextText: async () => "" };
  service.knowledge = { retrieve: async () => [] };
  const calls: Row[] = [];
  service.llm = {
    name: "openai",
    generate: async (req: Row) => {
      calls.push(JSON.parse(JSON.stringify(req)));
      return { ...text("¡Listo, Ana!"), usage: { inputTokens: 10, outputTokens: 5 }, model: "gpt-4.1-mini" };
    },
  };
  await service.playground({
    message: "Sí, sepárame",
    botId: "bot1",
    history: [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "¿Te separo un cupo?\n[Botones: Sí, sepárame · Tengo dudas]" },
    ],
  });
  assert.equal(calls[0]!.messages[1].content, "¿Te separo un cupo?");
});
