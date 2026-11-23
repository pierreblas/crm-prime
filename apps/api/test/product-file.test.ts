/**
 * Archivo de producto: el brochure o el temario que la IA envía como archivo.
 * El valor del campo, el nombre con que llega, los enlaces (Drive, Dropbox), la
 * acción del agente, lo que lee el modelo, lo que recibe WhatsApp y que el
 * borrado de adjuntos por plan no toque un archivo en uso. Sin base de datos,
 * red ni modelo: dobles.
 *
 *   npm run test:productfile --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  directFileUrl,
  formatFieldValue,
  mediaName,
  parseFieldValue,
  productFieldTypes,
  productFileName,
  readProductFile,
  stripMediaName,
  withMediaName,
} from "@crm/shared";
import { parseStorageRef } from "../src/infra/storage/storage.provider";
import { AgentActionsService } from "../src/modules/ai/agent-actions.service";
import { missingFilesNote, productDetails } from "../src/modules/ai/product-details";
import { EMPTY_TOOL_CONTEXT, availableTools, resolveTools } from "../src/modules/ai/tools.registry";
import { MediaRetentionService } from "../src/modules/plans/media-retention.service";
import { MessagingService } from "../src/modules/messaging/messaging.service";
import { MetaWhatsAppProvider } from "../src/modules/whatsapp/providers/meta-whatsapp.provider";
import { checkFileLink, downloadFileLink } from "../src/modules/products/file-link";

const ID = "6f1c2a34-5b6d-4e7f-8a90-123456789abc";
const STORED = withMediaName(`storage://${ID}`, "brochure v3.pdf");

// ── El valor del campo ─────────────────────────────────────────
test("el nombre del archivo viaja pegado a su referencia y se separa sin perder nada", () => {
  assert.equal(STORED, `storage://${ID}#nombre=brochure%20v3.pdf`);
  assert.equal(mediaName(STORED), "brochure v3.pdf");
  assert.equal(stripMediaName(STORED), `storage://${ID}`);
  assert.equal(parseStorageRef(STORED), ID, "quien lee el archivo no ve el nombre");
  assert.equal(mediaName("https://x.com/a.pdf#page=2"), null, "el «#» de un enlace cualquiera no es un nombre");
  assert.equal(stripMediaName("https://x.com/a.pdf#page=2"), "https://x.com/a.pdf#page=2");
  assert.equal(withMediaName("https://x.com/a.pdf#page=2", "B.pdf"), "https://x.com/a.pdf#nombre=B.pdf");
  assert.equal(mediaName("storage://x#nombre=%E0%A4%A"), null, "un nombre roto no revienta");
});

test("un campo «Archivo» guarda un archivo subido o un enlace; lo demás no vale", () => {
  assert.ok((productFieldTypes as readonly string[]).includes("file"));
  assert.deepEqual(readProductFile(STORED), { kind: "stored", ref: `storage://${ID}`, name: "brochure v3.pdf" });
  assert.deepEqual(readProductFile("https://web.com/docs/Temario%20Excel.pdf?v=2"), { kind: "link", ref: "https://web.com/docs/Temario%20Excel.pdf?v=2", name: "Temario Excel.pdf" });
  assert.equal(readProductFile("https://drive.google.com/file/d/abc/view")?.name, "drive.google.com", "sin nombre en el enlace, el sitio");
  for (const bad of ["", null, "hola", "javascript:alert(1)", "file:///etc/passwd", "storage://no-es-uuid"]) assert.equal(readProductFile(bad), null, String(bad));

  const field = { label: "Brochure", type: "file", options: [] as string[] };
  assert.deepEqual(parseFieldValue("https://web.com/b.pdf", field), { ok: true, value: "https://web.com/b.pdf" });
  assert.deepEqual(parseFieldValue("web.com/b.pdf", field), { ok: true, value: "https://web.com/b.pdf" });
  assert.equal(parseFieldValue("el de siempre", field).ok, false);
  assert.equal(parseFieldValue(STORED, field).ok, false, "desde un archivo o la API solo entran enlaces");
  assert.equal(formatFieldValue({ type: "file" }, STORED), "brochure v3.pdf", "en la tarjeta se ve el nombre, no la referencia");
});

test("el nombre que recibe el cliente dice qué es y de qué producto", () => {
  assert.equal(productFileName("Brochure", "Power BI", { name: "final_v3.pdf" }), "Brochure Power BI.pdf");
  assert.equal(productFileName("Brochure", "Power BI", { name: "drive.google.com", mimeType: "application/pdf" }), "Brochure Power BI.pdf");
  assert.equal(productFileName("Temario", 'Excel: básico / "pro"', { name: "x.docx" }), "Temario Excel básico pro.docx");
  assert.equal(productFileName("Brochure", "Brochure de marketing", { name: "x.pdf" }), "Brochure de marketing.pdf", "sin repetir la palabra");
  assert.ok(productFileName("Brochure", "x".repeat(300), { name: "a.pdf" }).length <= 100);
});

test("Google Drive, Docs y Dropbox se vuelven descarga directa", () => {
  assert.equal(directFileUrl("https://drive.google.com/file/d/1AbC_d-9/view?usp=sharing"), "https://drive.google.com/uc?export=download&id=1AbC_d-9");
  assert.equal(directFileUrl("https://drive.google.com/open?id=1AbC"), "https://drive.google.com/uc?export=download&id=1AbC");
  assert.equal(directFileUrl("https://docs.google.com/document/d/XyZ/edit#heading=h.1"), "https://docs.google.com/document/d/XyZ/export?format=pdf");
  assert.equal(directFileUrl("https://docs.google.com/presentation/d/XyZ/edit"), "https://docs.google.com/presentation/d/XyZ/export/pdf");
  assert.equal(directFileUrl("https://docs.google.com/spreadsheets/d/XyZ/edit#gid=0"), "https://docs.google.com/spreadsheets/d/XyZ/export?format=pdf");
  assert.equal(directFileUrl("https://www.dropbox.com/s/abc/b.pdf?dl=0"), "https://www.dropbox.com/s/abc/b.pdf?dl=1");
  assert.equal(directFileUrl("https://web.com/b.pdf"), "https://web.com/b.pdf");
});

// ── El enlace, comprobado al enviar ────────────────────────────
const reply = (body: string | Uint8Array, headers: Record<string, string>, status = 200) => async () => new Response(body as BodyInit, { status, headers });

test("un enlace se puede enviar si de verdad es un archivo de hasta 16 MB", async () => {
  assert.deepEqual(await checkFileLink("https://web.com/b.pdf", reply("%PDF-1.7 …", { "content-type": "application/pdf" })), { ok: true, mimeType: "application/pdf", kind: "DOCUMENT" });
  // Drive lo sirve como octet-stream: se mira el contenido.
  assert.deepEqual(await checkFileLink("https://drive.google.com/file/d/1/view", reply("%PDF-1.4 …", { "content-type": "application/octet-stream" })), { ok: true, mimeType: "application/pdf", kind: "DOCUMENT" });
  assert.deepEqual(await checkFileLink("https://web.com/foto", reply(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { "content-type": "image/jpeg" })), { ok: true, mimeType: "image/jpeg", kind: "IMAGE" });
  const html = await checkFileLink("https://web.com/b", reply("<!doctype html><html>", { "content-type": "text/html" }));
  assert.equal(html.ok, false);
  assert.match((html as { reason: string }).reason, /página web/);
  const fakePdf = await checkFileLink("https://web.com/b.pdf", reply("<!doctype html><html>login", { "content-type": "application/pdf" }));
  assert.equal(fakePdf.ok, false, "dice que es PDF pero es una página");
  assert.equal((await checkFileLink("https://web.com/b.pdf", reply("%PDF", { "content-type": "application/pdf", "content-length": String(17 * 1024 * 1024) }))).ok, false, "pasa de 16 MB");
  assert.equal((await checkFileLink("https://web.com/b.pdf", reply("no", {}, 404))).ok, false);
  const down = async () => {
    throw new Error("dirección no permitida");
  };
  assert.equal((await checkFileLink("https://web.com/b.pdf", down)).ok, false, "una dirección interna o caída");
});

test("al descargarlo se respeta el tope aunque el servidor no diga cuánto pesa", async () => {
  const ok = await downloadFileLink("https://web.com/b.pdf", reply("%PDF-1.7 hola", { "content-type": "application/pdf" }));
  assert.equal(ok.mimeType, "application/pdf");
  assert.equal(ok.buffer.toString(), "%PDF-1.7 hola");
  const big = new Uint8Array(17 * 1024 * 1024).fill(0x25);
  await assert.rejects(downloadFileLink("https://web.com/b.pdf", reply(big, { "content-type": "application/pdf" })), /16 MB/);
});

// ── Lo que lee el modelo ───────────────────────────────────────
const DEFS = [
  { key: "fechas", label: "Fechas", type: "text", unit: null },
  { key: "brochure", label: "Brochure", type: "file", unit: null },
  { key: "temario", label: "Temario", type: "file", unit: null },
];

test("al modelo se le dice qué archivos hay, nunca su dirección; el que falta cuenta como dato que falta", () => {
  const d = productDetails({ fechas: "30 de noviembre", brochure: STORED, temario: "no es un enlace" }, DEFS);
  assert.deepEqual(d, { details: { Fechas: "30 de noviembre" }, files: ["Brochure"], missingDetails: ["Temario"] });
  assert.doesNotMatch(JSON.stringify(d), /storage|http/);
  assert.deepEqual(productDetails({}, DEFS), { missingDetails: ["Fechas", "Brochure", "Temario"] });
  assert.deepEqual(productDetails({ fechas: "x" }, DEFS.slice(0, 1)), { details: { Fechas: "x" } });
});

test("de un producto sin archivo se le dice que no lo ofrezca (gpt-5-mini lo ofrecía igual)", () => {
  assert.equal(missingFilesNote([{ name: "Power BI", missing: ["Fechas"] }], ["Brochure"]), "");
  assert.equal(missingFilesNote([{ name: "Power BI", missing: ["Brochure"] }], []), "", "sin campos de archivo no hay nada que decir");
  const one = missingFilesNote([{ name: "Python", missing: ["Fechas", "Brochure"] }], ["Brochure", "Temario"]);
  assert.match(one, /«Brochure» de Python/);
  assert.match(one, /no lo ofrezcas ni prometas/);
  assert.doesNotMatch(one, /Fechas|Temario/);
  const two = missingFilesNote([{ name: "A", missing: ["Brochure"] }, { name: "B", missing: [] }, { name: "C", missing: ["Brochure", "Temario"] }], ["Brochure", "Temario"]);
  assert.match(two, /«Brochure» de A, «Brochure» de C, «Temario» de C/);
});

test("la acción solo existe si algún producto tiene un archivo", () => {
  const names = (c: typeof EMPTY_TOOL_CONTEXT) => resolveTools(["send_product_file"], c).map((t) => t.name);
  assert.deepEqual(names(EMPTY_TOOL_CONTEXT), []);
  const off = availableTools(EMPTY_TOOL_CONTEXT).find((t) => t.name === "send_product_file")!;
  assert.match(JSON.stringify(off), /Productos › Campos/);

  const one = { ...EMPTY_TOOL_CONTEXT, productFiles: [{ product: "Power BI", files: ["Brochure"] }] };
  const tool = resolveTools(["send_product_file"], one)[0]!;
  const props = tool.input_schema.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(props.product!.enum, ["Power BI"]);
  assert.equal(props.file, undefined, "con un solo tipo de archivo no hay que elegir");

  const two = resolveTools(["send_product_file"], { ...EMPTY_TOOL_CONTEXT, productFiles: [{ product: "A", files: ["Brochure", "Temario"] }] })[0]!;
  assert.deepEqual((two.input_schema.properties as Record<string, { enum?: string[] }>).file!.enum, ["Brochure", "Temario"]);

  const many = resolveTools(["send_product_file"], { ...EMPTY_TOOL_CONTEXT, productFiles: Array.from({ length: 80 }, (_, i) => ({ product: `P${i}`, files: ["Brochure"] })) })[0]!;
  assert.equal((many.input_schema.properties as Record<string, { enum?: string[] }>).product!.enum, undefined, "con un catálogo grande el nombre sale de search_products");
});

// ── La acción ──────────────────────────────────────────────────
type Sent = { type: string; mediaUrl?: string; caption?: string; text?: string; conversationId: string };
function actions(attributes: Record<string, string>, o: { channelKind?: string; mime?: string | null; link?: unknown } = {}) {
  const sent: Sent[] = [];
  const products = [
    { name: "Power BI", attributes },
    { name: "Excel avanzado", attributes: {} },
  ];
  const prisma = {
    product: {
      findFirst: async ({ where }: { where: { name: { equals: string } } }) => products.find((p) => p.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null,
    },
    productField: { findMany: async () => DEFS.filter((d) => d.type === "file").map(({ key, label }) => ({ key, label })) },
    conversation: { findUnique: async () => ({ channelKind: o.channelKind ?? "whatsapp" }) },
  };
  const messaging = { queueOutbound: async (input: Sent) => void sent.push(input) };
  const storage = {
    read: async (id: string) => (id === ID && o.mime !== null ? { buffer: Buffer.from("x"), mimeType: o.mime ?? "application/pdf", size: 1, fileName: "final_v3.pdf" } : null),
  };
  const svc = new AgentActionsService(prisma as never, { orgId: () => "org1" } as never, messaging as never, { emit: () => true } as never, {} as never, storage as never);
  (svc as unknown as { checkLink: unknown }).checkLink = async () => o.link ?? { ok: true, mimeType: "application/pdf", kind: "DOCUMENT" };
  return { svc, sent };
}
const send = (a: ReturnType<typeof actions>, input: Record<string, unknown>) => a.svc.execute("send_product_file", input, "ct1", "cv1");

test("un archivo subido sale como documento, con su nombre", async () => {
  const a = actions({ brochure: STORED });
  const out = await send(a, { product: "power bi", caption: "Aquí tienes 📄" });
  assert.equal(a.sent.length, 1);
  assert.deepEqual({ ...a.sent[0] }, { conversationId: "cv1", type: "DOCUMENT", mediaUrl: withMediaName(`storage://${ID}`, "Brochure Power BI.pdf"), caption: "Aquí tienes 📄" });
  assert.match(out, /Brochure/);
  assert.doesNotMatch(out, /storage/, "al modelo no se le da la referencia");
  assert.equal(a.svc.summarize("send_product_file", { product: "Power BI", file: "Brochure" }), "Enviar «Brochure» de «Power BI»");
});

test("una imagen sale como foto y un enlace bueno como documento", async () => {
  const img = actions({ brochure: STORED }, { mime: "image/png" });
  await send(img, { product: "Power BI" });
  assert.equal(img.sent[0]!.type, "IMAGE");

  const link = actions({ brochure: "https://drive.google.com/file/d/1AbC/view" });
  await send(link, { product: "Power BI" });
  assert.equal(link.sent[0]!.type, "DOCUMENT");
  assert.equal(link.sent[0]!.mediaUrl, withMediaName("https://drive.google.com/uc?export=download&id=1AbC", "Brochure Power BI.pdf"));
});

test("si el enlace no se puede enviar como archivo, va en texto y el modelo lo sabe", async () => {
  const a = actions({ brochure: "https://web.com/pagina" }, { link: { ok: false, reason: "es una página web, no un archivo" } });
  const out = await send(a, { product: "Power BI" });
  assert.equal(a.sent[0]!.type, "TEXT");
  assert.equal(a.sent[0]!.text, "Brochure de Power BI: https://web.com/pagina");
  assert.match(out, /no se pudo.*archivo.*página web/i);
  // Instagram y TikTok no admiten documentos: el enlace, también en texto.
  const ig = actions({ brochure: "https://web.com/b.pdf" }, { channelKind: "instagram" });
  await send(ig, { product: "Power BI" });
  assert.equal(ig.sent[0]!.type, "TEXT");
});

test("un archivo subido en un canal sin documentos no se promete: no sale nada y el modelo lo sabe", async () => {
  const a = actions({ brochure: STORED }, { channelKind: "instagram" });
  await assert.rejects(send(a, { product: "Power BI" }), /Instagram no admite/);
  assert.equal(a.sent.length, 0);
  const img = actions({ brochure: STORED }, { channelKind: "instagram", mime: "image/png" });
  await send(img, { product: "Power BI" });
  assert.equal(img.sent[0]!.type, "IMAGE", "una imagen sí");
  const ms = actions({ brochure: STORED }, { channelKind: "messenger" });
  await send(ms, { product: "Power BI" });
  assert.equal(ms.sent[0]!.type, "DOCUMENT", "Messenger sí los admite");
});

test("pedidos que no se pueden cumplir: explicados, sin enviar nada", async () => {
  const a = actions({ brochure: STORED, temario: "https://web.com/t.pdf" });
  await assert.rejects(send(a, { product: "Curso que no existe" }), /no existe.*search_products/);
  await assert.rejects(send(a, { product: "Excel avanzado" }), /no tiene archivos/);
  await assert.rejects(send(a, { product: "Power BI" }), /«Brochure», «Temario»/, "con dos, tiene que elegir");
  await assert.rejects(send(a, { product: "Power BI", file: "Factura" }), /«Factura».*«Brochure», «Temario»/);
  await send(a, { product: "Power BI", file: "temario" });
  assert.equal(a.sent.length, 1, "sin importar mayúsculas");
  await assert.rejects(a.svc.execute("send_product_file", { product: "Power BI" }, "ct1", null), /No hay conversación/);
  const lost = actions({ brochure: STORED }, { mime: null });
  await assert.rejects(send(lost, { product: "Power BI" }), /ya no está/);
});

// ── Lo que recibe WhatsApp ─────────────────────────────────────
function messaging(file: { mimeType: string; fileName: string } | null) {
  const calls: unknown[][] = [];
  const wa = {
    uploadMedia: async (...a: unknown[]) => (calls.push(["upload", a[1], a[2]]), "media1"),
    sendMediaById: async (...a: unknown[]) => (calls.push(["byId", a[1], a[2], a[3], a[5]]), { waMessageId: "w1" }),
    sendMedia: async (...a: unknown[]) => (calls.push(["link", a[1], a[2], a[3], a[5]]), { waMessageId: "w1" }),
  };
  const storage = { read: async () => (file ? { buffer: Buffer.from("x"), size: 1, ...file } : null) };
  const svc = Object.create(MessagingService.prototype) as Record<string, unknown>;
  svc.wa = wa;
  svc.storage = storage;
  svc.fetchFile = async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf" });
  const go = (type: string, mediaUrl: string, content: string | null = null) =>
    (svc as unknown as { sendMediaMessage(m: unknown, to: string, from?: string): Promise<unknown> }).sendMediaMessage({ id: "m1", type, mediaUrl, content }, "+51900", "ph1");
  return { go, calls };
}

test("un documento llega a WhatsApp con nombre: el del producto, o el del archivo que se subió", async () => {
  const a = messaging({ mimeType: "application/pdf", fileName: "final_v3.pdf" });
  await a.go("DOCUMENT", withMediaName(`storage://${ID}`, "Brochure Power BI.pdf"), "Aquí va");
  assert.deepEqual(a.calls, [
    ["upload", "application/pdf", "Brochure Power BI.pdf"],
    ["byId", "DOCUMENT", "media1", "Aquí va", "Brochure Power BI.pdf"],
  ]);
  const b = messaging({ mimeType: "application/pdf", fileName: "Lista de precios.pdf" });
  await b.go("DOCUMENT", `storage://${ID}`);
  assert.deepEqual(b.calls.at(-1), ["byId", "DOCUMENT", "media1", undefined, "Lista de precios.pdf"], "el del chat, las respuestas rápidas y los flujos");
  const c = messaging({ mimeType: "image/png", fileName: "foto.png" });
  await c.go("IMAGE", `storage://${ID}`);
  assert.equal(c.calls.at(-1)![4], undefined, "una foto no lleva nombre");
});

test("el enlace de un producto se descarga y se sube; una foto por enlace sigue como antes", async () => {
  const a = messaging(null);
  await a.go("DOCUMENT", withMediaName("https://drive.google.com/uc?export=download&id=1", "Brochure Power BI.pdf"));
  assert.deepEqual(a.calls, [
    ["upload", "application/pdf", "Brochure Power BI.pdf"],
    ["byId", "DOCUMENT", "media1", undefined, "Brochure Power BI.pdf"],
  ]);
  const b = messaging(null);
  await b.go("IMAGE", "https://tienda.com/foto.jpg", "Mírala");
  assert.deepEqual(b.calls, [["link", "IMAGE", "https://tienda.com/foto.jpg", "Mírala", undefined]]);
});

test("el nombre va en el mensaje a Meta solo en los documentos", async () => {
  const bodies: Record<string, unknown>[] = [];
  const p = Object.create(MetaWhatsAppProvider.prototype) as Record<string, unknown>;
  p.connection = { resolveCreds: async () => ({ token: "t", phoneNumberId: "1", version: "v21.0" }) };
  p.post = async (_c: unknown, body: Record<string, unknown>) => (bodies.push(body), { waMessageId: "w" });
  const prov = p as unknown as MetaWhatsAppProvider;
  await prov.sendMediaById("+51", "DOCUMENT", "m1", "pie", undefined, "Brochure.pdf");
  await prov.sendMediaById("+51", "IMAGE", "m1", undefined, undefined, "foto.png");
  await prov.sendMedia("+51", "DOCUMENT", "https://x.com/b.pdf", undefined, undefined, "B.pdf");
  assert.deepEqual(bodies[0]!.document, { id: "m1", caption: "pie", filename: "Brochure.pdf" });
  assert.deepEqual(bodies[1]!.image, { id: "m1" });
  assert.deepEqual(bodies[2]!.document, { link: "https://x.com/b.pdf", filename: "B.pdf" });
});

// ── Retención de adjuntos ──────────────────────────────────────
test("el borrado por plan no toca un archivo que sigue en uso", async () => {
  const id = (n: number) => `6f1c2a34-5b6d-4e7f-8a90-12345678900${n}`;
  const removed: string[] = [];
  const batch = [1, 2, 3, 4].map((n) => ({ id: `m${n}`, mediaUrl: n === 1 ? withMediaName(`storage://${id(1)}`, "Brochure.pdf") : `storage://${id(n)}` }));
  let first = true;
  let purged: unknown = null;
  const prisma = {
    message: {
      findMany: async () => {
        if (!first) return [];
        first = false;
        return batch;
      },
      updateMany: async (a: unknown) => void (purged = a),
    },
    product: { findMany: async () => [{ attributes: { brochure: withMediaName(`storage://${id(1)}`, "x.pdf") } }] },
    quickReply: { findMany: async () => [{ mediaUrl: `storage://${id(2)}` }] },
    paymentMethod: { findMany: async () => [] as unknown[] },
    flow: { findMany: async () => [{ nodes: [{ data: { mediaUrl: `storage://${id(3)}` } }] }] },
  };
  const svc = new MediaRetentionService(prisma as never, { remove: async (x: string) => void removed.push(x) } as never);
  assert.equal(await svc.purgeOrg("org1", 30), 4);
  assert.deepEqual(removed, [id(4)], "solo se borra el que nadie usa");
  assert.ok(purged, "los mensajes sí quedan marcados");
});
