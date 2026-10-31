/**
 * Coexistencia: el historial que Meta manda al conectar un número no son
 * mensajes nuevos. Si se tomaran por nuevos, el agente escribiría a todos los
 * clientes antiguos.
 *
 *   npm run test:history --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWebhook } from "../src/modules/whatsapp/webhook.types";

const meta = { display_phone_number: "15550783881", phone_number_id: "106540352242922" };
const change = (field: string | undefined, value: object) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ ...(field ? { field } : {}), value: { messaging_product: "whatsapp", metadata: meta, ...value } }] }],
});

test("el aviso de historial con los medios (lista «messages») se guarda como historial, no como mensajes nuevos", () => {
  const jobs = normalizeWebhook(
    change("history", {
      messages: [
        { from: "16505551234", id: "wamid.img", timestamp: "1739230955", type: "image", image: { id: "media1", caption: "foto" } },
        { from: "15550783881", to: "16505551234", id: "wamid.out", timestamp: "1739230960", type: "document", document: { id: "media2" } },
      ],
    }) as any,
  );
  assert.deepEqual(
    jobs.map((j: any) => [j.kind, j.customerWaId, j.fromCustomer, j.waMessageId]),
    [
      ["history", "+16505551234", true, "wamid.img"],
      ["history", "+16505551234", false, "wamid.out"],
    ],
  );
  assert.ok(!jobs.some((j) => j.kind === "message"), "nada que contestar");
});

test("el historial por hilos sigue igual", () => {
  const jobs = normalizeWebhook(
    change("history", {
      history: [{ metadata: { phase: 0, chunk_order: 1, progress: 55 }, threads: [{ id: "16505551234", messages: [{ from: "16505551234", id: "wamid.h1", timestamp: "1739230955", type: "text", text: { body: "hola" }, history_context: { status: "read" } }] }] }],
    }) as any,
  );
  assert.deepEqual(jobs.map((j: any) => [j.kind, j.waMessageId, j.text]), [["history", "wamid.h1", "hola"]]);
});

test("un mensaje con history_context es historial aunque venga en «messages»", () => {
  const jobs = normalizeWebhook(
    change("messages", {
      messages: [{ from: "16505551234", id: "wamid.x", timestamp: "1739230955", type: "text", text: { body: "viejo" }, history_context: { status: "read" } }],
    }) as any,
  );
  assert.equal(jobs[0]?.kind, "history");
});

test("un mensaje nuevo sigue siendo un mensaje, con su hora", () => {
  const jobs = normalizeWebhook(
    change("messages", { messages: [{ from: "16505551234", id: "wamid.new", timestamp: "1739230955", type: "text", text: { body: "hola" } }] }) as any,
  );
  assert.equal(jobs[0]?.kind, "message");
  assert.equal((jobs[0] as any).timestampMs, 1739230955000);
  // Sin «field» (el simulador de desarrollo) también.
  assert.equal(normalizeWebhook(change(undefined, { messages: [{ from: "1", id: "w", type: "text", text: { body: "x" } }] }) as any)[0]?.kind, "message");
});
