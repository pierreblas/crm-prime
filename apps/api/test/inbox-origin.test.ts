/**
 * Bandeja: el símbolo de cada chat dice por dónde llegó el cliente.
 *
 *   npm run test:inboxorigin --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chatOrigin } from "@crm/shared";

const chat = (over: Partial<Parameters<typeof chatOrigin>[0]> = {}) => ({
  channel: { kind: "whatsapp" as const },
  ad: null,
  contact: { form: null, source: null },
  ...over,
});

test("un chat de WhatsApp sin más pistas llegó por WhatsApp", () => {
  assert.equal(chatOrigin(chat()), "whatsapp");
  assert.equal(chatOrigin(chat({ channel: null })), "whatsapp", "sin canal guardado (chats antiguos)");
  assert.equal(chatOrigin(chat({ contact: { form: null, source: { kind: null } } })), "whatsapp", "con una fuente creada por la empresa");
});

test("Messenger, Instagram y TikTok mandan: es el canal por el que se le responde", () => {
  for (const kind of ["messenger", "instagram", "tiktok"] as const) {
    assert.equal(chatOrigin(chat({ channel: { kind } })), kind);
    assert.equal(chatOrigin(chat({ channel: { kind }, contact: { form: "Curso Power BI", source: { kind: "form" } } })), kind, "aunque antes llenara un formulario");
  }
});

test("si el chat viene de un anuncio click-to-WhatsApp, se marca como anuncio", () => {
  assert.equal(chatOrigin(chat({ ad: { headline: "Excel avanzado" } })), "ad");
  assert.equal(chatOrigin(chat({ contact: { form: null, source: { kind: "ad" } } })), "ad", "sin el anuncio guardado, por su fuente automática");
  assert.equal(chatOrigin(chat({ ad: { headline: "Excel" }, contact: { form: "Curso Power BI", source: null } })), "ad", "el anuncio de este chat pesa más que un formulario anterior");
});

test("quien llenó un formulario de Meta se marca como formulario", () => {
  assert.equal(chatOrigin(chat({ contact: { form: "Curso Power BI", source: null } })), "form", "por el nombre del formulario");
  assert.equal(chatOrigin(chat({ contact: { form: "Curso Power BI", source: { kind: null } } })), "form", "aunque el formulario mande a una fuente propia");
  assert.equal(chatOrigin(chat({ contact: { form: null, source: { kind: "form" } } })), "form", "sin nombre, por la fuente automática");
  assert.equal(chatOrigin(chat({ contact: { form: "  ", source: null } })), "whatsapp", "un nombre vacío no cuenta");
});
