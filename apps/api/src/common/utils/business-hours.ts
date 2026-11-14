import type { BusinessHours } from "@crm/shared";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * ¿Estamos dentro del horario de atención? Se usa en el agente de IA (fuera
 * de horario no responde) y en el bloque «Horario» de los flujos.
 * Una zona horaria inválida no bloquea: se asume dentro de horario.
 */
export function isWithinHours(hours: BusinessHours, at: Date = new Date()): boolean {
  const clock = localClock(hours.timezone || "America/Lima", at);
  if (!clock) return true;
  const range = hours.days?.[clock.day];
  if (!range) return false; // día cerrado
  return clock.time >= range.from && clock.time <= range.to;
}

/**
 * Un formateador por zona: crearlo es lo caro, y los seguimientos preguntan
 * por el horario decenas de veces seguidas al buscar un momento de atención.
 */
const clocks = new Map<string, Intl.DateTimeFormat>();

/** Día de la semana y hora («HH:MM») en la zona; null si la zona no existe. */
function localClock(tz: string, at: Date): { day: (typeof WEEKDAYS)[number]; time: string } | null {
  try {
    let fmt = clocks.get(tz);
    if (!fmt) {
      // h23: la medianoche es «00», nunca «24», y el día es ya el nuevo.
      fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      clocks.set(tz, fmt);
    }
    const parts = fmt.formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = WEEKDAYS.find((d) => d === get("weekday").toLowerCase());
    if (!day) return null;
    return { day, time: `${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}` };
  } catch {
    return null;
  }
}

/** Paso con el que se busca un momento dentro de horario. */
const SCAN_MINUTES = 15;
/**
 * Para programar algo «dentro de horario» no basta con que lo esté ese
 * minuto: quien lo envía es un barrido que pasa poco después, y si para
 * entonces ya cerró, se queda sin salir. Se pide que siga abierto este rato.
 */
const OPEN_SLACK_MINUTES = 10;

function opensWithSlack(hours: BusinessHours, t: number): boolean {
  return isWithinHours(hours, new Date(t)) && isWithinHours(hours, new Date(t + OPEN_SLACK_MINUTES * 60_000));
}

/**
 * El último momento dentro de horario que no pasa de `at`, mirando hacia atrás
 * hasta `notBefore`. null si en ese tramo no se atiende. Va a saltos de 15 min
 * y con margen: el resultado queda entre 10 y 25 min antes del cierre del día.
 */
export function lastOpenAtOrBefore(hours: BusinessHours, at: Date, notBefore: Date): Date | null {
  for (let t = at.getTime(); t >= notBefore.getTime(); t -= SCAN_MINUTES * 60_000) {
    if (opensWithSlack(hours, t)) return new Date(t);
  }
  return null;
}

/** El primer momento dentro de horario desde `at`, sin pasar de `notAfter`. null si no abre antes. */
export function firstOpenAtOrAfter(hours: BusinessHours, at: Date, notAfter: Date): Date | null {
  for (let t = at.getTime(); t <= notAfter.getTime(); t += SCAN_MINUTES * 60_000) {
    if (opensWithSlack(hours, t)) return new Date(t);
  }
  return null;
}

