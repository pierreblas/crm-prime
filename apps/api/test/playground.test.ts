/**
 * «Probar conversación»: que se pruebe igual que con un cliente de verdad (los
 * campos del catálogo y del contacto, el país del cliente de prueba, los
 * mensajes cortos), que se vea qué consultó el agente y que un producto diga
 * qué datos no tiene. Con un modelo de mentira: no gasta tokens.
 *
 *   npm run test:playground --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { productPitchTemplate } from "@crm/shared";
import { AgentService } from "../src/modules/ai/agent.service";
import { traceToolCall } from "../src/modules/ai/playground-trace";

type Row = Record<string, any>;

const PRODUCT = {
  id: "p1",
  name: "Genómica bacteriana",
  price: 290,
  currency: "PEN",
  sku: null,
  description: "Curso en vivo por Zoom",
  imageUrl: null,
  attributes: { fechas: "29 de junio", temario: "https://flyteek.com/temario" },
  prices: [{ currency: "USD", amount: 80 }],
};

function setup(opts: { splitReplies?: boolean; replies?: Row[]; tools?: string[]; knowledge?: string[] } = {}) {
  const calls: Row[] = [];
  const replies = opts.replies ?? [
    { stopReason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "search_products", input: { query: "genómica" } }] },
    { stopReason: "end_turn", content: [{ type: "text", text: "Hola Ana 👋\n\nEl curso cuesta USD 80." }] },
  ];
  const service = Object.create(AgentService.prototype) as AgentService & Row;
  service.logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
  service.prisma = {
    agentConfig: {
      findUnique: async () => ({
        id: "bot1",
        orgId: "org1",
        systemPrompt: "Eres Lia. Trata al cliente por su nombre, {{nombre}}, de {{pais}}. Presenta «Fechas» y «Temario».",
        enabledTools: opts.tools ?? ["search_products"],
        splitReplies: !!opts.splitReplies,
        model: "gpt-4.1-mini",
        effort: "medium",
        maxIterations: 4,
      }),
    },
    productField: {
      findMany: async ({ where }: Row = {}) =>
        [
          { key: "fechas", label: "Fechas", type: "text", unit: null, aiVisible: true },
          { key: "temario", label: "Temario", type: "url", unit: null, aiVisible: true },
          { key: "oferta", label: "Oferta", type: "text", unit: null, aiVisible: true },
        ].filter((f) => !where?.aiVisible || f.aiVisible),
    },
    customField: { findMany: async () => [{ key: "empresa", label: "Empresa" }] },
    product: {
      count: async () => 1,
      findMany: async () => [PRODUCT],
    },
    $queryRaw: async () => [{ id: "p1" }],
  };
  service.bots = { resolveForChannel: async () => null };
  service.actions = { loadContext: async () => ({}) };
  service.bookings = { agentContextText: async () => "" };
  service.knowledge = { retrieve: async () => opts.knowledge ?? [] };
  service.llm = {
    name: "openai",
    generate: async (req: Row) => {
      calls.push(JSON.parse(JSON.stringify(req)));
      const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
      return { ...r, usage: { inputTokens: 100, outputTokens: 10 }, model: "gpt-4.1-mini" };
    },
  };
  return { service, calls };
}

test("se prueba como un cliente de verdad: su nombre y su país rellenan las variables y el catálogo da su moneda", async () => {
  const { service, calls } = setup();
  const r = await service.playground({ message: "hola, cuánto cuesta genómica?", botId: "bot1", history: [], contact: { name: "Ana", phone: "+1 555 0100" } });
  const system = calls[0]!.system as string;
  assert.match(system, /su nombre, Ana, de Estados Unidos o Canadá/, "{{nombre}} y {{pais}} con el cliente de prueba");
  assert.match(system, /además estos datos: Fechas, Temario, Oferta/, "como en una conversación real: sabe qué campos trae cada producto");
  assert.match(calls[0]!.systemDynamic, /Contacto actual: Ana \(\+15550100\)/);
  // El resultado del catálogo que vio el modelo: precio en USD (la moneda del cliente) y lo que le falta al producto.
  const toolResult = JSON.parse(calls[1]!.messages.at(-1).content[0].content);
  assert.equal(toolResult.clientCurrency, "USD");
  assert.equal(toolResult.products[0].price, 80);
  assert.deepEqual(toolResult.products[0].details, { Fechas: "29 de junio", Temario: "https://flyteek.com/temario" });
  assert.deepEqual(toolResult.products[0].missingDetails, ["Oferta"]);
  assert.deepEqual(
    r.toolCalls.map(({ evidence: _e, ...c }) => c),
    [{ name: "search_products", input: "«genómica»", summary: "Encontró 1: Genómica bacteriana. Sin dato en el producto: «Oferta»." }],
  );
  // Con lo que devolvió, para que la revisión del simulador compruebe los datos.
  assert.match(r.toolCalls[0]!.evidence ?? "", /"price":80/);
});

test("sin cliente elegido, uno de prueba sin país; los datos que faltan se quitan, no se inventan", async () => {
  const { service, calls } = setup();
  await service.playground({ message: "hola", botId: "bot1", history: [] });
  const system = calls[0]!.system as string;
  assert.match(system, /su nombre, Cliente de prueba, de \(sin dato\)/);
  assert.match(system, /quita esa línea o esa parte del mensaje: nunca lo inventes/);
  assert.match(system, /Los resultados de turnos anteriores ya no los ves/);
});

test("con «varios mensajes cortos» la prueba también los pide y avisa para pintarlos por separado", async () => {
  const { service, calls } = setup({ splitReplies: true });
  const r = await service.playground({ message: "hola", botId: "bot1", history: [] });
  assert.match(calls[0]!.system, /Cada párrafo se enviará como un mensaje aparte/);
  assert.equal(r.splitReplies, true);
  assert.equal(r.reply, "Hola Ana 👋\n\nEl curso cuesta USD 80.");
});

test("el resumen de cada consulta dice qué encontró, si listó el catálogo y qué dio el conocimiento", () => {
  const listed = traceToolCall(
    "search_products",
    { query: "robótica" },
    JSON.stringify({ total: 12, note: 'Sin coincidencias exactas para "robótica"; se lista el catálogo completo.', products: Array.from({ length: 6 }, (_, i) => ({ name: `Curso ${i + 1}` })) }),
  );
  assert.equal(listed.summary, "Sin coincidencias: listó el catálogo (12): Curso 1, Curso 2, Curso 3, Curso 4 y 2 más.");
  assert.equal(traceToolCall("search_products", {}, JSON.stringify({ total: 0, products: [] })).summary, "El catálogo está vacío.");
  assert.equal(traceToolCall("search_knowledge", { query: "yape" }, JSON.stringify([{ doc: "Pagos", content: "…" }, { doc: "Pagos", content: "…" }])).summary, "2 fragmentos de «Pagos».");
  assert.equal(traceToolCall("search_knowledge", { query: "x" }, "[]").summary, "No encontró nada en el conocimiento.");
  assert.equal(traceToolCall("move_deal_stage", { stage: "Interesado" }, "Movería a la etapa «Interesado»").input, "«Interesado»", "un solo texto va tal cual");
  assert.equal(traceToolCall("add_tag", { tag: "Empresa", note: 3 }, "ok").input, '{"tag":"Empresa","note":3}');
});

test("el speech de producto usa los campos del catálogo entre « » y no lleva ningún valor", () => {
  const s = productPitchTemplate(["Fechas", "Temario", "precio", "Fechas", " "], { photo: true });
  assert.match(s, /^PRESENTACIÓN DE UN PRODUCTO\n/);
  assert.ok(s.includes("*«Nombre»*") && s.includes("💰 «Precio»"));
  assert.ok(s.includes("• Fechas: «Fechas»") && s.includes("• Temario: «Temario»"));
  assert.equal((s.match(/• Fechas/g) ?? []).length, 1, "sin repetir");
  assert.ok(!s.includes("• precio"), "«Precio» ya va como dato de siempre");
  assert.match(s, /send_product_image/);
  assert.match(s, /quita esa línea: nunca lo inventes/);
  assert.doesNotMatch(productPitchTemplate([]), /send_product_image|•/);
});

test("la búsqueda automática en el conocimiento también sale en lo que consultó", async () => {
  const { service } = setup({
    tools: ["search_products", "search_knowledge"],
    knowledge: ["Pagos: Yape al 999…", "Certificado UNALM: trámite de 2 semanas."],
  });
  const r = await service.playground({ message: "cómo pago?", botId: "bot1", history: [] });
  const { evidence, ...first } = r.toolCalls[0]!;
  assert.deepEqual(first, { name: "search_knowledge", input: "«cómo pago?»", summary: "2 fragmentos." });
  assert.match(evidence ?? "", /Pagos: Yape al 999/);
  assert.equal(r.toolCalls[1]?.name, "search_products");
});

test("todo agente tiene la regla de no inventar datos de pago, y con handoff_to_human pasa el chat si no los tiene", async () => {
  const withHandoff = setup({ tools: ["search_products", "handoff_to_human"] });
  await withHandoff.service.playground({ message: "Yape", botId: "bot1", history: [] });
  const system = withHandoff.calls[0]!.system as string;
  assert.match(system, /Datos de pago \(número de cuenta o CCI, Yape, Plin, Nequi, enlace de pago/);
  assert.match(system, /Nunca los inventes, no los completes ni des uno de ejemplo/);
  assert.match(system, /una persona del equipo se los envía enseguida y llama a handoff_to_human en ese mismo turno\./);

  const alone = setup({ tools: [] });
  await alone.service.playground({ message: "Yape", botId: "bot1", history: [] });
  assert.match(alone.calls[0]!.system as string, /una persona del equipo se los envía enseguida\.$/m);
  assert.doesNotMatch(alone.calls[0]!.system as string, /handoff_to_human en ese mismo turno/);
});
