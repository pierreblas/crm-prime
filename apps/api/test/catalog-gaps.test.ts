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
  // Lo que pregunta el cliente, no lo que lleva la presentación del agente: si no, cada presentación «pide» sus propios datos.
  assert.match(asks.description, /con sus palabras/);
  assert.match(asks.description, /presentación/);
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
  assert.match(seen.note, /Este producto no trae: «Temario»\./);
  assert.match(seen.note, /no lo inventes ni lo supongas/);
  // La línea de la presentación se quita entera: salía «Temario: No especificado» o rellena con la descripción.
  assert.match(seen.note, /quítala entera, con su emoji y su etiqueta/);
  assert.match(seen.note, /no escribas «No especificado», «No disponible» ni «Por confirmar»/);
  // Y sin ordenarle que se lo diga al cliente. Quien «pide» el dato suele ser la presentación del agente,
  // y el cliente acababa leyendo «no tengo el temario» sin haberlo preguntado, dijeran lo que dijeran las instrucciones.
  assert.match(seen.note, /no le digas al cliente que falta si no lo ha preguntado/);
  // Si lo pregunta, que el catálogo no lo traiga no quiere decir que el agente no lo sepa: puede estar en
  // sus instrucciones o en el conocimiento. Con «no lo tienes» respondía «no tengo esa información» aunque
  // el dueño acabara de escribírsela en el agente.
  assert.match(seen.note, /Si el cliente preguntó con sus palabras por «Temario»: si tus instrucciones o el conocimiento lo dicen, respóndelo con eso/);
  assert.match(seen.note, /sin decir antes que el producto no lo especifica/);
  // Y si no está en ningún sitio, lo que el dueño mandó para lo que no sabe; sin regla, decirlo con naturalidad.
  assert.match(seen.note, /haz lo que tus instrucciones mandan para lo que no sabes/);
  assert.match(seen.note, /si no mandan nada, dile con naturalidad que ese dato no lo tienes a mano/);
  assert.doesNotMatch(seen.note, /details|dilo y sigue/);
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
    const note = JSON.parse(r.output).note as string;
    assert.doesNotMatch(note, /preguntó con sus palabras/);
    // Lo que falta se dice igual aunque nadie lo pida (la presentación puede llevarlo); en un listado, no.
    assert.equal(/Este producto no trae: «Temario»/.test(note), match && !!input.query, JSON.stringify(input));
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
