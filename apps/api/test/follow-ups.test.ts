/**
 * Seguimientos automáticos: las reglas que no tocan base de datos (qué se
 * guarda, qué toque queda programado y para cuándo, en qué chats aplica) y la
 * validación de la secuencia (pasadas 24 h, solo plantilla).
 *
 *   npm run test:followups --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRIES,
  DEFAULT_FOLLOW_UPS,
  FOLLOW_UP_QUIET_OFF,
  followUpTemplateFor,
  followUpTemplateVars,
  followUpTimeline,
  followUpsSchema,
  type BusinessHours,
  type FollowUpQuiet,
  type FollowUpStep,
  type FollowUps,
} from "@crm/shared";
import { FOLLOW_UP_CANCELLED, canSendAt, followUpAllowed, listText, nextSendable, parseFollowUps, planFollowUp, type SendTimes } from "../src/modules/ai/follow-up.rules";
import { firstOpenAtOrAfter, lastOpenAtOrBefore, localClock } from "../src/common/utils/business-hours";
import { COUNTRY_ZONES, isQuietAt, quietClockFor } from "../src/common/utils/quiet-hours";
import { FollowUpService } from "../src/modules/ai/follow-up.service";

const base = { timing: "after" as const, beforeCloseMinutes: 60, text: "", templateId: null, vars: [], byStage: [] };
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
  quiet: FOLLOW_UP_QUIET_OFF,
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
const IN_HOURS: SendTimes = { hours: HOURS, quiet: null };

/** Descanso de 21:00 a 08:00 con la hora del cliente; si no se reconoce su país, la de Lima. */
const QUIET: FollowUpQuiet = { enabled: true, from: "21:00", to: "08:00", clock: "contact", timezone: "America/Lima" };
const PERU = "+51987654321";
const SPAIN = "+34612345678";
/** Solo el descanso de un cliente de Perú, sin horario de atención. */
const NIGHT_PE: SendTimes = { hours: null, quiet: quietClockFor(QUIET, PERU) };

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
  // Ni horario de descanso: lo que ya estaba guardado sigue saliendo como salía.
  assert.equal(old?.quiet.enabled, false);
});

test("descanso: un agente nuevo lo trae activado; el fin tiene que ser distinto del inicio", () => {
  assert.deepEqual(DEFAULT_FOLLOW_UPS.quiet, { enabled: true, from: "21:00", to: "08:00", clock: "contact", timezone: "America/Lima" });
  const issues = (quiet: Partial<FollowUpQuiet>) => {
    const r = followUpsSchema.safeParse({ enabled: true, steps: [ai(120)], quiet: { ...QUIET, ...quiet } });
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };
  assert.deepEqual(issues({}), []);
  assert.deepEqual(issues({ from: "08:00", to: "08:00" }), ["quiet.to"]);
  assert.deepEqual(issues({ from: "9 pm" }), ["quiet.from"]);
  // Apagado no se valida.
  assert.deepEqual(issues({ enabled: false, from: "08:00", to: "08:00" }), []);
});

test("descanso: se mira con la hora del cliente, que sale del país de su número", () => {
  const pe = quietClockFor(QUIET, PERU)!;
  assert.deepEqual(pe.zones, ["America/Lima"]);
  // 21:00 de Lima (UTC-5): empieza. 07:59: sigue. 08:00 en punto: ya se puede.
  assert.equal(isQuietAt(pe, at("2026-10-21T01:59:00Z")), false);
  assert.equal(isQuietAt(pe, at("2026-10-21T02:00:00Z")), true);
  assert.equal(isQuietAt(pe, at("2026-10-21T12:59:00Z")), true);
  assert.equal(isQuietAt(pe, at("2026-10-21T13:00:00Z")), false);
  // A esa misma hora (15:00 de Lima) en España son las 22:00: su cliente descansa.
  const es = quietClockFor(QUIET, SPAIN)!;
  assert.equal(isQuietAt(pe, at("2026-10-21T20:00:00Z")), false);
  assert.equal(isQuietAt(es, at("2026-10-21T20:00:00Z")), true);
  // Un país con varias zonas: se respeta el descanso de todas. A las 9:00 de
  // Nueva York en Los Ángeles son las 6:00.
  const us = quietClockFor(QUIET, "+13105550100")!;
  assert.deepEqual(us.zones, ["America/New_York", "America/Los_Angeles"]);
  assert.equal(isQuietAt(us, at("2026-10-21T13:00:00Z")), true);
  assert.equal(isQuietAt(us, at("2026-10-21T15:00:00Z")), false);
  // Una franja que no cruza la medianoche (la siesta).
  const nap = quietClockFor({ ...QUIET, from: "13:00", to: "15:00" }, PERU)!;
  assert.equal(isQuietAt(nap, at("2026-10-21T18:30:00Z")), true);
  assert.equal(isQuietAt(nap, at("2026-10-21T20:00:00Z")), false);
});

test("descanso: sin país reconocido o con «la hora del negocio», rige la zona elegida; apagado, nada", () => {
  const madrid = { ...QUIET, timezone: "Europe/Madrid" };
  // Un número de la India, un cliente de Instagram y uno sin teléfono.
  assert.deepEqual(quietClockFor(madrid, "+919876543210")?.zones, ["Europe/Madrid"]);
  assert.deepEqual(quietClockFor(madrid, "IG.1234567")?.zones, ["Europe/Madrid"]);
  assert.deepEqual(quietClockFor(madrid, null)?.zones, ["Europe/Madrid"]);
  // Con la hora del negocio no importa de dónde sea el cliente.
  assert.deepEqual(quietClockFor({ ...madrid, clock: "business" }, PERU)?.zones, ["Europe/Madrid"]);
  // Un usuario de WhatsApp sin número lleva su país en el identificador.
  assert.deepEqual(quietClockFor(QUIET, "PE.13491208655302741918")?.zones, ["America/Lima"]);
  assert.equal(quietClockFor({ ...QUIET, enabled: false }, PERU), null);
  assert.equal(quietClockFor(undefined, PERU), null);
});

test("descanso: cada país que Driony reconoce por el prefijo tiene su zona, y existe", () => {
  for (const c of COUNTRIES) {
    assert.ok(COUNTRY_ZONES[c.code]?.length, `falta la zona horaria de ${c.name} (${c.code})`);
  }
  for (const [code, zones] of Object.entries(COUNTRY_ZONES)) {
    for (const tz of zones) assert.ok(localClock(tz, new Date()), `la zona ${tz} de ${code} no existe`);
  }
});

test("plan con descanso: un toque que cae de noche espera a la mañana, también si es plantilla", () => {
  // El cliente escribió a las 20:00 de Lima y le respondimos al momento.
  const from = at("2026-10-21T01:00:30Z");
  const window = at("2026-10-22T01:00:00Z");
  // A las 2 h serían las 22:00: sale a las 8:00, con la ventana aún abierta.
  assert.deepEqual(planFollowUp(seq([ai(120)]), 0, from, window, NIGHT_PE), { step: 0, dueAt: at("2026-10-21T13:00:30Z"), skipped: [], movedUp: false });
  // Una plantilla a los 3 días cae a las 20:00, fuera del descanso: no se mueve.
  assert.equal(iso(planFollowUp(seq([template(4320)]), 0, from, window, NIGHT_PE).dueAt), "2026-10-24T01:00:30.000Z");
  // A las 30 h serían las 2:00 de la madrugada: espera a las 8:00.
  assert.equal(iso(planFollowUp(seq([template(1800)]), 0, from, window, NIGHT_PE).dueAt), "2026-10-22T13:00:30.000Z");
  // De día sale a su hora.
  assert.equal(iso(planFollowUp(seq([ai(120)]), 0, at("2026-10-21T15:00:00Z"), window, NIGHT_PE).dueAt), "2026-10-21T17:00:00.000Z");
  assert.equal(canSendAt(NIGHT_PE, at("2026-10-21T13:00:30Z")), true);
  assert.equal(iso(nextSendable(NIGHT_PE, at("2026-10-21T03:10:00Z"))), "2026-10-21T13:10:00.000Z");
});

test("plan con descanso: si esperar a la mañana cierra la ventana, con keepInWindow sale antes del descanso", () => {
  // El cliente escribió a las 3:00 de la madrugada de Lima: la ventana cierra a las 3:00 del día siguiente.
  const window = at("2026-10-22T08:00:00Z");
  // Nuestro último mensaje salió a las 12:00; el toque va a las 10 h: las 22:00, de noche.
  const from = at("2026-10-21T17:00:00Z");
  const cfg = seq([text(600)], { keepInWindow: true });
  // A las 8:00 la ventana ya cerró: sale a las 20:45, antes del descanso.
  assert.deepEqual(planFollowUp(cfg, 0, from, window, NIGHT_PE), { step: 0, dueAt: at("2026-10-22T01:45:00Z"), skipped: [], movedUp: true });
  // Sin keepInWindow espera a la mañana y al vencer se omite (ventana cerrada).
  assert.deepEqual(planFollowUp({ ...cfg, keepInWindow: false }, 0, from, window, NIGHT_PE), {
    step: 0,
    dueAt: at("2026-10-22T13:00:00Z"),
    skipped: [],
    movedUp: false,
  });
});

test("plan con descanso: «antes del cierre» de madrugada sale justo antes de que empiece el descanso", () => {
  // El cliente escribió a las 6:00 de Lima: la ventana cierra mañana a las 6:00, y una hora antes es de noche.
  const window = at("2026-10-22T11:00:00Z");
  const plan = planFollowUp(seq([beforeClose(60)]), 0, at("2026-10-21T11:00:30Z"), window, NIGHT_PE);
  assert.deepEqual(plan, { step: 0, dueAt: at("2026-10-22T01:45:00Z"), skipped: [], movedUp: false });
  // Con horario de atención además (hasta las 18:00): manda el que cierra antes.
  const both = planFollowUp(seq([beforeClose(60)]), 0, at("2026-10-21T11:00:30Z"), window, { ...NIGHT_PE, hours: HOURS });
  assert.equal(iso(both.dueAt), "2026-10-21T22:45:00.000Z");
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
  const plan = planFollowUp(seq([beforeClose(60)]), 0, from, window, IN_HOURS);
  // 19:00 del miércoles ya es fuera de horario: sale a las 17:45.
  assert.deepEqual(plan, { step: 0, dueAt: at("2026-10-21T22:45:00Z"), skipped: [], movedUp: false });
  // Sábado 17:50: la ventana cierra el domingo, que no se atiende, y hoy ya no queda margen.
  const sat = planFollowUp(seq([beforeClose(60)]), 0, at("2026-10-24T22:50:30Z"), at("2026-10-25T22:50:00Z"), IN_HOURS);
  assert.deepEqual(sat.skipped, [{ step: 0, reason: "no_time" }]);
});

test("plan con horario y keepInWindow: si no vuelve a abrir antes del cierre, sale antes de cerrar hoy", () => {
  // Miércoles 9:00 de Lima; la ventana cierra a las 17:00. El toque iría a las 21:00.
  const wed = planFollowUp(seq([ai(120), text(720)], { keepInWindow: true }), 1, at("2026-10-21T14:00:00Z"), at("2026-10-21T22:00:00Z"), IN_HOURS);
  assert.deepEqual(wed, { step: 1, dueAt: at("2026-10-21T21:45:00Z"), skipped: [], movedUp: true });
  // Martes 17:00: el toque iría a las 19:00, fuera de horario, pero el
  // miércoles abre a las 9:00 con la ventana aún abierta: espera a esa hora, no se adelanta.
  const tue = planFollowUp(seq([ai(120)], { keepInWindow: true }), 0, at("2026-10-20T22:00:20Z"), at("2026-10-21T22:00:00Z"), IN_HOURS);
  assert.deepEqual(tue, { step: 0, dueAt: at("2026-10-21T14:00:20Z"), skipped: [], movedUp: false });
  // Sábado 17:30: el domingo no se atiende y la ventana cierra el domingo.
  // Sale hoy antes de cerrar, no a las 19:30.
  const sat = planFollowUp(seq([text(120)], { keepInWindow: true }), 0, at("2026-10-24T22:30:20Z"), at("2026-10-25T22:30:00Z"), IN_HOURS);
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
  /** Con qué se rellenó cada plantilla enviada: «contact_name» o el texto que va. */
  const fills: string[][] = [];
  const templates = new Map([
    ["tpl_1", { name: "recordatorio_curso", body: "Hola {{1}}, ¿seguimos con tu inscripción?" }],
    ["tpl_interes", { name: "sigues_interesado", body: "Hola {{1}}, ¿sigues interesado en {{2}}? Te guardo la información." }],
    ["tpl_pago", { name: "pago_pendiente", body: "Hola {{nombre}}, tu cupo en {{curso}} sigue separado. ¿Te ayudo con el pago?" }],
  ]);
  const patch = convoPatch as { stageId?: string; consulted?: string[]; discontinued?: string[] };
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
    // Cuándo salió nuestro último mensaje: se prueba pasando `sentAt` en el parche de la conversación.
    message: { findFirst: async () => ({ direction: "OUTBOUND", createdAt: (convoPatch as { sentAt?: Date }).sentAt }) },
    // La etapa del cliente: se prueba pasando `stageId` en el parche de la conversación.
    deal: { findFirst: async () => (patch.stageId ? { stageId: patch.stageId, stage: { isWon: false } } : null) },
    // Lo que el agente buscó en el catálogo en este chat (`consulted`), y lo que ya no se vende (`discontinued`).
    aiToolCall: {
      findMany: async () => (patch.consulted ? [{ output: { result: JSON.stringify({ products: patch.consulted.map((name) => ({ name })) }) } }] : []),
    },
    product: {
      findMany: async ({ where }: { where: { name: { in: string[] } } }) =>
        where.name.in.filter((n) => !(patch.discontinued ?? []).includes(n)).map((name) => ({ name })),
    },
    // La baja del contacto: se prueba pasando `optIn: false` en el parche de la conversación.
    contact: { findUnique: async () => ({ name: "Ana Torres", phone: "+51987654321", optIn: (convoPatch as { optIn?: boolean } | undefined)?.optIn ?? true }) },
    user: { findFirst: async () => ({ id: "u1" }) },
    template: { findUnique: async ({ where }: { where: { id: string } }) => templates.get(where.id) ?? null },
  };
  const messaging = {
    queueOutbound: async (input: { text: string }) => void sent.push(`texto: ${input.text}`),
    sendTemplateMessage: async (input: { templateId: string; fill: { body: { source: string; value?: string }[] } }) => {
      sent.push(`plantilla: ${input.templateId}`);
      fills.push(input.fill.body.map((v) => (v.source === "static" ? (v.value ?? "") : v.source)));
    },
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
  return { service, schedule, convo, sent, notes, fills, templates, now };
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

/** «HH:MM» en UTC de un momento desplazado `hours` horas desde ahora, al minuto. */
const utcClock = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString().slice(11, 16);
/** Un descanso que está en marcha ahora mismo y termina dentro de `endsInHours`, con la hora del negocio en UTC. */
const quietNow = (endsInHours: number): FollowUpQuiet => ({ enabled: true, from: utcClock(-2), to: utcClock(endsInHours), clock: "business", timezone: "UTC" });

test("servicio: en horario de descanso el toque no sale y queda para cuando termine", async () => {
  const s = setup(seq([text(120), template(1440)], { quiet: quietNow(3) }));
  await s.service.fire("cv1");
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.notes, []);
  assert.equal(s.convo.followUpStep, 0, "sigue siendo el mismo toque");
  // Termina en 3 h: sale entonces (el barrido va a saltos de 15 min).
  const wait = minutesFrom(s.convo.followUpDueAt, s.now);
  assert.ok(wait >= 179 && wait <= 196, `esperaba unas 3 h y son ${wait} min`);
  // Una plantilla tampoco sale de noche.
  const tpl = setup(seq([template(120)], { quiet: quietNow(3) }));
  await tpl.service.fire("cv1");
  assert.deepEqual(tpl.sent, []);
  // Fuera del descanso sale con normalidad.
  const day = setup(seq([text(120)], { quiet: { ...quietNow(3), from: utcClock(5), to: utcClock(8) } }));
  await day.service.fire("cv1");
  assert.deepEqual(day.sent, ["texto: ¿Pudiste verlo?"]);
});

test("servicio: al programar, un toque que caería en el descanso queda para cuando termine", async () => {
  // El toque va a los 30 min y el descanso (en marcha) termina en 3 h.
  const s = setup(seq([text(30)], { quiet: quietNow(3) }), { followUpDueAt: null });
  await s.schedule("AI");
  const wait = minutesFrom(s.convo.followUpDueAt, s.now);
  assert.ok(wait >= 179 && wait <= 196, `esperaba unas 3 h y son ${wait} min`);
});

test("servicio: si el descanso deja al toque fuera de la ventana, la nota lo dice", async () => {
  // Nuestro mensaje salió hace 4 h y el toque iba a las 2 h: le tocó hace 2 h, de noche
  // (el descanso empezó hace 3 h y acabó hace media hora). La ventana cerró hace una hora.
  const quiet: FollowUpQuiet = { enabled: true, from: utcClock(-3), to: utcClock(-0.5), clock: "business", timezone: "UTC" };
  const s = setup(seq([text(120)], { quiet }), { windowExpiresAt: new Date(Date.now() - HOUR), sentAt: new Date(Date.now() - 4 * HOUR) });
  await s.service.fire("cv1");
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.notes, [
    "🤖 Seguimiento: el toque 1 de 1 no se envió: le tocaba en el horario de descanso y la ventana de 24 h se cerró antes de que terminara; este toque no es una plantilla.",
  ]);
  // Sin descanso de por medio (nuestro mensaje ya salió con la ventana casi cerrada), la nota de siempre.
  const late = setup(seq([text(120)], { quiet }), { windowExpiresAt: new Date(Date.now() - HOUR), sentAt: new Date(Date.now() - 2.5 * HOUR) });
  await late.service.fire("cv1");
  assert.deepEqual(late.notes, ["🤖 Seguimiento: el toque 1 de 1 no se envió: la ventana de 24 h ya estaba cerrada y este toque no es una plantilla."]);
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

test("servicio: un cliente que pidió la baja no recibe seguimientos", async () => {
  const s = setup(seq([text(120)]), { optIn: false } as never);
  await s.service.fire("cv1");
  assert.deepEqual(s.sent, []);
  assert.equal(s.convo.followUpDueAt, null, "se quita del plan");
});

// ── La plantilla con contexto: qué va en sus huecos y cuál se elige según la etapa ──
const interest = (vars: FollowUpStep["vars"]): FollowUpStep => ({ ...template(60), templateId: "tpl_interes", vars });

test("plantilla: lo guardado antes de poder elegir los huecos sigue llevando el nombre en el primero", () => {
  const old = parseFollowUps({ enabled: true, steps: [{ afterMinutes: 1440, kind: "template", text: "", templateId: "tpl_1" }] });
  assert.deepEqual(old?.steps[0]?.vars, []);
  assert.deepEqual(old?.steps[0]?.byStage, []);
  assert.deepEqual(followUpTemplateVars(1, []), [{ index: 1, source: "contact_name", value: "" }]);
  // El segundo hueco no tiene de dónde salir: queda sin valor.
  assert.deepEqual(followUpTemplateVars(2, [])[1], null);
  assert.deepEqual(followUpTemplateVars(0, []), []);
  assert.equal(listText(["Power BI"]), "Power BI");
  assert.equal(listText(["Power BI", "Excel"]), "Power BI y Excel");
  assert.equal(listText(["Power BI", "Excel", "SQL"]), "Power BI, Excel y SQL");
});

test("plantilla: va lo que el cliente consultó en el catálogo; si no consultó nada, el texto de respaldo", async () => {
  const vars: FollowUpStep["vars"] = [{ index: 2, source: "product", value: "nuestros cursos" }];
  const asked = setup(seq([interest(vars)]), { consulted: ["Power BI"] });
  await asked.service.fire("cv1");
  assert.deepEqual(asked.sent, ["plantilla: tpl_interes"]);
  assert.deepEqual(asked.fills, [["contact_name", "Power BI"]]);
  // Buscó dos cosas a la vez.
  const two = setup(seq([interest(vars)]), { consulted: ["Power BI", "Excel"] });
  await two.service.fire("cv1");
  assert.deepEqual(two.fills, [["contact_name", "Power BI y Excel"]]);
  // No consultó nada, o lo que consultó ya no se vende.
  const none = setup(seq([interest(vars)]));
  await none.service.fire("cv1");
  assert.deepEqual(none.fills, [["contact_name", "nuestros cursos"]]);
  const gone = setup(seq([interest(vars)]), { consulted: ["Power BI"], discontinued: ["Power BI"] });
  await gone.service.fire("cv1");
  assert.deepEqual(gone.fills, [["contact_name", "nuestros cursos"]]);
  // Un texto fijo, y el nombre en otro hueco que no es el primero.
  const fixed = setup(seq([interest([{ index: 1, source: "static", value: "de nuevo" }, { index: 2, source: "contact_name", value: "" }])]));
  await fixed.service.fire("cv1");
  assert.deepEqual(fixed.fills, [["de nuevo", "contact_name"]]);
});

test("plantilla: con un hueco sin valor no se envía y la nota dice cuál falta", async () => {
  const s = setup(seq([interest([])]));
  await s.service.fire("cv1");
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.notes, ["🤖 Seguimiento: el toque 1 de 1 no se envió: a su plantilla le falta el valor de {{2}} (se elige en el agente, en Seguimientos)."]);
  // Con variables con nombre, se dice por su nombre.
  const named = setup(seq([{ ...template(60), templateId: "tpl_pago" }]));
  await named.service.fire("cv1");
  assert.match(named.notes[0]!, /le falta el valor de \{\{curso\}\}/);
});

test("plantilla por etapa: quien está en esa etapa recibe la suya; los demás, la general", async () => {
  const step: FollowUpStep = {
    ...interest([{ index: 2, source: "product", value: "nuestros cursos" }]),
    byStage: [{ stageId: "st_pago", templateId: "tpl_pago", vars: [{ index: 2, source: "product", value: "tu curso" }] }],
  };
  assert.deepEqual(followUpTemplateFor(step, "st_pago").templateId, "tpl_pago");
  assert.deepEqual(followUpTemplateFor(step, "st_otra").templateId, "tpl_interes");
  assert.deepEqual(followUpTemplateFor(step, null).templateId, "tpl_interes");

  const paying = setup(seq([step]), { stageId: "st_pago", consulted: ["Power BI"] });
  await paying.service.fire("cv1");
  assert.deepEqual(paying.sent, ["plantilla: tpl_pago"]);
  assert.deepEqual(paying.fills, [["contact_name", "Power BI"]]);
  // En otra etapa, o sin oportunidad: la general.
  const other = setup(seq([step]), { stageId: "st_nuevo" });
  await other.service.fire("cv1");
  assert.deepEqual(other.sent, ["plantilla: tpl_interes"]);
  const noDeal = setup(seq([step]));
  await noDeal.service.fire("cv1");
  assert.deepEqual(noDeal.sent, ["plantilla: tpl_interes"]);
});

test("plantilla: la secuencia no se guarda con un hueco de texto vacío ni con una etapa repetida o sin plantilla", () => {
  const issues = (step: FollowUpStep) => {
    const r = followUpsSchema.safeParse({ enabled: true, steps: [step] });
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };
  assert.deepEqual(issues(interest([{ index: 2, source: "product", value: "nuestros cursos" }])), []);
  assert.deepEqual(issues(interest([{ index: 2, source: "product", value: " " }])), ["steps.0.vars.0.value"]);
  assert.deepEqual(issues(interest([{ index: 2, source: "static", value: "" }])), ["steps.0.vars.0.value"]);
  assert.deepEqual(issues({ ...template(60), byStage: [{ stageId: "st_1", templateId: null, vars: [] }] }), ["steps.0.byStage.0.templateId"]);
  assert.deepEqual(
    issues({ ...template(60), byStage: [{ stageId: "st_1", templateId: "tpl_pago", vars: [] }, { stageId: "st_1", templateId: "tpl_1", vars: [] }] }),
    ["steps.0.byStage.1.stageId"],
  );
  // En un toque que no es plantilla no se mira: quedó de cuando lo era.
  assert.deepEqual(issues({ ...text(60), vars: [{ index: 2, source: "static", value: "" }] }), []);
});

test("vista previa: la plantilla se ve con lo que consultó el cliente y con la de su etapa", async () => {
  const step: FollowUpStep = {
    ...interest([{ index: 2, source: "product", value: "nuestros cursos" }]),
    byStage: [{ stageId: "st_pago", templateId: "tpl_pago", vars: [{ index: 2, source: "product", value: "tu curso" }] }],
  };
  const asked = await setup(seq([step]), { consulted: ["Power BI"] }).service.preview("cv1");
  assert.deepEqual({ name: asked!.templateName, message: asked!.message, blocked: asked!.blocked }, {
    name: "sigues_interesado",
    message: "Hola Ana Torres, ¿sigues interesado en Power BI? Te guardo la información.",
    blocked: null,
  });
  const paying = await setup(seq([step]), { stageId: "st_pago" }).service.preview("cv1");
  assert.equal(paying!.templateName, "pago_pendiente");
  assert.equal(paying!.message, "Hola Ana Torres, tu cupo en tu curso sigue separado. ¿Te ayudo con el pago?");
  // Con un hueco sin valor avisa, y el hueco se queda a la vista.
  const broken = await setup(seq([interest([])])).service.preview("cv1");
  assert.equal(broken!.message, "Hola Ana Torres, ¿sigues interesado en {{2}}? Te guardo la información.");
  assert.match(broken!.blocked!, /le falta el valor de \{\{2\}\}/);
});

// ── Qué va a enviar el próximo seguimiento (lo que ve el equipo en el chat) ──
test("vista previa: un toque de texto enseña el mensaje exacto, qué toque es y cuándo sale", async () => {
  // A las 24 h la ventana ya cerró: el segundo toque solo puede ser una plantilla.
  const s = setup(seq([text(120), template(1440)]));
  const p = await s.service.preview("cv1");
  assert.deepEqual(
    { step: p!.step, total: p!.total, kind: p!.kind, message: p!.message, goal: p!.goal, templateName: p!.templateName, blocked: p!.blocked },
    { step: 1, total: 2, kind: "text", message: "¿Pudiste verlo?", goal: null, templateName: null, blocked: null },
  );
  assert.equal(p!.dueAt, (s.convo.followUpDueAt as Date).toISOString());
  assert.deepEqual(s.sent, [], "ver la vista previa no envía nada");
});

test("vista previa: una plantilla enseña su nombre y el texto con el nombre del cliente", async () => {
  const s = setup(seq([template(120)]));
  const p = await s.service.preview("cv1");
  assert.deepEqual({ kind: p!.kind, templateName: p!.templateName, message: p!.message, blocked: p!.blocked }, {
    kind: "template",
    templateName: "recordatorio_curso",
    message: "Hola Ana Torres, ¿seguimos con tu inscripción?",
    blocked: null,
  });
});

test("vista previa: lo que redacta la IA no tiene texto todavía; se ve su objetivo y se puede pedir un borrador", async () => {
  const s = setup(seq([{ ...ai(120), text: "retomar la cotización" }]));
  const p = await s.service.preview("cv1");
  assert.deepEqual({ kind: p!.kind, message: p!.message, goal: p!.goal }, { kind: "ai", message: null, goal: "retomar la cotización" });
  assert.deepEqual(await s.service.draft("cv1"), { text: "¿Seguimos con la cotización?" });
  assert.deepEqual(s.sent, [], "el borrador no se envía");
  // Solo los toques de IA tienen borrador.
  const fixed = setup(seq([text(120)]));
  await assert.rejects(() => fixed.service.draft("cv1"), /solo.*IA/i);
});

test("vista previa: avisa si el toque no va a poder salir", async () => {
  // La ventana se cierra antes de la hora del toque y no es una plantilla.
  const closing = setup(seq([text(120)]), { windowExpiresAt: new Date(Date.now() - 60_000) });
  assert.match((await closing.service.preview("cv1"))!.blocked!, /ventana de 24 h/);
  // Una plantilla sí sale con la ventana cerrada.
  const tpl = setup(seq([template(120)]), { windowExpiresAt: new Date(Date.now() - 60_000) });
  assert.equal((await tpl.service.preview("cv1"))!.blocked, null);
  // Plantilla borrada.
  const gone = setup(seq([{ ...template(120), templateId: "tpl_x" }]));
  assert.match((await gone.service.preview("cv1"))!.blocked!, /plantilla ya no existe/);
  // Plantilla en un canal que no es WhatsApp.
  const ig = setup(seq([template(120)]), { channelKind: "instagram" });
  assert.match((await ig.service.preview("cv1"))!.blocked!, /solo existen en WhatsApp/);
});

test("vista previa: sin seguimiento programado no hay nada que enseñar", async () => {
  const none = setup(seq([text(120)]), { followUpDueAt: null });
  assert.equal(await none.service.preview("cv1"), null);
  // El agente ya no tiene ese toque (lo quitaron después de programarlo).
  const removed = setup(seq([text(120)]), { followUpStep: 3 });
  assert.equal(await removed.service.preview("cv1"), null);
});
