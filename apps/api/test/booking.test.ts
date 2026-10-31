/**
 * Reservas: el motor de franjas libres y las fechas en la zona del negocio.
 * Parte pura (sin base de datos).
 *
 *   npm run test:booking --workspace=apps/api
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WEEKLY_HOURS,
  computeSlots,
  formatBookingAt,
  isFreeSlot,
  parseLocalDateTime,
  utcToZoned,
  weekdayOf,
  weeklyHoursSchema,
  zonedToUtc,
  type WeeklyHours,
} from "@crm/shared";

const LIMA = "America/Lima"; // UTC-5, sin cambio de horario
const closed: WeeklyHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
const tuesdayMorning: WeeklyHours = { ...closed, tue: [{ from: "09:00", to: "12:00" }] };
// Lunes 2 de noviembre de 2026, 08:00 en Lima: la víspera del martes que se prueba.
const NOW = new Date("2026-11-02T13:00:00Z");
const base = {
  timezone: LIMA,
  hours: tuesdayMorning,
  durationMin: 60,
  intervalMin: 30,
  minNoticeMin: 0,
  maxDays: 30,
  now: NOW,
  // Solo el martes 3 (el resto de martes del mes daría las mismas horas).
  fromDate: "2026-11-03",
  days: 1,
};
const times = (slots: { time: string }[]) => slots.map((s) => s.time);

test("hora de pared ↔ UTC, también con cambio de horario", () => {
  assert.equal(zonedToUtc("2026-11-03", "09:00", LIMA).toISOString(), "2026-11-03T14:00:00.000Z");
  // Nueva York: el 1 de noviembre de 2026 vuelve al horario de invierno (UTC-5).
  assert.equal(zonedToUtc("2026-10-31", "09:00", "America/New_York").toISOString(), "2026-10-31T13:00:00.000Z");
  assert.equal(zonedToUtc("2026-11-02", "09:00", "America/New_York").toISOString(), "2026-11-02T14:00:00.000Z");
  // Santiago de Chile: verano (UTC-3) e invierno (UTC-4).
  assert.equal(zonedToUtc("2026-12-01", "09:00", "America/Santiago").toISOString(), "2026-12-01T12:00:00.000Z");
  assert.equal(zonedToUtc("2026-07-07", "09:00", "America/Santiago").toISOString(), "2026-07-07T13:00:00.000Z");
  assert.deepEqual(utcToZoned(new Date("2026-11-03T14:00:00Z"), LIMA), { date: "2026-11-03", time: "09:00", weekday: "tue" });
  assert.equal(weekdayOf("2026-11-03"), "tue");
  assert.equal(weekdayOf("2026-11-01"), "sun");
});

test("las franjas caben enteras en el tramo y van cada intervalo", () => {
  const slots = computeSlots(base);
  assert.deepEqual(times(slots), ["09:00", "09:30", "10:00", "10:30", "11:00"], "la de 11:30 no cabe (terminaría 12:30)");
  assert.equal(slots[0]!.start.toISOString(), "2026-11-03T14:00:00.000Z");
  assert.equal(slots[0]!.end.toISOString(), "2026-11-03T15:00:00.000Z");
  assert.ok(slots.every((s) => s.date === "2026-11-03"));
});

test("antelación mínima: nada que empiece antes de ahora + antelación", () => {
  // Martes 09:30 en Lima, antelación de una hora → la primera, 10:30.
  const now = new Date("2026-11-03T14:30:00Z");
  assert.deepEqual(times(computeSlots({ ...base, now, minNoticeMin: 60 })), ["10:30", "11:00"]);
});

test("una cita ocupada (con su margen) quita las franjas que la pisan", () => {
  const busy = [{ start: new Date("2026-11-03T15:00:00Z"), end: new Date("2026-11-03T16:00:00Z") }]; // 10:00–11:00
  assert.deepEqual(times(computeSlots({ ...base, busy })), ["09:00", "11:00"], "09:00 acaba justo a las 10:00");
  // Con 15 minutos de margen tras cada cita, la de 09:00 bloquea hasta 10:15 y choca.
  assert.deepEqual(times(computeSlots({ ...base, busy, bufferAfterMin: 15 })), ["11:00"]);
});

test("días cerrados, límite de días por delante y límite de franjas", () => {
  const everyDay: WeeklyHours = Object.fromEntries(
    Object.keys(closed).map((d) => [d, [{ from: "09:00", to: "10:00" }]]),
  ) as WeeklyHours;
  const all = computeSlots({ ...base, hours: everyDay, maxDays: 3, fromDate: undefined, days: undefined });
  // Hoy (lunes 2) ya pasó las 09:00 en Lima? No: son las 08:00, así que entra.
  assert.deepEqual(all.map((s) => s.date), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
  const holidays = computeSlots({ ...base, hours: everyDay, maxDays: 3, fromDate: undefined, days: undefined, blackouts: [{ from: "2026-11-03", to: "2026-11-04" }] });
  assert.deepEqual(holidays.map((s) => s.date), ["2026-11-02", "2026-11-05"]);
  assert.equal(computeSlots({ ...base, hours: everyDay, fromDate: undefined, days: undefined, limit: 2 }).length, 2);
  // Desde un día concreto, solo ese día.
  assert.deepEqual(computeSlots({ ...base, hours: everyDay, fromDate: "2026-11-10", days: 1 }).map((s) => s.date), ["2026-11-10"]);
});

test("validar una hora exacta antes de reservar", () => {
  const { fromDate: _f, days: _d, ...input } = base;
  assert.equal(isFreeSlot(input, new Date("2026-11-03T15:00:00Z")), true, "10:00 está libre");
  assert.equal(isFreeSlot(input, new Date("2026-11-03T15:10:00Z")), false, "10:10 no es una franja");
  assert.equal(isFreeSlot(input, new Date("2026-11-03T16:30:00Z")), false, "11:30 no cabe");
  assert.equal(
    isFreeSlot({ ...input, busy: [{ start: new Date("2026-11-03T15:00:00Z"), end: new Date("2026-11-03T16:00:00Z") }] }, new Date("2026-11-03T15:00:00Z")),
    false,
    "ocupada",
  );
});

test("lo que escribe el agente y lo que lee el cliente", () => {
  assert.deepEqual(parseLocalDateTime("2026-11-03T10:30"), { date: "2026-11-03", time: "10:30" });
  assert.deepEqual(parseLocalDateTime("2026-11-03 10:30:00"), { date: "2026-11-03", time: "10:30" });
  assert.equal(parseLocalDateTime("mañana a las 10"), null);
  assert.equal(parseLocalDateTime("2026-11-03T25:00"), null);
  assert.equal(formatBookingAt(new Date("2026-11-03T15:30:00Z"), LIMA), "martes, 3 de noviembre, 10:30");
});

test("el horario semanal no admite tramos que se pisen", () => {
  assert.ok(weeklyHoursSchema.safeParse(DEFAULT_WEEKLY_HOURS).success);
  const bad = { ...DEFAULT_WEEKLY_HOURS, mon: [{ from: "09:00", to: "13:00" }, { from: "12:00", to: "18:00" }] };
  assert.ok(!weeklyHoursSchema.safeParse(bad).success);
  const split = { ...DEFAULT_WEEKLY_HOURS, mon: [{ from: "09:00", to: "13:00" }, { from: "14:00", to: "18:00" }] };
  assert.ok(weeklyHoursSchema.safeParse(split).success);
  assert.ok(!weeklyHoursSchema.safeParse({ ...DEFAULT_WEEKLY_HOURS, tue: [{ from: "18:00", to: "09:00" }] }).success);
});
