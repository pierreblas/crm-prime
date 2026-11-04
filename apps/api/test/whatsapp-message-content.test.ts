/**
 * Ningún mensaje de WhatsApp se guarda vacío: lo que el cliente escribe va a
 * `text`, y lo demás (contacto, pedido, lo que Meta no entrega) a `note`, que los
 * flujos y las palabras clave no leen. Antes todo esto salía como «[text]».
 *
 *   npm run test:wacontent --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MessageType } from "@crm/shared";
import { normalizeWebhook } from "../src/modules/whatsapp/webhook.types";
import { HISTORY_MEDIA_NOTE, readMetaMessage } from "../src/modules/whatsapp/meta-message-content";
import { MediaUnderstandingService } from "../src/modules/ai/media-understanding.service";
import { MessagingService } from "../src/modules/messaging/messaging.service";

const meta = { display_phone_number: "15550783881", phone_number_id: "106540352242922" };
const body = (field: string, value: object) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field, value: { messaging_product: "whatsapp", metadata: meta, ...value } }] }],
});
const live = (m: object) => normalizeWebhook(body("messages", { messages: [{ from: "16505551234", id: "wamid.m", timestamp: "1739230955", ...m }] }) as any)[0] as any;
const echo = (e: object) => normalizeWebhook(body("smb_message_echoes", { message_echoes: [{ from: "15550783881", to: "16505551234", id: "wamid.e", ...e }] }) as any);

test("lo que escribe el cliente y los botones siguen siendo texto, sin nota", () => {
  assert.deepEqual(readMetaMessage({ type: "text", text: { body: "hola" } }), { text: "hola" });
  assert.deepEqual(readMetaMessage({ type: "button", button: { text: "Sí" } }), { text: "Sí" });
  assert.deepEqual(readMetaMessage({ type: "image", image: { id: "1", caption: "mira" } }), { text: "mira" });
  assert.deepEqual(readMetaMessage({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "a", title: "Opción A" } } }), { text: "Opción A" });
  assert.equal(live({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b1", title: "Comprar" } } }).buttonPayload, "b1");
});

test("un archivo sin pie no lleva nota: se ve el archivo", () => {
  assert.deepEqual(readMetaMessage({ type: "audio", audio: { id: "1" } }), {});
  assert.deepEqual(readMetaMessage({ type: "sticker", sticker: { id: "1" } }), {});
});

test("contacto compartido: nombre, empresa, teléfonos y correos", () => {
  const { text, note } = readMetaMessage({
    type: "contacts",
    contacts: [{ name: { formatted_name: "Ana Pérez" }, org: { company: "Acme" }, phones: [{ phone: "+51 999 111 222", wa_id: "51999111222" }], emails: [{ email: "ana@acme.pe" }] }],
  });
  assert.equal(text, undefined);
  assert.equal(note, "Contacto compartido: Ana Pérez, Acme, +51 999 111 222, ana@acme.pe");
  assert.match(readMetaMessage({ type: "contacts", contacts: [{ name: { first_name: "Ana", last_name: "Paz" } }, { phones: [{ wa_id: "519" }] }] }).note!, /^Contactos compartidos:\nAna Paz\n519$/);
  assert.equal(readMetaMessage({ type: "contacts", contacts: [] }).note, "Contacto compartido, sin datos legibles.");
});

test("ubicación: el lugar y un enlace al mapa, y sigue siendo tipo ubicación", () => {
  const j = live({ type: "location", location: { latitude: -12.04, longitude: -77.03, name: "Oficina", address: "Av. Lima 1" } });
  assert.equal(j.type, MessageType.LOCATION);
  assert.equal(j.text, undefined);
  assert.equal(j.note, "Ubicación: Oficina, Av. Lima 1\nhttps://www.google.com/maps?q=-12.04,-77.03");
});

test("pedido: líneas, total y la nota del cliente", () => {
  const { text, note } = readMetaMessage({
    type: "order",
    order: {
      catalog_id: "1",
      text: "Para hoy",
      product_items: [
        { product_retailer_id: "SKU1", quantity: 2, item_price: 30, currency: "USD" },
        { product_retailer_id: "SKU2", quantity: 1, item_price: 7.99, currency: "USD" },
      ],
    },
  });
  assert.equal(text, undefined, "la nota del pedido no dispara palabras clave");
  assert.equal(note, "Pedido del catálogo:\n2 × SKU1 (USD 30)\n1 × SKU2 (USD 7.99)\nTotal: USD 67.99\nNota del cliente: Para hoy");
});

test("formulario de WhatsApp: las respuestas legibles, sin el token", () => {
  const nfm = (response_json?: string) => readMetaMessage({ type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json } } }).note;
  assert.equal(
    nfm(JSON.stringify({ flow_token: "secreto", screen_0_Nombre_0: "Ana", screen_0_Intereses_1: ["A", "B"], ciudad: "Lima" })),
    "Formulario enviado:\nNombre: Ana\nIntereses: A, B\nciudad: Lima",
  );
  assert.equal(nfm("{no es json"), "Formulario enviado.");
  assert.equal(nfm(undefined), "Formulario enviado.");
});

test("lo que Meta no entrega se explica, con el primer mensaje retenido aparte", () => {
  const retenido = live({ type: "unsupported", errors: [{ code: 131060, title: "This message is currently unavailable" }], unsupported: { type: "unknown" } });
  assert.equal(retenido.type, MessageType.TEXT);
  assert.equal(retenido.text, undefined);
  assert.match(retenido.note, /primer mensaje de un cliente/);
  assert.match(live({ type: "unsupported", errors: [{ code: 131051 }], unsupported: { type: "poll_update" } }).note, /^El cliente respondió a una encuesta/);
  assert.match(live({ type: "unsupported", errors: [{ code: 131051 }] }).note, /tipo de mensaje que WhatsApp no comparte/);
});

test("ningún tipo, conocido o no, deja un texto vacío sin explicar", () => {
  for (const type of ["contacts", "order", "unsupported", "request_welcome", "media_placeholder", "un_tipo_nuevo", "text", "interactive"]) {
    const j = live({ type });
    assert.ok(j.type !== MessageType.TEXT || j.text || j.note, `${type} quedó vacío`);
  }
  for (const type of ["template", "interactive", "contacts", "un_tipo_nuevo"]) {
    const [j] = echo({ type }) as any[];
    assert.equal(j.kind, "echo");
    assert.match(j.note, /desde el celular|Contacto/, `eco ${type}`);
  }
});

test("los ecos: el pie de un video se lee; editar y borrar cambian el original, no abren mensaje", () => {
  assert.equal((echo({ type: "video", video: { id: "1", caption: "mira" } })[0] as any).text, "mira");
  assert.deepEqual(echo({ type: "revoke", revoke: { original_message_id: "wamid.o" } }), [
    { kind: "echo_change", change: "revoke", originalWaMessageId: "wamid.o", channelPhoneNumberId: meta.phone_number_id },
  ]);
  assert.deepEqual(echo({ type: "edit", edit: { original_message_id: "wamid.o", message: { type: "image", image: { caption: "nuevo" } } } }), [
    { kind: "echo_change", change: "edit", originalWaMessageId: "wamid.o", text: "nuevo", channelPhoneNumberId: meta.phone_number_id },
  ]);
  assert.deepEqual(echo({ type: "revoke" }), [], "sin original no hay nada que cambiar");
  assert.equal(echo({ type: "reaction", reaction: { message_id: "wamid.o", emoji: "👍" } })[0]?.kind, "reaction");
});

test("historial: el hueco de un archivo se explica, tanto por hilos como en «messages»", () => {
  const history = (m: object) => normalizeWebhook(body("history", { history: [{ threads: [{ id: "16505551234", messages: [{ from: "16505551234", id: "wamid.h", timestamp: "1739230955", ...m }] }] }] }) as any);
  const [j] = history({ type: "media_placeholder", history_context: { status: "PLAYED" } }) as any[];
  assert.equal(j.kind, "history");
  assert.equal(j.note, HISTORY_MEDIA_NOTE);
  assert.equal(history({ type: "reaction" }).length, 0, "una reacción no es un mensaje");
  const [v] = history({ type: "video", video: { caption: "pie" } }) as any[];
  assert.equal(v.type, MessageType.VIDEO);
  assert.equal(v.text, "pie");
});

test("la IA lee la nota en el historial, pero los flujos y las palabras clave no", () => {
  const note = "Contacto compartido: Ana";
  const contact = { type: "TEXT", content: null, note };
  assert.equal(MediaUnderstandingService.textOf(contact), "", "las palabras clave no ven la nota");
  assert.equal(MediaUnderstandingService.historyTextOf(contact), note);
  assert.equal(MediaUnderstandingService.historyTextOf({ type: "LOCATION", content: null, note: "Ubicación: X" }), "Ubicación: X", "sin «[ubicación]» repetido");
  assert.equal(MediaUnderstandingService.historyTextOf({ type: "TEXT", content: "hola", note: "Editado desde el celular." }), "hola\n(Editado desde el celular.)");
  assert.equal(MediaUnderstandingService.historyTextOf({ type: "TEXT", content: "hola" }), "hola");
  const antiguo = MediaUnderstandingService.historyTextOf({ type: "TEXT", content: null });
  assert.notEqual(antiguo, "[text]");
  assert.match(antiguo, /WhatsApp no lo compartió/);
});

// Sin arrancar Nest: solo lo que estos métodos tocan.
function service(found: object | null) {
  const updates: { where: object; data: Record<string, unknown> }[] = [];
  const notified: string[] = [];
  const svc = Object.create(MessagingService.prototype) as MessagingService;
  Object.assign(svc, {
    prisma: {
      message: {
        findUnique: async () => found,
        update: async (a: { where: object; data: Record<string, unknown> }) => updates.push(a),
      },
    },
    notify: (id: string) => notified.push(id),
  });
  return { svc, updates, notified };
}
const historyJob = { customerWaId: "+1", fromCustomer: true, waMessageId: "wamid.h", timestampMs: 1 };

test("borrar desde el celular avisa sin perder lo que se dijo; editar cambia el texto", async () => {
  const a = service({ id: "m1", conversationId: "c1" });
  await a.svc.handleEchoChange("revoke", "wamid.o");
  assert.deepEqual(a.updates[0]!.data, { note: "Eliminaste este mensaje desde el celular." });
  assert.ok(!("content" in a.updates[0]!.data), "el texto se conserva");
  assert.deepEqual(a.notified, ["c1"]);

  const b = service({ id: "m1", conversationId: "c1" });
  await b.svc.handleEchoChange("edit", "wamid.o", "corregido");
  assert.deepEqual(b.updates[0]!.data, { note: "Editado desde el celular.", content: "corregido" });

  const c = service(null);
  await c.svc.handleEchoChange("revoke", "wamid.desconocido");
  assert.equal(c.updates.length, 0, "si no lo tenemos, no hay nada que cambiar");
});

test("el aviso con el contenido de un archivo completa su hueco del historial", async () => {
  const hueco = { id: "m1", type: MessageType.TEXT, content: null };
  const a = service(hueco);
  await a.svc.handleHistory({ ...historyJob, type: MessageType.IMAGE, text: "foto" });
  assert.deepEqual(a.updates[0]!.data, { type: MessageType.IMAGE, content: "foto", note: null });

  const b = service(hueco);
  await b.svc.handleHistory({ ...historyJob, type: MessageType.TEXT, note: HISTORY_MEDIA_NOTE });
  assert.equal(b.updates.length, 0, "otro hueco no aporta nada");

  const c = service({ id: "m1", type: MessageType.TEXT, content: "ya tiene texto" });
  await c.svc.handleHistory({ ...historyJob, type: MessageType.IMAGE });
  assert.equal(c.updates.length, 0, "lo que ya está no se pisa");

  const d = service({ id: "m1", type: MessageType.IMAGE, content: null });
  await d.svc.handleHistory({ ...historyJob, type: MessageType.TEXT, note: HISTORY_MEDIA_NOTE });
  assert.equal(d.updates.length, 0, "si llega al revés, el archivo no vuelve a ser un hueco");
});
