/**
 * Reservas: el motor de franjas libres y las fechas en la zona del negocio.
 *
 * Sin dependencias ni base de datos, para probarlo solo y usarlo igual en la
 * API (validar una reserva) y en la web (pintar horas).
 *
 * Las horas se escriben «de pared» en la zona del negocio (lunes de 09:00 a
 * 18:00 en America/Lima) y se guardan en UTC. El paso de una a otra usa la
 * zona IANA con dos pasadas: la segunda corrige cuando la primera cae justo
 * en un cambio de horario.
 */

import type { Weekday } from "./schemas/agent-config.schema.js";

/** Los días en orden (lunes primero); el tipo Weekday es el del horario del agente. */
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Un tramo del día en hora de pared: «09:00»–«13:00». */
export interface TimeRange {
  from: string;
  to: string;
}
/** Tramos de cada día de la semana; un día sin tramos está cerrado. */
export type WeeklyHours = Record<Weekday, TimeRange[]>;
/** Días cerrados (vacaciones, feriados), «AAAA-MM-DD», ambos incluidos. */
export interface DateRange {
  from: string;
  to: string;
}

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: [{ from: "09:00", to: "18:00" }],
  tue: [{ from: "09:00", to: "18:00" }],
  wed: [{ from: "09:00", to: "18:00" }],
  thu: [{ from: "09:00", to: "18:00" }],
  fri: [{ from: "09:00", to: "18:00" }],
  sat: [],
  sun: [],
};

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};

// ── Zonas horarias ──────────────────────────────────────────
const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

function wallParts(instant: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(instant))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year!, m: out.month!, d: out.day!, h: out.hour! % 24, mi: out.minute!, s: out.second! };
}

/** Cuánto va la zona por delante de UTC en ese instante (ms). */
function offsetMs(instant: number, tz: string): number {
  const p = wallParts(instant, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instant / 1000) * 1000;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** «2026-11-04» + «10:30» en la zona del negocio → instante UTC. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = offsetMs(guess, tz);
  let t = guess - first;
  const second = offsetMs(t, tz);
  if (second !== first) t = guess - second;
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Un instante visto en la zona del negocio: fecha, hora y día de la semana. */
export function utcToZoned(at: Date, tz: string): { date: string; time: string; weekday: Weekday } {
  const p = wallParts(at.getTime(), tz);
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  return { date, time: `${pad(p.h)}:${pad(p.mi)}`, weekday: weekdayOf(date) };
}

/** Día de la semana de una fecha «AAAA-MM-DD» (el calendario no depende de la zona). */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return WEEKDAYS[(js + 6) % 7]!;
}

/** Suma días a una fecha «AAAA-MM-DD». */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
const fromMin = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

// ── Franjas libres ──────────────────────────────────────────
export interface BusyRange {
  start: Date;
  /** Hasta dónde bloquea (fin de la cita + su margen). */
  end: Date;
}

export interface SlotInput {
  timezone: string;
  hours: WeeklyHours;
  /** Días cerrados de la persona y de la empresa. */
  blackouts?: DateRange[];
  /** Citas que ya tiene (hasta el final de su margen). */
  busy?: BusyRange[];
  durationMin: number;
  /** Margen tras la cita (limpiar, desplazarse): también bloquea. */
  bufferAfterMin?: number;
  /** Cada cuánto empieza una franja (15, 30, 60…). */
  intervalMin: number;
  /** Antelación mínima: no se ofrece nada que empiece antes de ahora + esto. */
  minNoticeMin: number;
  /** Hasta cuántos días por delante se puede reservar. */
  maxDays: number;
  now: Date;
  /** Día desde el que buscar («AAAA-MM-DD» en la zona); por defecto, hoy. */
  fromDate?: string;
  /** Cuántos días mirar desde fromDate (nunca más allá de maxDays). */
  days?: number;
  /** Máximo de franjas a devolver. */
  limit?: number;
}

export interface Slot {
  start: Date;
  end: Date;
  /** En la zona del negocio. */
  date: string;
  time: string;
}

const inBlackout = (date: string, blackouts: DateRange[]) => blackouts.some((b) => date >= b.from && date <= b.to);

/**
 * Las franjas libres de una persona para un servicio: sus tramos de cada día,
 * menos los días cerrados, menos sus citas (con margen), desde «ahora +
 * antelación» y hasta «hoy + maxDays». Una franja tiene que caber entera en
 * su tramo; el margen puede salirse del tramo (es tiempo de la persona, no de
 * atención).
 */
export function computeSlots(input: SlotInput): Slot[] {
  const tz = input.timezone;
  const today = utcToZoned(input.now, tz).date;
  const last = addDays(today, Math.max(0, input.maxDays));
  const first = input.fromDate && input.fromDate > today ? input.fromDate : today;
  const span = Math.max(1, input.days ?? input.maxDays + 1);
  const earliest = input.now.getTime() + input.minNoticeMin * 60_000;
  const step = Math.max(5, input.intervalMin);
  const blockMs = (input.durationMin + (input.bufferAfterMin ?? 0)) * 60_000;
  const busy = input.busy ?? [];
  const blackouts = input.blackouts ?? [];
  const out: Slot[] = [];

  for (let k = 0; k < span; k++) {
    const date = addDays(first, k);
    if (date > last) break;
    if (inBlackout(date, blackouts)) continue;
    for (const range of input.hours[weekdayOf(date)] ?? []) {
      const open = toMin(range.from);
      const close = toMin(range.to);
      for (let t = open; t + input.durationMin <= close; t += step) {
        const start = zonedToUtc(date, fromMin(t), tz);
        if (start.getTime() < earliest) continue;
        const blockEnd = start.getTime() + blockMs;
        if (busy.some((b) => start.getTime() < b.end.getTime() && blockEnd > b.start.getTime())) continue;
        out.push({ start, end: new Date(start.getTime() + input.durationMin * 60_000), date, time: fromMin(t) });
        if (input.limit && out.length >= input.limit) return out;
      }
    }
  }
  return out;
}

/** ¿Esa hora exacta es una franja libre? Para validar antes de reservar. */
export function isFreeSlot(input: Omit<SlotInput, "fromDate" | "days" | "limit">, start: Date): boolean {
  const { date } = utcToZoned(start, input.timezone);
  return computeSlots({ ...input, fromDate: date, days: 1 }).some((s) => s.start.getTime() === start.getTime());
}

// ── Textos ──────────────────────────────────────────────────
/** «martes 4 de noviembre». */
export function formatBookingDay(date: string, locale = "es"): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

/** «martes 4 de noviembre, 10:30» en la zona del negocio. */
export function formatBookingAt(at: Date, tz: string, locale = "es"): string {
  const z = utcToZoned(at, tz);
  return `${formatBookingDay(z.date, locale)}, ${z.time}`;
}

/** Valida «AAAA-MM-DDTHH:mm» (lo que escribe el agente) y lo separa. */
export function parseLocalDateTime(value: string): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const [h, mi] = m[2]!.split(":").map(Number) as [number, number];
  if (h > 23 || mi > 59) return null;
  return { date: m[1]!, time: m[2]! };
}
