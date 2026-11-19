/**
 * «Lo que preguntan y falta»: al consultar el catálogo la IA dice qué dato pide
 * el cliente; si el producto no lo tiene, se guarda con la llamada (sin que el
 * modelo lo vea) y Productos lo cuenta por producto y campo, solo mientras siga
 * vacío. Sin base de datos ni modelo: dobles de Prisma.
 *
 *   npm run test:cataloggaps --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AgentService } from "../src/modules/ai/agent.service";
import { EMPTY_TOOL_CONTEXT, TOOL_REGISTRY, resolveTools, searchProductsTool } from "../src/modules/ai/tools.registry";
import { traceToolCall } from "../src/modules/ai/playground-trace";
import { CatalogGapsService } from "../src/modules/products/catalog-gaps.service";

type Row = Record<string, any>;

const FIELDS = [
  { key: "fechas", label: "Fechas", type: "text", unit: null, aiVisible: true },
  { key: "temario", label: "Temario", type: "url", unit: null, aiVisible: true },
];
const GENOMICA = {
  id: "p1",
  name: "Genómica bacteriana",
  price: 290,
  currency: "PEN",
  sku: null,
  description: "Curso en vivo",
  imageUrl: null,
  attributes: { fechas: "29 de junio" },
  prices: [],
};
const CONTACT = { id: "ct1", name: "Ana", phone: "+51999", optIn: true, lastMessageAt: null, metadata: {} };

/** El agente con un catálogo de un producto (o una búsqueda sin coincidencias, que lista el catálogo). */
function agent(opts: { match?: boolean } = {}) {
  const saved: Row[] = [];
  const service = Object.create(AgentService.prototype) as Row;
  service.prisma = {
    productField: { findMany: async () => FIELDS },
    product: { count: async () => 1, findMany: async () => [GENOMICA] },
    $queryRaw: async () => (opts.match === false ? [] : [{ id: "p1" }]),
    aiToolCall: { create: async ({ data }: Row) => saved.push(data) },
  };
  const search = (input: Row) =>
    service.runTool("run1", CONTACT, { type: "tool_use", id: "t1", name: "search_products", input }, false, "cv1");
  return { search, saved };
}

test("search_products lleva «asks» con los campos reales del catálogo; sin campos, la de siempre", () => {
  const tool = searchProductsTool(["Fechas", "Temario", "Fechas", " "]);
  const asks = (tool.input_schema as Row).properties.asks;
  assert.deepEqual(asks.items.enum, ["Fechas", "Temario"]);
  assert.equal(asks.type, "array");
  assert.ok((tool.input_schema as Row).properties.query, "conserva la búsqueda");
  assert.equal(searchProductsTool([]), TOOL_REGISTRY.search_products);
  assert.equal(searchProductsTool(undefined), TOOL_REGISTRY.search_products);
  const [resolved] = resolveTools(["search_products"], { ...EMPTY_TOOL_CONTEXT, productFields: ["Temario"] });
  assert.deepEqual((resolved!.input_schema as Row).properties.asks.items.enum, ["Temario"]);
});

test("si el cliente pide un dato que el producto no tiene, se guarda con la consulta, pero el modelo no lo ve", async () => {
  const { search, saved } = agent();
  const r = await search({ query: "genómica", asks: ["Temario", "Fechas"] });
  assert.deepEqual(saved[0]!.output.gaps, [{ productId: "p1", field: "Temario" }], "Fechas sí lo tiene");
  assert.equal(saved[0]!.output.result, r.output);
  assert.doesNotMatch(r.output, /gaps|productId/);
  const seen = JSON.parse(r.output);
  assert.deepEqual(seen.products[0].missingDetails, ["Temario"]);
  // Y se lo dice en el momento, no solo en las reglas: con la regla sola se lo inventaba a veces.
  assert.match(seen.note, /El cliente pide «Temario» y este producto no lo trae en «details»/);
  assert.match(seen.note, /no lo inventes/);
});

test("no se cuenta nada sin dato pedido, sin búsqueda o si la búsqueda no encontró el producto", async () => {
  for (const [input, match] of [
    [{ query: "genómica" }, true],
    [{ query: "genómica", asks: ["Fechas"] }, true],
    [{ query: "", asks: ["Temario"] }, true],
    [{ query: "robótica", asks: ["Temario"] }, false],
  ] as const) {
    const { search, saved } = agent({ match });
    const r = await search(input);
    assert.equal(saved[0]!.output.gaps, undefined, JSON.stringify(input));
    assert.doesNotMatch(JSON.parse(r.output).note, /El cliente pide/);
  }
});

test("la traza dice qué pidió el cliente y que el producto no lo tiene", () => {
  const out = JSON.stringify({ total: 1, note: 'Resultados para "genómica".', products: [{ name: "Genómica bacteriana", missingDetails: ["Temario", "Oferta"] }] });
  const t = traceToolCall("search_products", { query: "genómica", asks: ["Temario", "Fechas"] }, out);
  assert.equal(t.input, "«genómica» · pide «Temario», «Fechas»");
  assert.equal(t.summary, "Encontró 1: Genómica bacteriana. Pidió «Temario» y no está en los campos del producto. Sin dato en el producto: «Oferta».");
  assert.equal(traceToolCall("search_products", { query: "" }, JSON.stringify({ total: 0, products: [] })).input, "");
});

// ── Lo que ve Productos ─────────────────────────────────────────
const day = (n: number) => new Date(Date.UTC(2026, 10, 19 - n, 12));

function gaps(rows: Row[], products: Row[]) {
  const sql: { text: string; values: unknown[] }[] = [];
  const prisma = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push({ text: strings.join("?"), values });
      return rows;
    },
    product: {
      findMany: async ({ where }: Row) =>
        products.filter((p) => where.id.in.includes(p.id)).map((p) => ({ prices: [], source: null, createdAt: day(90), isActive: true, ...p })),
    },
    productField: { findMany: async () => FIELDS.map(({ key, label }) => ({ key, label })) },
  };
  const tenant = { orgId: () => "org1" };
  return { service: new CatalogGapsService(prisma as any, tenant as any), sql };
}

test("Productos cuenta clientes distintos por producto y dato, del más pedido al menos", async () => {
  const P2 = { ...GENOMICA, id: "p2", name: "Bioinformática", attributes: {} };
  const { service, sql } = gaps(
    [
      { gaps: [{ productId: "p1", field: "Temario" }], at: day(1), conversationId: "cv3" },
      { gaps: [{ productId: "p2", field: "Fechas" }], at: day(2), conversationId: "cv9" },
      { gaps: [{ productId: "p1", field: "Temario" }], at: day(3), conversationId: "cv3" },
      { gaps: [{ productId: "p1", field: "Temario" }], at: day(5), conversationId: "cv1" },
      { gaps: "basura", at: day(6), conversationId: "cv7" },
    ],
    [GENOMICA, P2],
  );
  const list = await service.list();
  assert.deepEqual(
    list.map((g) => [g.product.name, g.field, g.fieldKey, g.conversations, g.lastConversationId, g.lastAskedAt]),
    [
      ["Genómica bacteriana", "Temario", "temario", 2, "cv3", day(1).toISOString()],
      ["Bioinformática", "Fechas", "fechas", 1, "cv9", day(2).toISOString()],
    ],
  );
  // Las llamadas a herramientas no llevan orgId: la consulta se acota por la conversación de la empresa.
  assert.match(sql[0]!.text, /c\."orgId" = \?/);
  assert.ok(sql[0]!.values.includes("org1"));
});

test("lo ya completado, un producto inactivo o borrado y un campo renombrado dejan de salir", async () => {
  const { service } = gaps(
    [
      { gaps: [{ productId: "p1", field: "Fechas" }], at: day(1), conversationId: "cv1" },
      { gaps: [{ productId: "p3", field: "Temario" }], at: day(1), conversationId: "cv2" },
      { gaps: [{ productId: "p4", field: "Temario" }], at: day(1), conversationId: "cv3" },
      { gaps: [{ productId: "p1", field: "Horario" }], at: day(1), conversationId: "cv4" },
    ],
    [GENOMICA, { ...GENOMICA, id: "p3", isActive: false, attributes: {} }],
  );
  assert.deepEqual(await service.list(), []);
});
