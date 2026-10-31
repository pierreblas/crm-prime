/**
 * De dónde viene un chat: anuncios Click-to-WhatsApp, formularios de Meta y
 * el mismo cliente con su número escrito de otra forma. Parte pura.
 *
 *   npm run test:attribution --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { adSummaryOf, phoneVariants, phoneWithDefaultCountry, readAdReferral } from "@crm/shared";
import { originText } from "../src/modules/ai/agent.service";

test("el mismo móvil de México y Argentina en sus dos formas", () => {
  assert.deepEqual(phoneVariants("+5215512345678").sort(), ["+525512345678", "+5215512345678"].sort());
  assert.deepEqual(phoneVariants("+525512345678").sort(), ["+525512345678", "+5215512345678"].sort());
  assert.deepEqual(phoneVariants("+5491123456789").sort(), ["+541123456789", "+5491123456789"].sort());
  assert.deepEqual(phoneVariants("+541123456789").sort(), ["+541123456789", "+5491123456789"].sort());
  // Otros países, o números que no encajan, solo son ellos mismos.
  assert.deepEqual(phoneVariants("+51987654321"), ["+51987654321"]);
  assert.deepEqual(phoneVariants("+52551234567"), ["+52551234567"], "fijo corto de México: sin variante");
});

test("un teléfono de formulario sin prefijo toma el del país de la empresa", () => {
  assert.equal(phoneWithDefaultCountry("987 654 321", "51"), "+51987654321");
  assert.equal(phoneWithDefaultCountry("0987654321", "51"), "+51987654321", "el 0 de marcación nacional se quita");
  assert.equal(phoneWithDefaultCountry("+51 987 654 321", "52"), "+51987654321", "con + manda el suyo");
  assert.equal(phoneWithDefaultCountry("0051987654321", "52"), "+51987654321");
  assert.equal(phoneWithDefaultCountry("51987654321", "51"), "+51987654321", "largo: ya trae el prefijo");
  assert.equal(phoneWithDefaultCountry("987654321", null), "+987654321", "sin país conocido, como antes");
});

test("el referral se lee guardado en camelCase o con la forma de Meta", () => {
  const camel = readAdReferral({ sourceId: "1", headline: "Zapatillas", ctwaClid: "c1", welcomeMessage: "Hola" });
  assert.equal(camel?.ctwaClid, "c1");
  assert.equal(camel?.welcomeMessage, "Hola");
  const snake = readAdReferral({ source_id: "2", ctwa_clid: "c2", welcome_message: { text: "¡Hola!" }, ref: "abc" });
  assert.equal(snake?.sourceId, "2");
  assert.equal(snake?.ctwaClid, "c2");
  assert.equal(snake?.welcomeMessage, "¡Hola!");
  assert.equal(snake?.ref, "abc");
  assert.equal(readAdReferral(null), null);
  assert.equal(readAdReferral({ cualquier: "cosa" }), null);
  // Lo que viaja a la web no lleva el click id.
  assert.ok(!("ctwaClid" in (adSummaryOf({ sourceId: "1", ctwaClid: "c1" }) ?? {})));
});

test("el agente sabe por qué anuncio o formulario llegó el cliente", () => {
  const ad = originText({ sourceId: "1", headline: "Zapatillas running", body: "2x1 esta semana", welcomeMessage: "¡Hola! ¿Qué talla buscas?" }, {});
  assert.match(ad, /## Cómo llegó/);
  assert.match(ad, /titular «Zapatillas running»/);
  assert.match(ad, /texto «2x1 esta semana»/);
  assert.match(ad, /saludo del anuncio: «¡Hola! ¿Qué talla buscas\?»\. No lo repitas/);
  assert.match(originText({ sourceId: "9", sourceType: "post" }, {}), /publicación promocionada/);

  const form = originText(null, { formulario: "Cotización 2026" });
  assert.match(form, /formulario de Meta «Cotización 2026»/);
  assert.match(form, /no se los vuelvas a pedir/);
  assert.equal(originText(null, {}), "");
});
