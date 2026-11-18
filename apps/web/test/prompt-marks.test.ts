/**
 * Lo que se señala en «Cómo debe atender» (promptMarks): sin React ni DOM,
 * solo posiciones en el texto.
 *
 *   npm run test:promptmarks --workspace=apps/web
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_VARS,
  collectMarks,
  dataToken,
  findProductData,
  productDataFields,
  productDataSentence,
  segments,
  type PromptTool,
} from "../src/features/bots/promptMarks";

const FIELDS = productDataFields([
  { label: "Fecha de inicio", aiVisible: true },
  { label: "Costo interno", aiVisible: false },
  { label: "precio", aiVisible: true }, // se llama como uno de siempre: no se repite
]);
const TOOLS: PromptTool[] = [
  { name: "search_products", title: "Consultar tus productos", enabled: true },
  { name: "handoff_to_human", title: "Pasarte el chat", enabled: false },
];
const slice = (text: string, m: { start: number; end: number }) => text.slice(m.start, m.end);

test("los datos del producto: los de siempre y los campos propios, sin repetir", () => {
  assert.deepEqual(
    FIELDS.map((f) => `${f.label}${f.visible ? "" : " (oculto)"}`),
    ["Nombre", "Precio", "Descripción", "SKU", "Fecha de inicio", "Costo interno (oculto)"],
  );
});

test("un dato entre « » se reconoce sin mirar mayúsculas ni tildes; el resto entre « » es texto", () => {
  const text = "Da el «precio», la «FECHA DE INICIO» y la «descripcion». Saluda con «Hola, ¿en qué te ayudo?» y no uses «Temario».";
  const marks = findProductData(text, FIELDS);
  assert.deepEqual(
    marks.map((m) => [slice(text, m), m.kind, m.text]),
    [
      ["«precio»", "data", "Precio"],
      ["«FECHA DE INICIO»", "data", "Fecha de inicio"],
      ["«descripcion»", "data", "Descripción"],
    ],
  );
});

test("nombrar un campo que el agente no recibe se señala aparte", () => {
  const text = "Nunca digas el «Costo interno».";
  const [m] = findProductData(text, FIELDS);
  assert.equal(m?.kind, "data-off");
  assert.equal(slice(text, m!), "«Costo interno»");
});

test("la frase de cada dato pide consultarlo con search_products y lo nombra entre « »", () => {
  for (const f of FIELDS) {
    const s = productDataSentence(f.label);
    assert.match(s, /search_products/, f.label);
    assert.ok(s.includes(dataToken(f.label)), `${f.label}: ${s}`);
    // La frase que se inserta se marca sola como dato al quedar en el texto.
    assert.equal(findProductData(s, FIELDS).length, 1, s);
  }
  // Los de siempre se reconocen sin mirar mayúsculas: «precio» da la frase de «Precio».
  assert.equal(productDataSentence("precio"), productDataSentence("Precio"));
});

test("todas las marcas juntas, ordenadas y sin pisarse", () => {
  const text = "PRECIOS\nAntes de dar el «Precio» usa search_products. Si no, handoff_to_human. Trata a {{nombre}} por su nombre. Horario: [HORARIO].";
  const marks = collectMarks(text, TOOLS, BUILTIN_VARS, FIELDS);
  assert.deepEqual(
    marks.map((m) => [m.kind, slice(text, m)]),
    [
      ["head", "PRECIOS"],
      ["data", "«Precio»"],
      ["tool", "search_products"],
      ["tool-off", "handoff_to_human"],
      ["var", "{{nombre}}"],
      ["pending", "[HORARIO]"],
    ],
  );
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i]!.start >= marks[i - 1]!.end, "no se solapan");
  // Los tramos vuelven a formar el texto entero: la capa de resaltado no pierde ni añade nada.
  assert.equal(segments(text, marks).map((s) => s.text).join(""), text);
});

test("sin datos del producto (otros editores), el texto entre « » no se marca", () => {
  assert.equal(collectMarks("Da el «Precio».", TOOLS).filter((m) => m.kind === "data").length, 0);
});
