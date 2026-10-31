/**
 * Envío de plantillas: lo que se manda a Meta y lo que se guarda cuando falla.
 *
 *   npm run test:templatesend --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanTemplateParam,
  explainWhatsappError,
  fillTemplateText,
  namedTemplateVars,
  parseGraphError,
} from "@crm/shared";
import { buildTemplateComponents } from "../src/modules/whatsapp/providers/meta-whatsapp.provider";
import { TemplateFillService } from "../src/modules/campaigns/template-fill.service";
import { parseMetaTemplate } from "../src/modules/campaigns/template.service";

const fills = new TemplateFillService({} as any, {} as any);
const contact = { name: null, phone: "+51900000001" };
const tpl = (body: string) => ({ name: "promo", language: "es", header: null, buttons: [], body });

test("el error de Meta se guarda explicado y con su código", () => {
  const body = JSON.stringify({
    error: { message: "(#131042) Business eligibility payment issue", code: 131042, error_data: { details: "Message failed to send because there were one or more errors related to your payment method." } },
  });
  const text = explainWhatsappError(parseGraphError(body)!);
  assert.match(text, /^Hay un problema con el método de pago/);
  assert.match(text, /Meta #131042: Message failed to send because/);
  // Código desconocido: el mensaje de Meta tal cual, con el código.
  assert.equal(explainWhatsappError({ code: 999999, message: "Something odd" }), "Something odd (Meta #999999)");
  assert.equal(parseGraphError("<html>502</html>"), null);
});

test("variables con nombre: se detectan en orden y se rellenan", () => {
  assert.deepEqual(namedTemplateVars("Hola {{nombre}}, tu cita es el {{fecha}}. Gracias {{nombre}}"), ["nombre", "fecha"]);
  assert.deepEqual(namedTemplateVars("Hola {{1}}"), []);
  assert.equal(fillTemplateText("Hola {{nombre}}, el {{fecha}}", ["Ana", "lunes"], ["nombre", "fecha"]), "Hola Ana, el lunes");
  assert.equal(fillTemplateText("Hola {{1}}, el {{2}}", ["Ana", "lunes"]), "Hola Ana, el lunes");
});

test("un valor nunca va vacío ni con saltos de línea", () => {
  assert.equal(cleanTemplateParam("", "cliente"), "cliente");
  assert.equal(cleanTemplateParam("  ", "cliente"), "cliente");
  assert.equal(cleanTemplateParam("línea 1\nlínea 2\tfin", "-"), "línea 1 línea 2 fin");
  assert.equal(cleanTemplateParam("a        b", "-"), "a   b");
});

test("plantilla importada de Meta con variables con nombre", () => {
  const parsed = parseMetaTemplate({
    id: "1",
    name: "cita",
    language: "es",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hola {{nombre}}, te esperamos el {{fecha}}." }],
  } as any);
  assert.deepEqual(parsed.variables, [
    { index: 1, label: "nombre", name: "nombre" },
    { index: 2, label: "fecha", name: "fecha" },
  ]);
});

test("al enviar, cada valor con nombre lleva parameter_name; un contacto sin nombre no deja el hueco vacío", async () => {
  const spec = await fills.build(
    tpl("Hola {{nombre}}, te esperamos el {{fecha}}."),
    {
      body: [
        { index: 1, source: "contact_name" },
        { index: 2, source: "static", value: "lunes 3" },
      ],
      urlButtons: [],
    },
    contact,
  );
  assert.deepEqual(spec.bodyParams, ["cliente", "lunes 3"]);
  assert.deepEqual(buildTemplateComponents(spec), [
    {
      type: "body",
      parameters: [
        { type: "text", text: "cliente", parameter_name: "nombre" },
        { type: "text", text: "lunes 3", parameter_name: "fecha" },
      ],
    },
  ]);
  assert.equal(fills.preview("Hola {{nombre}}, te esperamos el {{fecha}}.", spec), "Hola cliente, te esperamos el lunes 3.");
});

test("las posicionales siguen igual, sin parameter_name", async () => {
  const spec = await fills.build(tpl("Hola {{1}}"), { body: [{ index: 1, source: "contact_phone" }], urlButtons: [] }, contact);
  assert.deepEqual(buildTemplateComponents(spec), [{ type: "body", parameters: [{ type: "text", text: "+51900000001" }] }]);
});

test("si faltan valores para las variables, se dice claro antes de llamar a Meta", async () => {
  await assert.rejects(
    fills.build(tpl("Hola {{nombre}}, el {{fecha}}"), { body: [], urlButtons: [] }, contact),
    /La plantilla tiene 2 variables y el envío trae 0/,
  );
});
