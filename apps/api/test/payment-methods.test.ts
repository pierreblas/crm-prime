/**
 * Métodos de pago: el agente no escribe datos de pago; el sistema envía el
 * texto que cargó la empresa, tal cual y solo con los métodos del país del
 * cliente. Qué le toca a cada país, el mensaje exacto, lo que lee el agente
 * cuando no hay nada que enviar (para que no invente) y la regla del prompt.
 * Sin base de datos ni modelo: dobles.
 *
 *   npm run test:payments --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PAYMENT_METHODS_TOOL, paymentMethodsFor, paymentMethodsText, type PaymentMethodDto } from "@crm/shared";
import { AgentActionsService } from "../src/modules/ai/agent-actions.service";
import { AgentService } from "../src/modules/ai/agent.service";
import { EMPTY_TOOL_CONTEXT, availableTools, resolveTools } from "../src/modules/ai/tools.registry";

const method = (o: Partial<PaymentMethodDto> & { name: string }): PaymentMethodDto => ({
  id: o.name,
  countries: [],
  details: "",
  instructions: "",
  imageUrl: null,
  isActive: true,
  order: 0,
  ...o,
});

const YAPE = method({ name: "Yape", countries: ["PE"], details: "987 654 321\nA nombre de: Flyteek SAC", instructions: "Envía tu comprobante por aquí", imageUrl: "storage://qr-yape", order: 0 });
const BCP = method({ name: "Transferencia BCP", countries: ["PE"], details: "Cuenta: 191-1234567-0-12\nCCI: 002-191-001234567012-55", order: 1 });
const SPEI = method({ name: "SPEI", countries: ["MX"], details: "CLABE: 012 180 01234567890 1", order: 2 });
const PAYPAL = method({ name: "PayPal", details: "https://paypal.me/flyteek", order: 3 });
const VIEJO = method({ name: "Plin", countries: ["PE"], details: "999", isActive: false, order: 4 });
const ALL = [PAYPAL, SPEI, VIEJO, BCP, YAPE];

test("a cada cliente, los de su país y los de «todos», en el orden de la lista y sin los pausados", () => {
  assert.deepEqual(paymentMethodsFor(ALL, "PE").map((m) => m.name), ["Yape", "Transferencia BCP", "PayPal"]);
  assert.deepEqual(paymentMethodsFor(ALL, "MX").map((m) => m.name), ["SPEI", "PayPal"]);
  assert.deepEqual(paymentMethodsFor(ALL, "CO").map((m) => m.name), ["PayPal"], "sin método propio, solo los de todos");
  assert.deepEqual(paymentMethodsFor(ALL, null).map((m) => m.name), ["PayPal"], "sin saber el país (Instagram), solo los de todos");
  assert.deepEqual(paymentMethodsFor(ALL, "PE", ["yape "]).map((m) => m.name), ["Yape"], "si pidió uno en concreto");
  assert.deepEqual(paymentMethodsFor(ALL, "MX", ["Yape"]), [], "Yape no es de México");
});

test("el mensaje es el texto cargado, tal cual", () => {
  assert.equal(
    paymentMethodsText([YAPE, BCP]),
    "*Yape*\n987 654 321\nA nombre de: Flyteek SAC\n_Envía tu comprobante por aquí_\n\n*Transferencia BCP*\nCuenta: 191-1234567-0-12\nCCI: 002-191-001234567012-55",
  );
});

function actions(methods: PaymentMethodDto[], phone = "+51987654321") {
  const sent: { type: string; text?: string; mediaUrl?: string; caption?: string }[] = [];
  const prisma = {
    paymentMethod: { findMany: async ({ where }: { where?: { isActive?: boolean } }) => methods.filter((m) => (where?.isActive ? m.isActive : true)).sort((a, b) => a.order - b.order) },
    contact: { findUnique: async () => ({ phone }) },
  };
  const messaging = { queueOutbound: async (input: { type: string; text?: string; mediaUrl?: string; caption?: string }) => void sent.push(input) };
  const svc = new AgentActionsService(prisma as never, { orgId: () => "org1" } as never, messaging as never, { emit: () => true } as never, {} as never);
  return { svc, sent };
}

test("el agente pide enviarlos: sale el texto exacto del país del cliente y el QR como foto", async () => {
  const { svc, sent } = actions(ALL);
  const out = await svc.execute(PAYMENT_METHODS_TOOL, {}, "ct1", "cv1");
  assert.equal(sent.length, 2);
  assert.equal(sent[0]!.type, "TEXT");
  assert.equal(sent[0]!.text, paymentMethodsText([YAPE, BCP, PAYPAL]));
  assert.deepEqual({ type: sent[1]!.type, mediaUrl: sent[1]!.mediaUrl, caption: sent[1]!.caption }, { type: "IMAGE", mediaUrl: "storage://qr-yape", caption: "Yape" });
  // Lo que lee el modelo: qué se envió y que no repita ningún número (el número no va en lo que lee).
  assert.match(out, /^Enviado al cliente \(Perú\): Yape, Transferencia BCP, PayPal\./);
  assert.match(out, /no los repitas ni escribas tú ningún número/);
  assert.doesNotMatch(out, /987|191-/, "al modelo no se le dan los números");
});

test("paga desde otro país, pide uno en concreto, o no hay nada para él: el agente sabe qué hacer sin inventar", async () => {
  // Número peruano, pero dice que paga desde México.
  const mx = actions(ALL);
  await mx.svc.execute(PAYMENT_METHODS_TOOL, { country: "México" }, "ct1", "cv1");
  assert.equal(mx.sent[0]!.text, paymentMethodsText([SPEI, PAYPAL]));

  // «¿Puedo pagar con Yape?»: solo ese.
  const one = actions(ALL);
  await one.svc.execute(PAYMENT_METHODS_TOOL, { methods: ["Yape"] }, "ct1", "cv1");
  assert.equal(one.sent[0]!.text, paymentMethodsText([YAPE]));

  // Pide Yape desde México: no se envía nada y se le dice qué hay.
  const none = actions(ALL, "+5215512345678");
  const out = await none.svc.execute(PAYMENT_METHODS_TOOL, { methods: ["Yape"] }, "ct1", "cv1");
  assert.equal(none.sent.length, 0);
  assert.match(out, /No hay «Yape» para México\. Para México hay: SPEI, PayPal/);

  // Sin métodos para su país (y ninguno para todos): que lo pase a una persona.
  const co = actions([YAPE, SPEI], "+573001234567");
  const outCo = await co.svc.execute(PAYMENT_METHODS_TOOL, {}, "ct1", "cv1");
  assert.equal(co.sent.length, 0);
  assert.match(outCo, /No hay métodos de pago para Colombia\. No des ningún dato de pago/);
  assert.match(outCo, /handoff_to_human/);

  // Instagram o Messenger: no se sabe el país y solo hay métodos por país.
  const ig = actions([YAPE, SPEI], "IG.17890001234");
  const outIg = await ig.svc.execute(PAYMENT_METHODS_TOOL, {}, "ct1", "cv1");
  assert.equal(ig.sent.length, 0);
  assert.match(outIg, /pregúntaselo y vuelve a llamar con «country»/);
});

test("en la prueba del agente no se envía nada, pero se ve lo que recibiría el cliente", async () => {
  const { svc, sent } = actions(ALL);
  const out = await svc.previewPaymentMethods("+5215512345678", {});
  assert.equal(sent.length, 0);
  assert.match(out, /^\(simulado, no se envió\) El cliente recibiría \(México\):\n\*SPEI\*\nCLABE: 012 180 01234567890 1\n\n\*PayPal\*/);
  const pe = await svc.previewPaymentMethods("+51987654321", {});
  assert.match(pe, /\[\+ foto: Yape\]/);
});

test("la acción solo existe con métodos cargados, con sus nombres y países como lista cerrada", () => {
  assert.equal(resolveTools([PAYMENT_METHODS_TOOL], EMPTY_TOOL_CONTEXT).length, 0, "sin métodos, el modelo no la ve");
  const info = availableTools(EMPTY_TOOL_CONTEXT).find((t) => t.name === PAYMENT_METHODS_TOOL)!;
  assert.match(info.unavailableReason!, /Ajustes › Métodos de pago/);

  const ctx = { ...EMPTY_TOOL_CONTEXT, paymentMethods: ["Yape", "SPEI", "PayPal"], paymentCountries: ["México", "Perú"] };
  const [tool] = resolveTools([PAYMENT_METHODS_TOOL], ctx);
  const props = (tool!.input_schema as { properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }> }).properties;
  assert.deepEqual(props.methods!.items!.enum, ["Yape", "SPEI", "PayPal"]);
  assert.deepEqual(props.country!.enum, ["México", "Perú"]);
  // Todos los métodos son para todos los países: no hay país que elegir.
  const [global] = resolveTools([PAYMENT_METHODS_TOOL], { ...ctx, paymentCountries: [] });
  assert.equal((global!.input_schema as { properties: Record<string, unknown> }).properties.country, undefined);
});

test("la regla del agente: con la acción disponible nunca escribe un dato de pago; sin ella, solo los que tiene", () => {
  const build = (AgentService.prototype as unknown as {
    buildSystemParts(base: string, contact: object, tools: string[], split: boolean, extra: object): { system: string };
  }).buildSystemParts;
  const contact = { name: "Ana", phone: "+51987654321" };
  const tools = ["handoff_to_human", PAYMENT_METHODS_TOOL];
  const withTool = build.call({}, "Eres Lia. Yape: 999 111 222.", contact, tools, false, { paymentTool: true }).system;
  assert.match(withTool, /nunca los escribas tú, ni aunque aparezcan en tus instrucciones/);
  assert.match(withTool, new RegExp(`llama a ${PAYMENT_METHODS_TOOL} en ese mismo turno`));
  assert.match(withTool, /llama a handoff_to_human en ese mismo turno/);
  assert.doesNotMatch(withTool, /dalos solo si aparecen tal cual/);
  // Activada pero sin métodos cargados: la regla de siempre.
  const without = build.call({}, "Eres Lia.", contact, tools, false, { paymentTool: false }).system;
  assert.match(without, /dalos solo si aparecen tal cual en tus instrucciones/);
  assert.doesNotMatch(without, new RegExp(PAYMENT_METHODS_TOOL));
});
