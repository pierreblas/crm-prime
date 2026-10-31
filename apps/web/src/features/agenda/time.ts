import { WEEKDAYS, addDays, formatBookingDay, utcToZoned, weekdayOf, zonedToUtc } from "@crm/shared";

/**
 * Fechas de la agenda, siempre en la zona del negocio (no en la del
 * navegador): quien mira la agenda desde otro país ve las mismas horas que el
 * cliente al que se las ofrecieron.
 */

export const todayIn = (tz: string) => utcToZoned(new Date(), tz).date;

/** El lunes de la semana de esa fecha. */
export const weekStart = (date: string) => addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));

/** Instantes UTC de [inicio del día `from`, inicio del día `to`) en la zona. */
export function rangeIso(from: string, to: string, tz: string): { from: string; to: string } {
  return { from: zonedToUtc(from, "00:00", tz).toISOString(), to: zonedToUtc(to, "00:00", tz).toISOString() };
}

export const timeIn = (iso: string, tz: string) => utcToZoned(new Date(iso), tz).time;
export const dateIn = (iso: string, tz: string) => utcToZoned(new Date(iso), tz).date;

/** «Hoy», «Mañana» o «martes, 3 de noviembre». */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Hoy";
  if (date === addDays(today, 1)) return "Mañana";
  if (date === addDays(today, -1)) return "Ayer";
  const label = formatBookingDay(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const pad = (n: number) => String(n).padStart(2, "0");
const parts = (date: string) => date.split("-").map(Number) as [number, number, number];
const asUtcNoon = (date: string) => {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** «lun» y «2» para la tira de días. */
export function dayChip(date: string): { weekday: string; day: number; month: string } {
  const at = asUtcNoon(date);
  return {
    weekday: new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" }).format(at).replace(".", ""),
    day: at.getUTCDate(),
    month: new Intl.DateTimeFormat("es", { month: "short", timeZone: "UTC" }).format(at).replace(".", ""),
  };
}

/** «2 – 8 de noviembre de 2026» o «30 de noviembre – 6 de diciembre de 2026». */
export function weekLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  const [y1, m1, d1] = parts(monday);
  const [y2, m2, d2] = parts(sunday);
  const month = (date: string) => new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" }).format(asUtcNoon(date));
  if (y1 !== y2) return `${d1} de ${month(monday)} de ${y1} – ${d2} de ${month(sunday)} de ${y2}`;
  if (m1 !== m2) return `${d1} de ${month(monday)} – ${d2} de ${month(sunday)} de ${y2}`;
  return `${d1} – ${d2} de ${month(sunday)} de ${y2}`;
}

/** «45 min», «1 h», «1 h 30 min». */
export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Valor para un <input type="date"> a partir de «AAAA-MM-DD» (ya lo es) o de hoy. */
export const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export { addDays, pad };
