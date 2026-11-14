/**
 * Seguimientos automáticos: las reglas que no tocan base de datos (qué se
 * guarda, qué toque queda programado y para cuándo, en qué chats aplica) y la
 * validación de la secuencia (pasadas 24 h, solo plantilla).
 *
 *   npm run test:followups --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { followUpTimeline, followUpsSchema, type BusinessHours, type FollowUpStep, type FollowUps } from "@crm/shared";
import { FOLLOW_UP_CANCELLED, followUpAllowed, parseFollowUps, planFollowUp } from "../src/modules/ai/follow-up.rules";
import { firstOpenAtOrAfter, lastOpenAtOrBefore } from "../src/common/utils/business-hours";
import { FollowUpService } from "../src/modules/ai/follow-up.service";

const base = { timing: "after" as const, beforeCloseMinutes: 60, text: "", templateId: null };
const ai = (afterMinutes: number): FollowUpStep => ({ ...base, afterMinutes, kind: "ai" });
const text = (afterMinutes: number): FollowUpStep => ({ ...base, afterMinutes, kind: "text", text: "¿Pudiste verlo?" });
const template = (afterMinutes: number): FollowUpStep => ({ ...base, afterMinutes, kind: "template", templateId: "tpl_1" });
/** Un toque de texto que sale `minutes` antes de que se cierre la ventana. */
const beforeClose = (minutes: number): FollowUpStep => ({ ...text(120), timing: "before_close", beforeCloseMinutes: minutes });
const seq = (steps: FollowUpStep[], extra: Partial<FollowUps> = {}): FollowUps => ({
  enabled: true,
  steps,
  includeHuman: false,
  keepInWindow: false,
  ...extra,
});

const at = (iso: string) => new Date(iso);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Lunes a sábado de 9 a 18, hora de Lima (UTC-5, sin cambio de hora). */
const HOURS: BusinessHours = {
  timezone: "America/Lima",
  days: {
    mon: { from: "09:00", to: "18:00" },
    tue: { from: "09:00", to: "18:00" },
    wed: { from: "09:00", to: "18:00" },
    thu: { from: "09:00", to: "18:00" },
    fri: { from: "09:00", to: "18:00" },
    sat: { from: "09:00", to: "18:00" },
    sun: null,
  },
};

test("parseFollowUps: solo cuenta lo activado y con toques", () => {
  assert.equal(parseFollowUps(null), null);
  assert.equal(parseFollowUps("basura"), null);
  assert.equal(parseFollowUps({ enabled: false, steps: [ai(60)] }), null);
  assert.equal(parseFollowUps({ enabled: true, steps: [] }), null);
  const ok = parseFollowUps({ enabled: true, steps: [ai(120)] });
  assert.equal(ok?.steps.length, 1);
  assert.equal(ok?.includeHuman, false);
});

test("parseFollowUps: lo guardado antes de «antes del cierre» sigue valiendo, sin adelantar toques", () => {
  const old = parseFollowUps({
    enabled: true,
    steps: [
      { afterMinutes: 120, kind: "ai", text: "", templateId: null },
      { afterMinutes: 1440, kind: "template", text: "", templateId: "tpl_1" },
    ],
    includeHuman: false,
  });
  assert.equal(old?.steps[0]?.timing, "after");
  assert.equal(old?.steps[0]?.beforeCloseMinutes, 60);
  assert.equal(old?.keepInWindow, false);
});

test("plan: «tras X de silencio» cuenta desde nuestro mensaje; al acabar o cancelado, nada", () => {
  const from = at("2026-10-20T10:00:00Z");
  const window = at("2026-10-21T09:59:50Z");
  const cfg = seq([ai(120), template(1440)]);
  assert.deepEqual(planFollowUp(cfg, 0, from, window), { step: 0, dueAt: at("2026-10-20T12:00:00Z"), skipped: [], movedUp: false });
  assert.equal(iso(planFollowUp(cfg, 1, from, window).dueAt), "2026-10-21T10:00:00.000Z");
  assert.deepEqual(planFollowUp(cfg, 2, from, window), { step: 2, dueAt: null, skipped: [], movedUp: false });
  // Un plan que ya iba más allá de la secuencia (se quitaron toques) no retrocede.
  assert.equal(planFollowUp(cfg, 4, from, window).step, 4);
  assert.deepEqual(planFollowUp(cfg, FOLLOW_UP_CANCELLED, from, window), { step: FOLLOW_UP_CANCELLED, dueAt: null, skipped: [], movedUp: false });
});

test("plan: «antes del cierre» sale ese rato antes de que se cierre la ventana", () => {
  const window = at("2026-10-21T09:59:50Z");
  const cfg = seq([ai(120), beforeClose(60), template(1440)]);
  const plan = planFollowUp(cfg, 1, at("2026-10-20T12:00:00Z"), window);
  assert.deepEqual(plan, { step: 1, dueAt: at("2026-10-21T08:59:50Z"), skipped: [], movedUp: false });
  // No depende de cuándo salió nuestro mensaje: lo fija el cierre.
  assert.equal(iso(planFollowUp(cfg, 1, at("2026-10-20T19:30:00Z"), window).dueAt), "2026-10-21T08:59:50.000Z");
});

test("plan: un «antes del cierre» que ya no llega se salta y queda dicho por qué", () => {
  const from = at("2026-10-20T10:00:00Z");
  const cfg = seq([ai(120), beforeClose(60), template(1440)]);
  // Ventana cerrada (el chat lo retomamos nosotros con una plantilla).
  assert.deepEqual(planFollowUp(cfg, 1, from, null), {
    step: 2,
    dueAt: at("2026-10-21T10:00:00Z"),
    skipped: [{ step: 1, reason: "window_closed" }],
    movedUp: false,
  });
  assert.deepEqual(planFollowUp(cfg, 1, from, at("2026-10-20T09:00:00Z")).skipped, [{ step: 1, reason: "window_closed" }]);
  // Quedan 30 min para el cierre y el toque iba 60 min antes.
  const late = planFollowUp(cfg, 1, from, at("2026-10-20T10:30:00Z"));
  assert.deepEqual(late.skipped, [{ step: 1, reason: "no_time" }]);
  assert.equal(late.step, 2);
  // Era el último: la secuencia termina.
  assert.deepEqual(planFollowUp(seq([beforeClose(60)]), 0, from, null), {
    step: 1,
    dueAt: null,
    skipped: [{ step: 0, reason: "window_closed" }],
    movedUp: false,
  });
});

test("plan: con keepInWindow, un toque de texto o de IA que caería fuera se adelanta al cierre", () => {
  const window = at("2026-10-21T10:00:00Z");
  const late = at("2026-10-21T01:00:00Z"); // nuestro mensaje salió 15 h después del cliente
  const cfg = seq([text(240), text(720)], { keepInWindow: true });
  // Cabe: no se toca.
  assert.deepEqual(planFollowUp(cfg, 0, late, window), { step: 0, dueAt: at("2026-10-21T05:00:00Z"), skipped: [], movedUp: false });
  // Saldría 3 h después del cierre: pasa a 15 min antes.
  assert.deepEqual(planFollowUp(cfg, 1, late, window), { step: 1, dueAt: at("2026-10-21T09:45:00Z"), skipped: [], movedUp: true });
  // Apagado (lo guardado de antes): se queda donde estaba y al vencer se omite.
  assert.deepEqual(planFollowUp({ ...cfg, keepInWindow: false }, 1, late, window), {
    step: 1,
    dueAt: at("2026-10-21T13:00:00Z"),
    skipped: [],
    movedUp: false,
  });
  // Una plantilla no necesita la ventana.
  assert.equal(planFollowUp(seq([template(240), template(720)], { keepInWindow: true }), 1, late, window).movedUp, false);
  // Ya no cabe (quedan 10 min) o la ventana está cerrada: no se adelanta.
  assert.equal(iso(planFollowUp(cfg, 1, at("2026-10-21T09:50:00Z"), window).dueAt), "2026-10-21T21:50:00.000Z");
  assert.equal(planFollowUp(cfg, 1, late, null).movedUp, false);
});

test("horario: el último momento de atención antes de una hora, y el primero después", () => {
  // Miércoles 19:00 de Lima: ya cerró a las 18:00. Con margen, 17:45.
  assert.equal(iso(lastOpenAtOrBefore(HOURS, at("2026-10-22T00:00:00Z"), at("2026-10-21T15:00:00Z"))), "2026-10-21T22:45:00.000Z");
  // Dentro de horario: esa misma hora.
  assert.equal(iso(lastOpenAtOrBefore(HOURS, at("2026-10-21T20:00:00Z"), at("2026-10-21T15:00:00Z"))), "2026-10-21T20:00:00.000Z");
  // No se atendió en todo el tramo (domingo).
  assert.equal(lastOpenAtOrBefore(HOURS, at("2026-10-25T20:00:00Z"), at("2026-10-25T06:00:00Z")), null);
  // Martes 19:00 de Lima: abre el miércoles a las 9:00.
  assert.equal(iso(firstOpenAtOrAfter(HOURS, at("2026-10-21T00:00:00Z"), at("2026-10-21T21:00:00Z"))), "2026-10-21T14:00:00.000Z");
  assert.equal(firstOpenAtOrAfter(HOURS, at("2026-10-21T00:00:00Z"), at("2026-10-21T13:00:00Z")), null);
});

test("plan con horario: «antes del cierre» fuera de horario sale al final del último tramo de atención", () => {
  // El cliente escribió el martes a las 20:00 de Lima: la ventana cierra el miércoles a las 20:00.
  const window = at("2026-10-22T01:00:00Z");
  const from = at("2026-10-21T01:00:30Z");
  const plan = planFollowUp(seq([beforeClose(60)]), 0, from, window, HOURS);
  // 19:00 del miércoles ya es fuera de horario: sale a las 17:45.
  assert.deepEqual(plan, { step: 0, dueAt: at("2026-10-21T22:45:00Z"), skipped: [], movedUp: false });
  // Sábado 17:50: la ventana cierra el domingo, que no se atiende, y hoy ya no queda margen.
  const sat = planFollowUp(seq([beforeClose(60)]), 0, at("2026-10-24T22:50:30Z"), at("2026-10-25T22:50:00Z"), HOURS);
  assert.deepEqual(sat.skipped, [{ step: 0, reason: "no_time" }]);
});

test("plan con horario y keepInWindow: si no vuelve a abrir antes del cierre, sale antes de cerrar hoy", () => {
  // Miércoles 9:00 de Lima; la ventana cierra a las 17:00. El toque iría a las 21:00.
  const wed = planFollowUp(seq([ai(120), text(720)], { keepInWindow: true }), 1, at("2026-10-21T14:00:00Z"), at("2026-10-21T22:00:00Z"), HOURS);
  assert.deepEqual(wed, { step: 1, dueAt: at("2026-10-21T21:45:00Z"), skipped: [], movedUp: true });
  // Martes 17:00: el toque iría a las 19:00, fuera de horario, pero el
  // miércoles abre a las 9:00 con la ventana aún abierta: espera, no se adelanta.
  const tue = planFollowUp(seq([ai(120)], { keepInWindow: true }), 0, at("2026-10-20T22:00:20Z"), at("2026-10-21T22:00:00Z"), HOURS);
  assert.deepEqual(tue, { step: 0, dueAt: at("2026-10-21T00:00:20Z"), skipped: [], movedUp: false });
  // Sábado 17:30: el domingo no se atiende y la ventana cierra el domingo.
  // Sale hoy antes de cerrar, no a las 19:30.
  const sat = planFollowUp(seq([text(120)], { keepInWindow: true }), 0, at("2026-10-24T22:30:20Z"), at("2026-10-25T22:30:00Z"), HOURS);
  assert.deepEqual(sat, { step: 0, dueAt: at("2026-10-24T22:45:20Z"), skipped: [], movedUp: true });
});

test("followUpAllowed: por defecto solo en chats que atiende la IA", () => {
  const cfg = seq([ai(60)]);
  assert.equal(followUpAllowed(cfg, { aiMode: "AUTOPILOT", handoffAt: null }), true);
  assert.equal(followUpAllowed(cfg, { aiMode: "AUTOPILOT", handoffAt: new Date() }), false);
  assert.equal(followUpAllowed(cfg, { aiMode: "COPILOT", handoffAt: null }), false);
  assert.equal(followUpAllowed({ ...cfg, includeHuman: true }, { aiMode: "COPILOT", handoffAt: null }), true);
});

test("secuencia: pasadas 24 h acumuladas solo se admite plantilla", () => {
  const bad = followUpsSchema.safeParse({ enabled: true, steps: [ai(120), text(1320)] });
  assert.equal(bad.success, false);
  assert.deepEqual(bad.success ? [] : bad.error.issues.map((i) => i.path.join(".")), ["steps.1.kind"]);

  const ok = followUpsSchema.safeParse({ enabled: true, steps: [ai(120), text(600), template(1440)] });
  assert.equal(ok.success, true);

  // Apagado no se valida: se puede guardar a medias.
  const off = followUpsSchema.safeParse({ enabled: false, steps: [ai(120), text(1440)] });
  assert.equal(off.success, true);
});

test("secuencia: «antes del cierre» cuenta como dentro de la ventana, y lo de después se mide desde ahí", () => {
  const issues = (steps: FollowUpStep[]) => {
    const r = followUpsSchema.safeParse({ enabled: true, steps });
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };
  assert.deepEqual(issues([ai(120), beforeClose(60), template(1440)]), []);
  // 60 min antes del cierre y otros 30 min: sigue dentro.
  assert.deepEqual(issues([beforeClose(60), text(30)]), []);
  // 60 min antes del cierre y otros 90 min: ya cerró, solo plantilla.
  assert.deepEqual(issues([beforeClose(60), text(90)]), ["steps.1.kind"]);
  // Los toques anteriores ya pasan de ese momento: no llegaría a salir.
  assert.deepEqual(issues([text(1400), beforeClose(60)]), ["steps.1.beforeCloseMinutes"]);
  assert.deepEqual(issues([template(1440), beforeClose(60)]), ["steps.1.beforeCloseMinutes"]);
});

test("followUpTimeline: en qué minuto cae cada toque desde el último mensaje del cliente", () => {
  assert.deepEqual(followUpTimeline([ai(120), beforeClose(60), text(30), template(1440)]), [
    { minutes: 120, outside: false, late: false },
    { minutes: 1380, outside: false, late: false },
    { minutes: 1410, outside: false, late: false },
    { minutes: 2850, outside: true, late: false },
  ]);
  // Con otra ventana (TikTok, 48 h) el «antes del cierre» se mueve con ella.
  assert.equal(followUpTimeline([beforeClose(60)], 48 * 60)[0]?.minutes, 2820);
});

test("secuencia: una plantilla sin elegir y un texto vacío no pasan", () => {
  const noTpl = followUpsSchema.safeParse({ enabled: true, steps: [{ ...template(60), templateId: null }] });
  assert.equal(noTpl.success, false);
  const noText = followUpsSchema.safeParse({ enabled: true, steps: [{ ...text(60), text: "  " }] });
  assert.equal(noText.success, false);
  // La IA sin objetivo sí: el objetivo es opcional.
  assert.equal(followUpsSchema.safeParse({ enabled: true, steps: [ai(60)] }).success, true);
});

// ── El servicio de verdad, sobre una base y una mensajería de mentira ──

const HOUR = 3_600_000;
const NEVER_OPEN: BusinessHours = { timezone: "America/Lima", days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } };

function setup(cfg: FollowUps, convoPatch: Record<string, unknown> = {}, botPatch: Record<string, unknown> = {}) {
  const now = Date.now();
  const convo: Record<string, unknown> = {
    id: "cv1",
    orgId: "org1",
    contactId: "ct1",
    channelId: null,
    channelKind: "whatsapp",
    metaPageId: null,
    tiktokAccountId: null,
    status: "OPEN",
    aiMode: "AUTOPILOT",
    handoffAt: null,
    windowExpiresAt: new Date(now + 20 * HOUR),
    followUpStep: 0,
    followUpDueAt: new Date(now - 1000),
    ...convoPatch,
  };
  const sent: string[] = [];
  const notes: string[] = [];
  const templates = new Map([["tpl_1", { body: "Hola {{1}}" }]]);
  const prisma = {
    conversation: {
      findUnique: async () => ({ ...convo }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(convo, data),
      updateMany: async ({ where, data }: { where: { followUpStep?: number }; data: Record<string, unknown> }) => {
        if (where.followUpStep !== undefined && where.followUpStep !== convo.followUpStep) return { count: 0 };
        Object.assign(convo, data);
        return { count: 1 };
      },
    },
    message: { findFirst: async () => ({ direction: "OUTBOUND" }) },
    deal: { findFirst: async () => null },
    user: { findFirst: async () => ({ id: "u1" }) },
    template: { findUnique: async ({ where }: { where: { id: string } }) => templates.get(where.id) ?? null },
  };
  const messaging = {
    queueOutbound: async (input: { text: string }) => void sent.push(`texto: ${input.text}`),
    sendTemplateMessage: async (input: { templateId: string }) => void sent.push(`plantilla: ${input.templateId}`),
    addNote: async (_conversationId: string, _authorId: string, body: string) => void notes.push(body),
  };
  const bots = {
    resolveForConversation: async () => ({ isActive: true, followUps: cfg, businessHoursEnabled: false, businessHours: null, ...botPatch }),
  };
  const agentDouble = { draftFollowUp: async () => "¿Seguimos con la cotización?" };
  const aiSettings = { status: async () => ({ ready: true }) };
  const events = { emit: () => true };
  const service = new FollowUpService(prisma as never, messaging as never, bots as never, agentDouble as never, aiSettings as never, events as never);
  const schedule = (author: string) => (service as unknown as { schedule(id: string, author: string): Promise<void> }).schedule("cv1", author);
  return { service, schedule, convo, sent, notes, templates, now };
}

/** Diferencia en minutos entre una fecha del plan y un momento, redondeada. */
const minutesFrom = (d: unknown, from: number) => Math.round(((d as Date).getTime() - from) / 60_000);

test("servicio: con la ventana abierta el toque sale y queda programado el «antes del cierre»", async () => {
  const s = setup(seq([text(120), beforeClose(60), template(1440)]));
  await s.service.fire("cv1");
  assert.deepEqual(s.sent, ["texto: ¿Pudiste verlo?"]);
  assert.deepEqual(s.notes, []);
  assert.equal(s.convo.followUpStep, 1);
  // La ventana cierra en 20 h: el siguiente sale a las 19 h.
  assert.equal(minutesFrom(s.convo.followUpDueAt, s.now), 19 * 60);
});

test("servicio: con la ventana cerrada, un toque que no es plantilla no sale y queda anotado en el chat", async () => {
  const s = setup(seq([text(120), beforeClose(60), template(1440)]), { windowExpiresAt: new Date(Date.now() - HOUR) });
  await s.service.fire("cv1");
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.notes, [
    "🤖 Seguimiento: el toque 1 de 3 no se envió: la ventana de 24 h ya estaba cerrada y este toque no es una plantilla.",
    "🤖 Seguimiento: el toque 2 de 3 no se envió: iba antes del cierre de la ventana y la ventana ya estaba cerrada.",
  ]);
  // Queda la plantilla, a las 24 h.
  assert.equal(s.convo.followUpStep, 2);
  assert.equal(minutesFrom(s.convo.followUpDueAt, s.now), 1440);
  // Y la plantilla sí sale con la ventana cerrada.
  s.convo.followUpDueAt = new Date(Date.now() - 1000);
  await s.service.fire("cv1");
  assert.deepEqual(s.sent, ["plantilla: tpl_1"]);
  assert.equal(s.notes.length, 2);
  assert.equal(s.convo.followUpDueAt, null);
});

test("servicio: dos toques que no salen por lo mismo van en una sola nota", async () => {
  const s = setup(seq([beforeClose(120), beforeClose(60), template(1440)]), { windowExpiresAt: null, followUpStep: 2 });
  // Una persona retoma el chat con una plantilla: la secuencia vuelve a empezar con la ventana cerrada.
  await s.schedule("HUMAN");
  assert.deepEqual(s.notes, ["🤖 Seguimiento: los toques 1 y 2 de 3 no se enviaron: iban antes del cierre de la ventana y la ventana ya estaba cerrada."]);
  assert.equal(s.convo.followUpStep, 2);
});

test("servicio: una plantilla borrada o un canal sin plantillas quedan anotados", async () => {
  const gone = setup(seq([{ ...template(60), templateId: "tpl_borrada" }]));
  await gone.service.fire("cv1");
  assert.deepEqual(gone.sent, []);
  assert.deepEqual(gone.notes, ["🤖 Seguimiento: el toque 1 de 1 no se envió: su plantilla ya no existe."]);

  const ig = setup(seq([template(60)]), { channelKind: "instagram" });
  await ig.service.fire("cv1");
  assert.deepEqual(ig.notes, ["🤖 Seguimiento: el toque 1 de 1 no se envió: las plantillas solo existen en WhatsApp y este chat es de instagram."]);
});

test("servicio: fuera de horario el toque espera; si además la ventana ya cerró, no espera en vano", async () => {
  const closedShop = { businessHoursEnabled: true, businessHours: NEVER_OPEN };
  const waits = setup(seq([text(120)]), {}, closedShop);
  await waits.service.fire("cv1");
  assert.deepEqual(waits.sent, []);
  assert.deepEqual(waits.notes, []);
  assert.equal(waits.convo.followUpStep, 0);
  assert.equal(minutesFrom(waits.convo.followUpDueAt, waits.now), 15);

  const lost = setup(seq([text(120)]), { windowExpiresAt: new Date(Date.now() - HOUR) }, closedShop);
  await lost.service.fire("cv1");
  assert.equal(lost.notes.length, 1);
  assert.equal(lost.convo.followUpStep, 1);
  assert.equal(lost.convo.followUpDueAt, null);
});

test("servicio: una respuesta partida en varios mensajes mueve el plan y anota una sola vez", async () => {
  const s = setup(seq([beforeClose(60), template(1440)]), { windowExpiresAt: null, followUpDueAt: null });
  await Promise.all([s.schedule("AI"), s.schedule("AI"), s.schedule("AI")]);
  assert.equal(s.notes.length, 1);
  assert.equal(s.convo.followUpStep, 1);
});

test("servicio: el plan cuenta con la ventana al programar tras un mensaje nuestro", async () => {
  // La IA responde con la ventana abierta 20 h más: el «antes del cierre» queda a las 19 h.
  const s = setup(seq([beforeClose(60)]), { followUpDueAt: null });
  await s.schedule("AI");
  assert.equal(s.convo.followUpStep, 0);
  assert.equal(minutesFrom(s.convo.followUpDueAt, s.now), 19 * 60);
  assert.deepEqual(s.notes, []);
  // Cancelado desde la bandeja: sigue cancelado aunque escriba una persona.
  const cancelled = setup(seq([text(120)]), { followUpStep: FOLLOW_UP_CANCELLED, followUpDueAt: null });
  await cancelled.schedule("HUMAN");
  assert.equal(cancelled.convo.followUpStep, FOLLOW_UP_CANCELLED);
  assert.equal(cancelled.convo.followUpDueAt, null);
});
