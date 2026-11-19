/**
 * «¿Por qué respondió esto?»: la traza de una respuesta real de la IA (qué
 * entendió, qué consultó y qué hizo) y el enlace de cada mensaje del autopilot
 * con su respuesta. Sin base de datos: dobles de Prisma y de la mensajería.
 *
 *   npm run test:aitrace --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AiTraceService } from "../src/modules/ai/ai-trace.service";
import { AutopilotService } from "../src/modules/ai/autopilot.service";

type Row = Record<string, any>;

const RUN = {
  id: "run1",
  conversationId: "cv1",
  status: "COMPLETED",
  createdAt: new Date("2026-11-19T10:00:00Z"),
  model: "gpt-4.1-mini",
  latencyMs: 3400,
  inputTokens: 9000,
  outputTokens: 120,
  costUsd: "0.004100",
  classification: { intent: "consulta_precio", sentiment: "neutral", urgency: "low", requiresHuman: false },
  confidence: 0.85,
  escalationReason: null,
  agentConfig: { name: "Venta flyteek" },
  toolCalls: [
    {
      toolName: "search_products",
      input: { query: "genómica" },
      output: { result: JSON.stringify({ total: 1, note: 'Resultados para "genómica".', products: [{ name: "Genómica bacteriana", missingDetails: ["Temario"] }] }) },
      status: "EXECUTED",
    },
    { toolName: "move_deal_stage", input: { stage: "Interesado" }, output: { result: "Movería la oportunidad a «Interesado»." }, status: "PENDING_APPROVAL" },
    { toolName: "add_tag", input: { tag: "Empresa" }, output: null, status: "REJECTED" },
  ],
};

function traces(opts: { conversation?: boolean } = {}) {
  const asked: Row[] = [];
  const prisma = {
    conversation: { findUnique: async () => (opts.conversation === false ? null : { id: "cv1" }) },
    aiRun: {
      findFirst: async (args: Row) => {
        asked.push(args.where);
        return args.where.id === RUN.id && args.where.conversationId === RUN.conversationId ? RUN : null;
      },
    },
  };
  return { service: new AiTraceService(prisma as any), asked };
}

test("la traza dice qué entendió, qué consultó y qué encontró, y el estado de cada acción", async () => {
  const { service } = traces();
  const t = await service.trace("cv1", "run1");
  assert.equal(t.agentName, "Venta flyteek");
  assert.equal(t.costUsd, 0.0041);
  assert.equal(t.classification?.intent, "consulta_precio");
  assert.deepEqual(t.steps, [
    { name: "search_products", input: "«genómica»", summary: "Encontró 1: Genómica bacteriana. Sin dato en el producto: «Temario».", status: "EXECUTED" },
    { name: "move_deal_stage", input: "«Interesado»", summary: "Movería la oportunidad a «Interesado».", status: "PENDING_APPROVAL" },
    { name: "add_tag", input: "«Empresa»", summary: "", status: "REJECTED" },
  ]);
});

test("solo se ve una respuesta de la propia conversación: la de otra da 404, igual que una conversación ajena", async () => {
  const { service, asked } = traces();
  await assert.rejects(() => service.trace("cv2", "run1"), /no es de esta conversación/);
  assert.deepEqual(asked.at(-1), { id: "run1", conversationId: "cv2" }, "se busca la respuesta dentro de la conversación pedida");
  await assert.rejects(() => traces({ conversation: false }).service.trace("cv1", "run1"), /Conversación no encontrada/);
});

test("cada mensaje que envía el autopilot queda enlazado con su respuesta, también en varios mensajes cortos", async () => {
  for (const split of [false, true]) {
    const sent: Row[] = [];
    const service = Object.create(AutopilotService.prototype) as Row;
    service.logger = { log: () => undefined, warn: () => undefined };
    service.bots = { resolveForConversation: async () => ({ splitReplies: split }) };
    service.messaging = { queueOutbound: async (input: Row, author: string, opts: Row) => sent.push({ text: input.text, author, opts }) };
    service.showTyping = async () => undefined;
    await service.sendReply(
      "cv1",
      "¡Hola, Ana! 👋 Te confirmo los detalles del curso.\n\nGenómica bacteriana empieza el 29 de junio, en vivo por Zoom.",
      { channelId: null, contactId: "ct1" },
      "run1",
    );
    assert.ok(sent.length >= 1);
    assert.equal(sent.length > 1, split);
    for (const m of sent) {
      assert.equal(m.author, "AI");
      assert.deepEqual(m.opts, { aiRunId: "run1" });
    }
  }
});
