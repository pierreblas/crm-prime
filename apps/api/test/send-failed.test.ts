/**
 * Un envío que falla se ve y dice por qué: el motivo llega a la pantalla, un
 * aviso de fallo no se pierde ni lo tapa otro, y una plantilla automática que
 * no llega a salir deja rastro en el chat. Sin base de datos ni red: dobles.
 *
 *   npm run test:sendfailed --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MessageAuthor, MessageStatus } from "@crm/shared";
import { MessagingService } from "../src/modules/messaging/messaging.service";
import { InboundProcessor } from "../src/modules/whatsapp/processors/inbound.processor";

type Row = Record<string, unknown>;
const REASON = "Meta no lo entregó para cuidar la experiencia del cliente (Meta #131049)";

function messaging(o: { row?: Row | null; template?: Row | null; build?: () => Promise<unknown>; send?: () => Promise<unknown>; channelKind?: string } = {}) {
  const updates: Row[] = [];
  const created: Row[] = [];
  let notified = 0;
  let row = o.row ?? null;
  const svc = Object.create(MessagingService.prototype) as Record<string, unknown>;
  svc.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  svc.events = { emit: () => true };
  svc.notify = () => void notified++;
  svc.outboundSent = () => undefined;
  svc.humanPauseMs = 1;
  svc.wa = { sendTemplate: o.send ?? (async () => ({ waMessageId: "wamid.1" })) };
  svc.fills = { build: o.build ?? (async () => ({ name: "t" })), preview: (body: string) => `${body} (relleno)` };
  svc.prisma = {
    message: {
      findUnique: async () => row,
      update: async (a: { data: Row }) => {
        updates.push(a.data);
        row = { ...(row ?? {}), ...a.data };
        return { id: "m1", direction: "OUTBOUND", type: "TEMPLATE", author: "AI", content: "x", mediaUrl: null, status: "SENT", createdAt: new Date(0), ...row };
      },
      create: async (a: { data: Row }) => {
        created.push(a.data);
        return { id: "m1", createdAt: new Date(0), ...a.data };
      },
    },
    conversation: {
      findUnique: async () => ({ id: "cv1", orgId: "org1", channelKind: o.channelKind ?? "whatsapp", contact: { phone: "+51900", name: "Ana" }, channel: { phoneNumberId: "1" } }),
      update: async () => ({}),
    },
    template: { findUnique: async () => (o.template === undefined ? { id: "t1", name: "bienvenida", language: "es", status: "APPROVED", body: "Hola {{1}}", header: null, buttons: [] } : o.template) },
  };
  return { svc: svc as unknown as MessagingService, updates, created, notified: () => notified };
}

// ── Lo que ve la pantalla ──────────────────────────────────────
const dto = (m: Row) =>
  (messaging().svc as unknown as { toMessageDto(m: Row): { failedReason: string | null } }).toMessageDto({ id: "m1", direction: "OUTBOUND", type: "TEMPLATE", author: "AI", content: "x", mediaUrl: null, createdAt: new Date(0), ...m });

test("el motivo del fallo llega a la pantalla; en los demás estados, no", () => {
  assert.equal(dto({ status: "FAILED", errorReason: REASON }).failedReason, REASON);
  assert.equal(dto({ status: "FAILED", errorReason: null }).failedReason, null);
  assert.equal(dto({ status: "DELIVERED", errorReason: REASON }).failedReason, null, "un reintento que sí llegó no arrastra el motivo viejo");
});

// ── Los avisos de Meta ─────────────────────────────────────────
const sent = { conversationId: "cv1", campaignId: null, status: "SENT" };

test("un «enviado» que llega después del fallo no lo tapa; un «entregado» sí", async () => {
  const a = messaging({ row: { ...sent } });
  assert.equal(await a.svc.handleStatus("w1", MessageStatus.FAILED, REASON), true);
  assert.deepEqual(a.updates, [{ status: "FAILED", errorReason: REASON }]);
  await a.svc.handleStatus("w1", MessageStatus.SENT);
  assert.equal(a.updates.length, 1, "el «enviado» atrasado se ignora");
  await a.svc.handleStatus("w1", MessageStatus.DELIVERED);
  assert.deepEqual(a.updates.at(-1), { status: "DELIVERED", errorReason: null }, "llegó de verdad: se quita el fallo");
});

test("el orden normal sigue igual", async () => {
  const a = messaging({ row: { ...sent } });
  await a.svc.handleStatus("w1", MessageStatus.READ);
  await a.svc.handleStatus("w1", MessageStatus.DELIVERED);
  assert.equal(a.updates.length, 1, "un «entregado» atrasado no devuelve el «leído»");
  assert.equal(await messaging({ row: null }).svc.handleStatus("w1", MessageStatus.SENT), false, "de un mensaje que no es nuestro");
});

test("un fallo que llega antes de guardar el mensaje se reintenta en vez de perderse", async () => {
  const run = async (status: MessageStatus, attemptsMade: number, found: boolean) => {
    const p = Object.create(InboundProcessor.prototype) as Record<string, unknown>;
    p.messaging = { handleStatus: async () => found };
    return (p as unknown as { dispatch(j: unknown): Promise<void> }).dispatch({ attemptsMade, data: { kind: "status", waMessageId: "w1", status, errorReason: REASON } });
  };
  await assert.rejects(run(MessageStatus.FAILED, 0, false), /todavía no/);
  await assert.rejects(run(MessageStatus.FAILED, 1, false), /todavía no/);
  await run(MessageStatus.FAILED, 2, false); // no es nuestro: se deja
  await run(MessageStatus.SENT, 0, false); // un «enviado» perdido no importa
  await run(MessageStatus.FAILED, 0, true);
});

// ── Plantillas que no llegan a salir ───────────────────────────
const tpl = { conversationId: "cv1", templateId: "t1", fill: { body: [], urlButtons: [] } } as never;

test("una plantilla automática que no se puede rellenar queda en el chat con su motivo", async () => {
  const a = messaging({
    build: async () => {
      throw new Error("Falta el valor de la variable {{2}}");
    },
  });
  await assert.rejects(a.svc.sendTemplateMessage(tpl, MessageAuthor.AI), /\{\{2\}\}/);
  assert.equal(a.created.length, 1);
  assert.deepEqual(
    { status: a.created[0]!.status, reason: a.created[0]!.errorReason, type: a.created[0]!.type, author: a.created[0]!.author, content: a.created[0]!.content, templateId: a.created[0]!.templateId },
    { status: "FAILED", reason: "Falta el valor de la variable {{2}}", type: "TEMPLATE", author: "AI", content: "Hola {{1}}", templateId: "t1" },
  );
  assert.ok(a.notified() > 0, "la bandeja se entera");
});

test("también si la plantilla no está aprobada", async () => {
  const a = messaging({ template: { id: "t1", name: "bienvenida", language: "es", status: "PAUSED", body: "Hola", header: null, buttons: [] } });
  await assert.rejects(a.svc.sendTemplateMessage(tpl, MessageAuthor.AI), /no está aprobada/);
  assert.match(String(a.created[0]!.errorReason), /no está aprobada/);
});

test("a mano no se ensucia el chat: quien la envía ya ve el motivo al momento", async () => {
  const a = messaging({
    build: async () => {
      throw new Error("Falta el valor de la variable {{2}}");
    },
  });
  await assert.rejects(a.svc.sendTemplateMessage(tpl, MessageAuthor.HUMAN), /\{\{2\}\}/);
  assert.equal(a.created.length, 0);
});

test("en Instagram no se deja rastro: ahí no hay plantillas", async () => {
  const a = messaging({ channelKind: "instagram" });
  await assert.rejects(a.svc.sendTemplateMessage(tpl, MessageAuthor.AI), /son de WhatsApp/);
  assert.equal(a.created.length, 0);
});

test("si Meta la rechaza al enviarla, el motivo queda en el mensaje, una sola vez", async () => {
  const a = messaging({
    send: async () => {
      throw new Error(REASON);
    },
  });
  await assert.rejects(a.svc.sendTemplateMessage(tpl, MessageAuthor.AI));
  assert.equal(a.created.length, 1);
  assert.deepEqual(a.updates.at(-1), { status: "FAILED", errorReason: REASON });
});
