/**
 * Asistente de redacción de prompts: parte pura (sin modelo ni base de datos).
 *
 *   npm run test:promptassist --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PROMPT_CONTEXT,
  buildSystem,
  buildUserTurn,
  fallbackTemplate,
  parseReply,
  type PromptContext,
  referencePrompt,
  proposalIssues,
  fixRequest,
} from "../src/modules/ai/prompt-assistant.prompt";

const ctx: PromptContext = {
  ...EMPTY_PROMPT_CONTEXT,
  orgName: "Zapatería Lima",
  products: {
    total: 2,
    sample: [{ name: "Runner X", price: "PEN 199" }],
    fields: ["Talla", "Garantía (meses)"],
    hiddenFields: ["Costo interno"],
    currencies: ["PEN", "USD"],
    withImage: 2,
  },
  stages: ["Entrantes", "Contactado", "Ganado"],
  tools: [
    { name: "search_products", description: "Busca en el catálogo", enabled: true, unavailable: null },
    { name: "add_tag", description: "Etiqueta", enabled: false, unavailable: null },
  ],
};

test("el system prompt lleva el contexto real y separa herramientas habilitadas", () => {
  const s = buildSystem(ctx, "systemPrompt");
  assert.match(s, /Zapatería Lima/);
  assert.match(s, /Runner X \(PEN 199\)/);
  assert.match(s, /Entrantes → Contactado → Ganado/);
  assert.match(s, /HABILITADAS[\s\S]*search_products/);
  assert.match(s, /NO están habilitadas[\s\S]*add_tag/);
  assert.match(s, /"proposal"/);
});

test("el ejemplo de referencia solo nombra lo que la cuenta tiene", () => {
  const tool = (name: string, enabled: boolean) => ({ name, description: "", enabled, unavailable: null });
  const full = { ...ctx, stages: ["Entrantes", "Contactado", "Interesado", "Matrícula en proceso", "Inscrito", "Perdido"], tools: ["search_products", "search_knowledge", "handoff_to_human", "mark_lead", "move_deal_stage", "send_payment_methods", "send_product_file", "reply_with_buttons"].map((n) => tool(n, true)) };
  const all = referencePrompt(full);
  assert.match(all, /1\. BOTONES: solo usas botones cuando preguntas si quiere separar su cupo/);
  assert.match(all, /Usa send_payment_methods y luego responde EXACTAMENTE/);
  assert.match(all, /move_deal_stage a «Matrícula en proceso»/);

  const few = referencePrompt({ ...ctx, stages: ["A", "B", "C"], tools: [tool("search_knowledge", true), tool("handoff_to_human", true), tool("send_payment_methods", false), tool("reply_with_buttons", false), tool("move_deal_stage", true)] });
  assert.doesNotMatch(few, /send_payment_methods|send_product_file|search_products|botones|move_deal_stage/, "ni herramientas que no tiene ni una etapa inventada");
  assert.match(few, /Indícale cómo pagar con lo que diga la información del negocio/);
  assert.doesNotMatch(few, /\n\n\n/);
  // El redactor lo recibe ya armado, sin el hueco.
  assert.doesNotMatch(buildSystem(full, "systemPrompt"), /\{\{REFERENCIA\}\}/);
  assert.match(buildSystem(full, "systemPrompt"), /Eres Vale, asesora de ventas de Academia Nova/);
});

test("se detecta lo que unas instrucciones nombran y la cuenta no tiene", () => {
  const tool = (name: string, enabled: boolean) => ({ name, description: "", enabled, unavailable: null });
  const c = { stages: ["Nuevo", "Contactado", "Ganado"], tools: [tool("search_products", true), tool("move_deal_stage", true), tool("send_payment_methods", false)] };
  assert.deepEqual(proposalIssues("Usa search_products y move_deal_stage a «contactado».", c), []);
  const issues = proposalIssues("Usa send_payment_methods. Luego move_deal_stage a «Matrícula en proceso» y otra vez send_payment_methods.", c);
  assert.equal(issues.length, 2);
  assert.match(issues[0]!, /send_payment_methods, que no está habilitada/);
  assert.match(issues[1]!, /«Matrícula en proceso», que no es una etapa del embudo \(Nuevo, Contactado, Ganado\)/);
  assert.match(fixRequest(issues), /Devuelve el texto completo corregido/);
});

test("cada campo tiene sus propias reglas de formato", () => {
  assert.match(buildSystem(ctx, "welcomeMessage"), /menos de 300 caracteres/);
  assert.match(buildSystem(ctx, "systemPrompt"), /# FLUJO DE LA CONVERSACIÓN/);
  assert.doesNotMatch(buildSystem(ctx, "welcomeMessage"), /# FLUJO DE LA CONVERSACIÓN/);
});

test("el turno del usuario incluye el texto actual cuando existe", () => {
  const base = {
    prompt: "hazlo más corto",
    target: "systemPrompt" as const,
    botName: "Ventas",
    enabledTools: [],
    history: [],
  };
  assert.match(buildUserTurn({ ...base, current: "" }), /El campo está vacío/);
  assert.match(buildUserTurn({ ...base, current: "Eres un bot" }), /Texto actual[\s\S]*Eres un bot/);
  assert.match(buildUserTurn({ ...base, current: "" }), /Agente: "Ventas"/);
});

test("parsea JSON limpio, con vallas y con prosa alrededor", () => {
  const limpio = parseReply('{"message":"Listo","proposal":"Eres X"}');
  assert.deepEqual(limpio, { message: "Listo", proposal: "Eres X" });

  const vallado = parseReply('Aquí va:\n```json\n{"message":"ok","proposal":"A\\nB"}\n```');
  assert.equal(vallado.proposal, "A\nB");

  // Saltos de línea crudos dentro de la cadena (JSON inválido, pero frecuente).
  const crudo = parseReply('{"message":"ok",\n"proposal":"ROL\nEres X.\n\nTONO\nCorto."}');
  assert.equal(crudo.proposal, "ROL\nEres X.\n\nTONO\nCorto.");
  assert.equal(crudo.message, "ok");

  const soloPregunta = parseReply('{"message":"¿Qué vendes?","proposal":null}');
  assert.equal(soloPregunta.proposal, null);
  assert.equal(soloPregunta.message, "¿Qué vendes?");
});

test("sin JSON: un texto largo es propuesta y uno corto es respuesta", () => {
  const largo = parseReply("Eres un agente. ".repeat(40));
  assert.ok(largo.proposal && largo.proposal.length > 400);

  const corto = parseReply("¿Qué vende tu negocio?");
  assert.equal(corto.proposal, null);
  assert.equal(corto.message, "¿Qué vende tu negocio?");
});

test("la plantilla sin API key cita solo herramientas habilitadas", () => {
  const input = {
    prompt: "x",
    target: "systemPrompt" as const,
    current: "",
    botName: "Ana",
    enabledTools: ["search_products"],
    history: [],
  };
  const fb = fallbackTemplate("systemPrompt", ctx, input);
  assert.match(fb.message, /API key/);
  assert.match(fb.proposal ?? "", /Eres Ana, el asistente de ventas de Zapatería Lima/);
  assert.match(fb.proposal ?? "", /search_products/);
  assert.doesNotMatch(fb.proposal ?? "", /search_knowledge/);
  assert.doesNotMatch(fb.proposal ?? "", /handoff_to_human/);
});

test("el asistente sabe qué trae cada producto y pide consultarlo, no copiarlo", () => {
  const s = buildSystem(ctx, "systemPrompt");
  assert.match(s, /nombre, precio, descripción y SKU, y además: Talla, Garantía \(meses\)/);
  assert.match(s, /NUNCA copies esos valores ni dejes marcadores como \[Precio\]/);
  assert.match(s, /nómbralos con su nombre exacto entre comillas angulares/, "así el editor los marca como datos del producto");
  assert.match(s, /La plantilla que presenta un producto parte del speech sugerido/, "pide el speech de producto");
  assert.match(s, /Speech sugerido para presentar un producto[\s\S]*• Talla: «Talla»/, "con los campos reales del catálogo");
  assert.match(s, /varias monedas \(PEN, USD\)/);
  assert.match(s, /2 producto\(s\) tienen foto/);
  assert.match(s, /NO ve \(apagados para la IA\): Costo interno/);
  // Sin productos no se habla de campos.
  assert.doesNotMatch(buildSystem({ ...ctx, products: EMPTY_PROMPT_CONTEXT.products }, "systemPrompt"), /search_products: nombre/);
});
