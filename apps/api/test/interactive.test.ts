/**
 * Mensajes interactivos tal como los pide la Cloud API de WhatsApp: botones
 * con encabezado multimedia, lista de opciones y carrusel.
 *
 *   npm run test:interactive --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildInteractivePayload } from "../src/modules/messaging/messaging.service";

// Un archivo del CRM se sube a Meta y va por id; una URL externa, por enlace.
const ref = async (url: string) => (url.startsWith("storage://") ? { id: `meta-${url.slice(10)}` } : { link: url });

test("botones con imagen arriba", async () => {
  const p = await buildInteractivePayload(
    { buttons: [{ id: "b1", title: "Sí" }, { id: "b2", title: "No" }], headerMedia: { kind: "IMAGE", mediaUrl: "storage://abc" }, footer: "Driony" },
    "¿Te interesa?",
    ref,
  );
  assert.deepEqual(p, {
    type: "button",
    header: { type: "image", image: { id: "meta-abc" } },
    body: { text: "¿Te interesa?" },
    footer: { text: "Driony" },
    action: {
      buttons: [
        { type: "reply", reply: { id: "b1", title: "Sí" } },
        { type: "reply", reply: { id: "b2", title: "No" } },
      ],
    },
  });
});

test("botones con documento arriba: lleva su nombre de archivo", async () => {
  const p = await buildInteractivePayload(
    { buttons: [{ id: "b1", title: "Ok" }], headerMedia: { kind: "DOCUMENT", mediaUrl: "storage://pdf", fileName: "catalogo.pdf" } },
    "Te paso el catálogo",
    ref,
  );
  assert.deepEqual(p.header, { type: "document", document: { id: "meta-pdf", filename: "catalogo.pdf" } });
});

test("los botones antiguos (encabezado de texto) siguen igual", async () => {
  const p = await buildInteractivePayload({ buttons: [{ id: "b1", title: "Ok" }], header: "Hola" }, "Texto", ref);
  assert.deepEqual(p.header, { type: "text", text: "Hola" });
});

test("lista de opciones", async () => {
  const p = await buildInteractivePayload(
    { list: { button: "Ver servicios", rows: [{ id: "o1", title: "Corte", description: "30 min" }, { id: "o2", title: "Tinte" }] } },
    "¿Qué servicio quieres?",
    ref,
  );
  assert.deepEqual(p, {
    type: "list",
    body: { text: "¿Qué servicio quieres?" },
    action: {
      button: "Ver servicios",
      sections: [{ title: "Opciones", rows: [{ id: "o1", title: "Corte", description: "30 min" }, { id: "o2", title: "Tinte" }] }],
    },
  });
});

test("carrusel con respuestas: cada tarjeta, su imagen o video y un quick_reply con su id", async () => {
  const p = (await buildInteractivePayload(
    {
      carousel: {
        cards: [
          { id: "c1", kind: "IMAGE", mediaUrl: "storage://a", body: "Modelo A", button: { title: "Elegir" } },
          { id: "c2", kind: "VIDEO", mediaUrl: "https://x.com/b.mp4", button: { title: "Elegir" } },
        ],
      },
    },
    "Nuestros modelos",
    ref,
  )) as { type: string; body: unknown; action: { cards: unknown[] } };
  assert.equal(p.type, "carousel");
  assert.deepEqual(p.body, { text: "Nuestros modelos" });
  assert.deepEqual(p.action.cards[0], {
    card_index: 0,
    type: "cta_url",
    header: { type: "image", image: { id: "meta-a" } },
    body: { text: "Modelo A" },
    action: { buttons: [{ type: "quick_reply", quick_reply: { id: "c1", title: "Elegir" } }] },
  });
  assert.deepEqual(p.action.cards[1], {
    card_index: 1,
    type: "cta_url",
    header: { type: "video", video: { link: "https://x.com/b.mp4" } },
    action: { buttons: [{ type: "quick_reply", quick_reply: { id: "c2", title: "Elegir" } }] },
  });
});

test("carrusel con enlaces", async () => {
  const p = (await buildInteractivePayload(
    {
      carousel: {
        cards: [
          { id: "c1", kind: "IMAGE", mediaUrl: "storage://a", button: { title: "Ver", url: "https://tienda.com/a" } },
          { id: "c2", kind: "IMAGE", mediaUrl: "storage://b", button: { title: "Ver", url: "https://tienda.com/b" } },
        ],
      },
    },
    "Catálogo",
    ref,
  )) as { action: { cards: { action: unknown }[] } };
  assert.deepEqual(p.action.cards[1]!.action, { name: "cta_url", parameters: { display_text: "Ver", url: "https://tienda.com/b" } });
});
