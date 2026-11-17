import { test } from "node:test";
import assert from "node:assert/strict";
import { contactVarValues, fillContactText, fillInstructions, varsIn } from "@crm/shared";

// Variables del contacto en los mensajes fijos y en las instrucciones del agente.

const ana = contactVarValues(
  { name: "Ana", phone: "+51987654321", metadata: { ciudad: "Arequipa", empresa: "" } },
  [
    { key: "ciudad", label: "Ciudad" },
    { key: "empresa", label: "Empresa" },
  ],
);
const nadie = contactVarValues({ name: null, phone: "+51987654321" }, [{ key: "ciudad", label: "Ciudad" }]);

test("variables: rellena con los datos del contacto, por clave o nombre, sin mirar mayúsculas ni tildes", () => {
  assert.equal(fillContactText("Hola {{nombre}}, te escribimos desde {{Ciudad}}", ana), "Hola Ana, te escribimos desde Arequipa");
  assert.equal(fillContactText("{{País}} · {{MONEDA}} · {{teléfono}}", ana), "Perú · PEN · +51987654321");
  assert.equal(fillContactText("Hola {{ nombre }}", ana), "Hola Ana");
});

test("variables: si falta el dato, se quita y la frase queda bien", () => {
  const cases: [string, string][] = [
    ["Hola {{nombre}}, gracias por escribirnos", "Hola, gracias por escribirnos"],
    ["¡Hola, {{nombre}}! 👋", "¡Hola! 👋"],
    ["¡Hola {{nombre}}!", "¡Hola!"],
    ["{{nombre}}, gracias por escribirnos", "Gracias por escribirnos"],
    ["Gracias, {{nombre}}", "Gracias"],
    ["Hola {{nombre}} 👋 ¿en qué te ayudamos?", "Hola 👋 ¿en qué te ayudamos?"],
    ["¡{{nombre}}, bienvenido!", "¡Bienvenido!"],
    ["Hola {{nombre}} {{empresa}}, ¿qué tal?", "Hola, ¿qué tal?"],
    ["Hola.\n{{nombre}}\nGracias", "Hola.\nGracias"],
    ["Primer mensaje\n\n{{nombre}}", "Primer mensaje\n"],
  ];
  for (const [text, want] of cases) assert.equal(fillContactText(text, nadie), want, text);
});

test("variables: lo que va tras la barra se usa si falta el dato", () => {
  assert.equal(fillContactText("Hola {{nombre|amigo}}, ¿qué tal?", nadie), "Hola amigo, ¿qué tal?");
  assert.equal(fillContactText("Hola {{nombre|amigo}}, ¿qué tal?", ana), "Hola Ana, ¿qué tal?");
});

test("variables: al cliente nunca le llegan llaves, aunque la variable no exista", () => {
  assert.equal(fillContactText("Hola {{apodo}}, ¿qué tal?", ana), "Hola, ¿qué tal?");
  assert.doesNotMatch(fillContactText("{{a}} {{b}} {{c}}", ana), /[{}]/);
});

test("variables: un nombre que es el número no sirve para saludar; sin número no hay teléfono", () => {
  const sinNombre = contactVarValues({ name: "+51 987 654 321", phone: "+51987654321" });
  assert.equal(fillContactText("Hola {{nombre}}, ¿qué tal?", sinNombre), "Hola, ¿qué tal?");
  const instagram = contactVarValues({ name: "Ana", phone: "IG.1234567890" });
  assert.equal(instagram.telefono, "");
  assert.equal(instagram.pais, "");
});

test("variables: un campo con valor manda; uno vacío no borra una de siempre", () => {
  const conPais = contactVarValues({ name: "Ana", phone: "+51987654321", metadata: { pais: "Chile" } }, [{ key: "pais", label: "País" }]);
  assert.equal(conPais.pais, "Chile");
  const pais = contactVarValues({ name: "Ana", phone: "+51987654321", metadata: {} }, [{ key: "pais", label: "País" }]);
  assert.equal(pais.pais, "Perú");
});

test("instrucciones: un dato que falta le llega a la IA como «(sin dato)»", () => {
  assert.equal(fillInstructions("El cliente es de {{empresa}} y vive en {{ciudad}}.", ana), "El cliente es de (sin dato) y vive en Arequipa.");
  assert.equal(fillInstructions("Trátalo de {{tratamiento|usted}}.", ana), "Trátalo de usted.");
});

test("variables: las que usa un texto, sin repetir", () => {
  assert.deepEqual(varsIn("Hola {{nombre}} {{Nombre|amigo}} de {{ciudad}}"), ["nombre", "ciudad"]);
});

test("mensajes fijos: se rellenan con el contacto de la conversación; sin llaves no se consulta nada", async () => {
  const { customerTextFor } = await import("../src/modules/ai/contact-vars");
  let queries = 0;
  const prisma = {
    conversation: {
      findUnique: async () => {
        queries++;
        return { contact: { name: "Luis", phone: "+5215512345678", currency: null, metadata: { ciudad: "Puebla" } } };
      },
    },
    customField: {
      findMany: async () => {
        queries++;
        return [{ key: "ciudad", label: "Ciudad" }];
      },
    },
  };
  assert.equal(await customerTextFor(prisma as never, "cv1", "¡Hola {{nombre}}! Te escribimos desde {{ciudad}} ({{pais}})."), "¡Hola Luis! Te escribimos desde Puebla (México).");
  assert.equal(queries, 2);
  assert.equal(await customerTextFor(prisma as never, "cv1", "Gracias por escribirnos"), "Gracias por escribirnos");
  assert.equal(queries, 2);
});
