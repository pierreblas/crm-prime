/**
 * Campos del lead: lo que responde alguien en un formulario es de ese interés
 * (la oportunidad), no de la persona. Aquí, la regla que reparte cada dato.
 *
 *   npm run test:leadfields --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { leadFieldsText, mapMetaLeadFields, mergeLeadFields, splitLeadData } from "@crm/shared";

const defs = [
  { key: "ciudad", label: "Ciudad", entity: "contact" },
  { key: "experiencia", label: "¿Qué experiencia tienes?", entity: "deal" },
];

test("las respuestas sin asignar van al lead; sin oportunidad, se quedan en el contacto", () => {
  const answers = { "cual_es_tu_objetivo?": "conseguir_trabajo", presupuesto: "200" };
  assert.deepEqual(splitLeadData({ answers, defs, hasLead: true }), {
    contact: {},
    lead: { cual_es_tu_objetivo: "conseguir_trabajo", presupuesto: "200" },
    utms: {},
  });
  assert.deepEqual(splitLeadData({ answers, defs, hasLead: false }), {
    contact: { cual_es_tu_objetivo: "conseguir_trabajo", presupuesto: "200" },
    lead: {},
    utms: {},
  });
});

test("una respuesta que coincide con un campo definido va a donde vive ese campo", () => {
  const r = splitLeadData({ answers: { Ciudad: "Lima", "¿Qué experiencia tienes?": "ninguna" }, defs, hasLead: true });
  assert.deepEqual(r.contact, { ciudad: "Lima" }, "campo del contacto, por su nombre visible");
  assert.deepEqual(r.lead, { experiencia: "ninguna" }, "campo del lead, por su nombre visible");
});

test("los UTM no son ni del contacto ni del lead: van aparte", () => {
  const r = splitLeadData({ answers: { utm_term: "mlops", "UTM Source": "meta", curso: "MLOps" }, defs, hasLead: true });
  assert.deepEqual(r.utms, { utm_term: "mlops", utm_source: "meta" });
  assert.deepEqual(r.lead, { curso: "MLOps" });
  assert.deepEqual(r.contact, {});
});

test("lo asignado a mano se respeta; un campo del lead sin oportunidad cae en el contacto", () => {
  const input = { contact: { ciudad: "Cusco" }, lead: { experiencia: "2 años" }, answers: {}, defs };
  assert.deepEqual(splitLeadData({ ...input, hasLead: true }), { contact: { ciudad: "Cusco" }, lead: { experiencia: "2 años" }, utms: {} });
  assert.deepEqual(splitLeadData({ ...input, hasLead: false }).contact, { ciudad: "Cusco", experiencia: "2 años" });
});

test("lo vacío no se guarda", () => {
  assert.deepEqual(splitLeadData({ answers: { a: "  ", b: "" }, defs, hasLead: true }), { contact: {}, lead: {}, utms: {} });
});

test("el formulario puede mandar una pregunta a un campo del lead", () => {
  const m = mapMetaLeadFields(
    [
      { name: "full_name", value: "Ana Ríos" },
      { name: "phone_number", value: "+51 999 111 222" },
      { name: "ciudad", value: "Lima" },
      { name: "nivel", value: "junior" },
      { name: "objetivo", value: "cambiar de trabajo" },
    ],
    { ciudad: "field:ciudad", nivel: "deal:experiencia" },
  );
  assert.equal(m.name, "Ana Ríos");
  assert.deepEqual(m.lead, { experiencia: "junior" }, "asignada a un campo del lead");
  assert.deepEqual(m.unmapped, ["objetivo"], "la que nadie asignó");
  assert.deepEqual(m.extra, { ciudad: "Lima", objetivo: "cambiar de trabajo" }, "como antes: lo del contacto y lo sin asignar");
});

test("otro formulario en el mismo lead: las respuestas nuevas mandan y las otras se conservan", () => {
  assert.deepEqual(mergeLeadFields({ objetivo: "aprender", nivel: "junior" }, { objetivo: "cambiar de trabajo" }), {
    objetivo: "cambiar de trabajo",
    nivel: "junior",
  });
  assert.deepEqual(mergeLeadFields(null, { a: "1" }), { a: "1" });
  assert.deepEqual(mergeLeadFields("basura", {}), {});
});

test("el agente lee las respuestas del lead con el nombre del campo, o la clave en limpio", () => {
  assert.equal(
    leadFieldsText({ experiencia: "no_tengo_experiencia_previa", cual_es_tu_objetivo: "conseguir_trabajo", vacio: "" }, defs),
    "¿Qué experiencia tienes?: no_tengo_experiencia_previa; Cual es tu objetivo: conseguir_trabajo",
  );
  assert.equal(leadFieldsText({}, defs), "");
  assert.equal(leadFieldsText(null, defs), "");
});
