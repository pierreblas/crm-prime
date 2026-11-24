/**
 * El encabezado de las plantillas (imagen, video, documento): sale siempre, con
 * el archivo elegido en el envío o, si no, con el de la plantilla. Meta
 * rechazaba «header: Format mismatch, expected IMAGE, received UNKNOWN»
 * (#132012) porque flujos, seguimientos, citas y la bienvenida de formularios
 * no mandaban ninguno. Sin base de datos ni red: dobles.
 *
 *   npm run test:templateheader --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MessageAuthor, type TemplateButton, type TemplateHeader } from "@crm/shared";
import { TemplateFillService, headerMediaFor } from "../src/modules/campaigns/template-fill.service";
import { parseMetaTemplate, TemplateService } from "../src/modules/campaigns/template.service";
import { MessagingService } from "../src/modules/messaging/messaging.service";
import { MediaRetentionService } from "../src/modules/plans/media-retention.service";
import { buildTemplateComponents } from "../src/modules/whatsapp/providers/meta-whatsapp.provider";

const ID = (n: number) => `6f1c2a34-5b6d-4e7f-8a90-12345678900${n}`;
const REF = (n: number) => `storage://${ID(n)}`;
const contact = { name: "Ana", phone: "+51900000001" };
const FILES: Record<string, { mimeType: string; fileName: string }> = {
  [ID(1)]: { mimeType: "image/jpeg", fileName: "promo.jpg" },
  [ID(2)]: { mimeType: "image/png", fileName: "otra.png" },
  [ID(3)]: { mimeType: "application/pdf", fileName: "temario.pdf" },
  [ID(4)]: { mimeType: "video/mp4", fileName: "clip.mp4" },
};
const storageOf = (saved: unknown[] = []) => ({
  read: async (id: string) => (FILES[id] ? { buffer: Buffer.from("x"), size: 1, ...FILES[id]! } : null),
  save: async (buffer: Buffer, mimeType: string, name: string) => {
    saved.push({ mimeType, name, bytes: buffer.length });
    return { id: ID(9), mimeType, size: buffer.length };
  },
  remove: async () => undefined,
});
const uploads: string[] = [];
const wa = { uploadMedia: async (_b: Buffer, mime: string) => (uploads.push(mime), "media-1") };
const fills = new TemplateFillService(wa as never, storageOf() as never);
const tpl = (header: TemplateHeader | null, o: { body?: string; buttons?: TemplateButton[] } = {}) => ({ name: "promo", language: "es", header, buttons: o.buttons ?? [], body: o.body ?? "Hola {{1}}" });
/** Lo que mandan flujos, seguimientos y la bienvenida de formularios: solo el cuerpo. */
const AUTO = { body: [{ index: 1, source: "contact_name" as const }], urlButtons: [] };
const header = (spec: Parameters<typeof buildTemplateComponents>[0]) => buildTemplateComponents(spec).find((c) => c.type === "header");

// ── El envío ───────────────────────────────────────────────────
test("sin archivo en el envío, sale el de la plantilla (el fallo #132012)", async () => {
  const spec = await fills.build(tpl({ format: "IMAGE", example: REF(1) }), AUTO, contact);
  assert.deepEqual(header(spec), { type: "header", parameters: [{ type: "image", image: { id: "media-1" } }] });
  const doc = await fills.build(tpl({ format: "DOCUMENT", example: REF(3) }), AUTO, contact);
  assert.deepEqual(header(doc), { type: "header", parameters: [{ type: "document", document: { id: "media-1", filename: "temario.pdf" } }] });
  const video = await fills.build(tpl({ format: "VIDEO", example: REF(4) }), AUTO, contact);
  assert.equal((header(video)!.parameters as { type: string }[])[0]!.type, "video");
});

test("el archivo elegido en el envío manda sobre el de la plantilla", async () => {
  uploads.length = 0;
  await fills.build(tpl({ format: "IMAGE", example: REF(1) }), { ...AUTO, headerMediaUrl: REF(2) }, contact);
  assert.deepEqual(uploads, ["image/png"]);
  assert.equal(headerMediaFor({ format: "IMAGE", example: REF(1) }, { ...AUTO, headerMediaUrl: REF(2) }), REF(2));
  assert.equal(headerMediaFor({ format: "IMAGE", example: REF(1) }, AUTO), REF(1));
  assert.equal(headerMediaFor({ format: "TEXT", text: "Hola", example: "x" }, AUTO), null);
  assert.equal(headerMediaFor(null, AUTO), null);
});

test("si no hay ninguno, se dice qué hacer antes de molestar a Meta", async () => {
  await assert.rejects(fills.build(tpl({ format: "IMAGE" }), AUTO, contact), /lleva una imagen.*Difusiones › Plantillas/);
  await assert.rejects(fills.build(tpl({ format: "DOCUMENT" }), AUTO, contact), /lleva un documento/);
  await assert.rejects(fills.build(tpl({ format: "VIDEO" }), AUTO, contact), /lleva un video/);
  await assert.rejects(fills.build(tpl({ format: "IMAGE", example: REF(8) }), AUTO, contact), /ya no está disponible/);
});

test("los demás huecos obligatorios también se dicen claro", async () => {
  await assert.rejects(fills.build(tpl({ format: "TEXT", text: "Oferta {{1}}" }), AUTO, contact), /encabezado.*variable/);
  await assert.rejects(fills.build(tpl({ format: "LOCATION" }), AUTO, contact), /ubicación/);
  const link: TemplateButton = { type: "URL", text: "Ver curso", url: "https://web.com/{{1}}" } as TemplateButton;
  await assert.rejects(fills.build(tpl(null, { buttons: [link] }), AUTO, contact), /botón «Ver curso»/);
  // Lo que ya salía sigue saliendo.
  const ok = await fills.build(tpl({ format: "TEXT", text: "Hola" }, { buttons: [{ type: "URL", text: "Web", url: "https://web.com" } as TemplateButton] }), AUTO, contact);
  assert.deepEqual(buildTemplateComponents(ok).map((c) => c.type), ["body"]);
  const full = await fills.build(tpl({ format: "TEXT", text: "Oferta {{1}}" }, { buttons: [link] }), { ...AUTO, headerText: { index: 1, source: "static", value: "Power BI" }, urlButtons: [{ index: 0, value: "power-bi" }] }, contact);
  assert.deepEqual(buildTemplateComponents(full).map((c) => c.type), ["header", "body", "button"]);
});

test("el mensaje del chat guarda la imagen que salió", async () => {
  const created: Record<string, unknown>[] = [];
  const svc = Object.create(MessagingService.prototype) as Record<string, unknown>;
  Object.assign(svc, {
    logger: { log() {}, warn() {}, error() {} },
    events: { emit: () => true },
    notify: () => undefined,
    outboundSent: () => undefined,
    humanPauseMs: 1,
    wa: { sendTemplate: async () => ({ waMessageId: "w1" }) },
    fills: { build: async () => ({ header: { format: "IMAGE", example: REF(1) } }), preview: () => "Hola Ana" },
    prisma: {
      conversation: { findUnique: async () => ({ id: "cv1", orgId: "o1", channelKind: "whatsapp", contact, channel: { phoneNumberId: "1" } }), update: async () => ({}) },
      template: { findUnique: async () => ({ id: "t1", name: "promo", language: "es", status: "APPROVED", body: "Hola {{1}}", header: { format: "IMAGE", example: REF(1) }, buttons: [] }) },
      message: {
        create: async (a: { data: Record<string, unknown> }) => (created.push(a.data), { id: "m1", createdAt: new Date(0), ...a.data }),
        update: async (a: { data: Record<string, unknown> }) => ({ id: "m1", direction: "OUTBOUND", type: "TEMPLATE", author: "AI", content: "x", mediaUrl: null, createdAt: new Date(0), ...a.data }),
      },
    },
  });
  await (svc as unknown as MessagingService).sendTemplateMessage({ conversationId: "cv1", templateId: "t1", fill: AUTO } as never, MessageAuthor.AI);
  assert.equal(created[0]!.mediaUrl, REF(1));
});

test("el chat sabe si el archivo de una plantilla es foto, video o documento", () => {
  const dto = (m: Record<string, unknown>) =>
    (Object.create(MessagingService.prototype) as { toMessageDto(m: unknown): { mediaKind?: string | null } }).toMessageDto({ id: "m1", direction: "OUTBOUND", type: "TEMPLATE", author: "AI", content: "Hola", mediaUrl: REF(1), status: "SENT", createdAt: new Date(0), ...m }).mediaKind ?? null;
  assert.equal(dto({ template: { header: { format: "IMAGE" } } }), "IMAGE");
  assert.equal(dto({ template: { header: { format: "VIDEO" } } }), "VIDEO");
  assert.equal(dto({ template: { header: { format: "DOCUMENT" } } }), "DOCUMENT");
  assert.equal(dto({ template: { header: { format: "TEXT", text: "x" } } }), null);
  assert.equal(dto({ template: null }), null, "la plantilla se borró: se ve como documento, igual que antes");
  assert.equal(dto({ mediaUrl: null, template: { header: { format: "IMAGE" } } }), null);
  assert.equal(dto({ type: "IMAGE", template: null }), null, "los demás ya dicen su tipo");
});

test("y la consulta de la bandeja trae el encabezado de la plantilla", async () => {
  let asked: { include?: Record<string, unknown> } = {};
  const svc = Object.create(MessagingService.prototype) as Record<string, unknown>;
  svc.prisma = { message: { findMany: async (a: typeof asked) => ((asked = a), [{ id: "m1", direction: "OUTBOUND", type: "TEMPLATE", author: "AI", content: "Hola", mediaUrl: REF(1), status: "SENT", createdAt: new Date(0), template: { header: { format: "IMAGE" } } }]) } };
  const rows = await (svc as unknown as MessagingService).getMessages("cv1");
  assert.ok(asked.include?.template);
  assert.equal(rows[0]!.mediaKind, "IMAGE");
});

// ── Sincronizar con Meta ───────────────────────────────────────
const META_IMG = { id: "77", name: "promo", language: "es", category: "MARKETING", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE", example: { header_handle: ["https://scontent.whatsapp.net/v/promo.jpg?oe=1"] } }, { type: "BODY", text: "Hola {{1}}" }] };

test("de Meta se lee la imagen con la que se aprobó", () => {
  assert.equal(parseMetaTemplate(META_IMG as never).headerSample, "https://scontent.whatsapp.net/v/promo.jpg?oe=1");
  assert.equal(parseMetaTemplate({ ...META_IMG, components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "x" }] } as never).headerSample, null);
  assert.equal(parseMetaTemplate({ ...META_IMG, components: [{ type: "HEADER", format: "IMAGE", example: { header_handle: ["4::aW1n"] } }] } as never).headerSample, null, "un identificador no es un enlace");
});

function templates(existing: Record<string, unknown> | null, download: () => Promise<{ buffer: Buffer; mimeType: string }>) {
  const writes: Record<string, unknown>[] = [];
  const saved: unknown[] = [];
  const svc = new TemplateService(
    {
      template: {
        findFirst: async () => existing,
        findUnique: async () => existing,
        update: async (a: { data: Record<string, unknown> }) => (writes.push(a.data), { ...(existing ?? {}), createdAt: new Date(0), syncedAt: null, ...a.data }),
        create: async (a: { data: Record<string, unknown> }) => (writes.push(a.data), a.data),
      },
    } as never,
    { orgId: () => "o1" } as never,
    { list: async () => [META_IMG] } as never,
    storageOf(saved) as never,
  );
  (svc as unknown as { logger: unknown }).logger = { log() {}, warn() {} };
  let calls = 0;
  (svc as unknown as { fetchSample: unknown }).fetchSample = async () => (calls++, download());
  return { svc, writes, saved, calls: () => calls };
}
const JPG = async () => ({ buffer: Buffer.from("jpg"), mimeType: "image/jpeg" });

test("sincronizar guarda la imagen de Meta, una sola vez", async () => {
  const a = templates(null, JPG);
  await a.svc.importFromMeta();
  assert.deepEqual(a.writes[0]!.header, { format: "IMAGE", example: REF(9) });
  assert.deepEqual(a.saved, [{ mimeType: "image/jpeg", name: "promo.jpg", bytes: 3 }]);
});

test("sincronizar no borra ni cambia la que ya tenía (antes la perdía)", async () => {
  const a = templates({ id: "t1", header: { format: "IMAGE", example: REF(1) } }, JPG);
  await a.svc.importFromMeta();
  assert.deepEqual(a.writes[0]!.header, { format: "IMAGE", example: REF(1) });
  assert.equal(a.calls(), 0);
  // Cambió de imagen a documento en Meta: la vieja no vale.
  const b = templates({ id: "t1", header: { format: "DOCUMENT", example: REF(3) } }, JPG);
  await b.svc.importFromMeta();
  assert.deepEqual(b.writes[0]!.header, { format: "IMAGE", example: REF(9) });
});

test("si la imagen de Meta no se puede bajar, la sincronización sigue", async () => {
  const a = templates(null, async () => {
    throw new Error("403");
  });
  const r = await a.svc.importFromMeta();
  assert.equal(r.imported, 1);
  assert.deepEqual(a.writes[0]!.header, { format: "IMAGE" });
  // O si lo que baja no es lo que toca.
  const b = templates(null, async () => ({ buffer: Buffer.from("%PDF"), mimeType: "application/pdf" }));
  await b.svc.importFromMeta();
  assert.deepEqual(b.writes[0]!.header, { format: "IMAGE" });
});

// ── Sin tener que importar nada ────────────────────────────────
test("una plantilla aprobada sin imagen guardada la trae de Meta al enviarla, y sale", async () => {
  const asked: string[] = [];
  const auto = new TemplateFillService(wa as never, storageOf() as never, { recoverHeader: async (id: string) => (asked.push(id), { format: "IMAGE", example: REF(1) }) } as never);
  const spec = await auto.build({ ...tpl({ format: "IMAGE" }), id: "t1" }, AUTO, contact);
  assert.deepEqual(asked, ["t1"]);
  assert.deepEqual(header(spec), { type: "header", parameters: [{ type: "image", image: { id: "media-1" } }] });
  assert.equal(headerMediaFor(spec.header, AUTO), REF(1), "y el chat la enseña");
  // Con una elegida o guardada no se molesta a Meta.
  await auto.build({ ...tpl({ format: "IMAGE", example: REF(1) }), id: "t1" }, AUTO, contact);
  await auto.build({ ...tpl({ format: "IMAGE" }), id: "t1" }, { ...AUTO, headerMediaUrl: REF(2) }, contact);
  assert.equal(asked.length, 1);
  // Si Meta tampoco la da, se dice qué hacer.
  const none = new TemplateFillService(wa as never, storageOf() as never, { recoverHeader: async () => ({ format: "IMAGE" }) } as never);
  await assert.rejects(none.build({ ...tpl({ format: "IMAGE" }), id: "t1" }, AUTO, contact), /lleva una imagen/);
});

test("se trae una vez, se guarda y, si falla, no se insiste en cada destinatario", async () => {
  const row = { id: "t1", waTemplateId: "77", name: "promo", header: { format: "IMAGE" } };
  const a = templates(row, JPG);
  let gets = 0;
  (a.svc as unknown as { meta: unknown }).meta = { get: async (id: string) => (gets++, assert.equal(id, "77"), META_IMG) };
  assert.deepEqual(await a.svc.recoverHeader("t1"), { format: "IMAGE", example: REF(9) });
  assert.deepEqual(a.writes, [{ header: { format: "IMAGE", example: REF(9) } }]);

  const b = templates(row, JPG);
  let fails = 0;
  (b.svc as unknown as { meta: unknown }).meta = { get: async () => { fails++; throw new Error("403"); } };
  assert.deepEqual(await b.svc.recoverHeader("t1"), { format: "IMAGE" });
  assert.deepEqual(await b.svc.recoverHeader("t1"), { format: "IMAGE" });
  assert.equal(fails, 1);
  assert.equal(b.writes.length, 0);

  const local = templates({ ...row, waTemplateId: null }, JPG);
  assert.deepEqual(await local.svc.recoverHeader("t1"), { format: "IMAGE" }, "no está en Meta: nada que traer");
  const has = templates({ ...row, header: { format: "IMAGE", example: REF(1) } }, JPG);
  assert.deepEqual(await has.svc.recoverHeader("t1"), { format: "IMAGE", example: REF(1) });
  assert.equal(await templates(null, JPG).svc.recoverHeader("t1"), null);
});

// ── Elegirla a mano ────────────────────────────────────────────
test("se puede elegir el archivo de la plantilla, también si vino de Meta, y tiene que ser del tipo que pide", async () => {
  const row = { id: "t1", waTemplateId: "77", name: "promo", language: "es", category: "MARKETING", status: "APPROVED", header: { format: "IMAGE" }, body: "Hola", footer: null, buttons: [], variables: [], rejectedReason: null, readOnly: true, syncedAt: null, createdAt: new Date(0) };
  const a = templates(row, JPG);
  const dto = await a.svc.setHeaderMedia("t1", REF(1));
  assert.deepEqual(a.writes[0], { header: { format: "IMAGE", example: REF(1) } });
  assert.deepEqual(dto.header, { format: "IMAGE", example: REF(1) });
  await assert.rejects(a.svc.setHeaderMedia("t1", REF(3)), /imagen/);
  await assert.rejects(a.svc.setHeaderMedia("t1", REF(8)), /ya no está/);
  await assert.rejects(a.svc.setHeaderMedia("t1", "https://x.com/a.jpg"), /Sube/);
  const text = templates({ ...row, header: { format: "TEXT", text: "Hola" } }, JPG);
  await assert.rejects(text.svc.setHeaderMedia("t1", REF(1)), /no lleva/);
  await assert.rejects(templates(null, JPG).svc.setHeaderMedia("t1", REF(1)), /no encontrada/);
});

// ── Retención ──────────────────────────────────────────────────
test("la retención no borra la imagen de una plantilla ni la de una difusión", async () => {
  const removed: string[] = [];
  let first = true;
  const prisma = {
    message: { findMany: async () => (first ? ((first = false), [1, 2, 3].map((n) => ({ id: `m${n}`, mediaUrl: REF(n) }))) : []), updateMany: async () => undefined },
    product: { findMany: async () => [] },
    quickReply: { findMany: async () => [] },
    paymentMethod: { findMany: async () => [] },
    flow: { findMany: async () => [] },
    template: { findMany: async () => [{ header: { format: "IMAGE", example: REF(1) } }] },
    campaign: { findMany: async () => [{ variableValues: { headerMediaUrl: REF(2) } }] },
  };
  await new MediaRetentionService(prisma as never, { remove: async (x: string) => void removed.push(x) } as never).purgeOrg("o1", 30);
  assert.deepEqual(removed, [ID(3)]);
});
