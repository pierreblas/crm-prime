import { countryFromPhone, type FollowUpQuiet } from "@crm/shared";
import { localClock } from "./business-hours";

/**
 * Horario de descanso de los seguimientos: una franja del día (lo normal, la
 * noche) en la que no se le escribe al cliente. Se mira con el reloj del
 * cliente, que se deduce del país de su teléfono, o con el del negocio.
 *
 * No es el horario de atención: ese decide cuándo responde el agente. Este
 * solo frena lo que Driony envía por iniciativa propia.
 */

/**
 * Zonas horarias de cada país que Driony reconoce por el prefijo (los de
 * `COUNTRIES` en @crm/shared). De un país con varias no se sabe en cuál vive
 * el cliente: lleva la de más al este y la de más al oeste de las pobladas, y
 * se respeta el descanso de las dos.
 */
export const COUNTRY_ZONES: Record<string, string[]> = {
  AR: ["America/Argentina/Buenos_Aires"],
  BO: ["America/La_Paz"],
  BR: ["America/Sao_Paulo", "America/Manaus"],
  CL: ["America/Santiago"],
  CO: ["America/Bogota"],
  CR: ["America/Costa_Rica"],
  DE: ["Europe/Berlin"],
  DO: ["America/Santo_Domingo"],
  EC: ["America/Guayaquil"],
  ES: ["Europe/Madrid", "Atlantic/Canary"],
  FR: ["Europe/Paris"],
  GB: ["Europe/London"],
  GT: ["America/Guatemala"],
  HN: ["America/Tegucigalpa"],
  IT: ["Europe/Rome"],
  MX: ["America/Cancun", "America/Tijuana"],
  NI: ["America/Managua"],
  PA: ["America/Panama"],
  PE: ["America/Lima"],
  PR: ["America/Puerto_Rico"],
  PT: ["Europe/Lisbon"],
  PY: ["America/Asuncion"],
  SV: ["America/El_Salvador"],
  // El prefijo +1 es de Estados Unidos y de Canadá.
  US: ["America/New_York", "America/Los_Angeles"],
  UY: ["America/Montevideo"],
  VE: ["America/Caracas"],
};

/** La franja de descanso y los relojes con los que se mira para un cliente concreto. */
export interface QuietClock {
  /** «HH:MM» en que empieza el descanso. */
  from: string;
  /** «HH:MM» en que termina. Menor que `from` si cruza la medianoche. */
  to: string;
  zones: string[];
}

/**
 * El horario de descanso que rige para ese teléfono; null si está apagado.
 * Con «la hora del cliente» se usa la del país de su número; si no se reconoce
 * (otro país, o un cliente de Messenger, Instagram o TikTok, que no tiene
 * número), la zona del negocio.
 */
export function quietClockFor(quiet: FollowUpQuiet | null | undefined, phone: string | null | undefined): QuietClock | null {
  if (!quiet?.enabled || quiet.from === quiet.to) return null;
  const country = quiet.clock === "contact" ? countryFromPhone(phone) : null;
  const zones = (country && COUNTRY_ZONES[country.code]) || [quiet.timezone || "America/Lima"];
  return { from: quiet.from, to: quiet.to, zones };
}

/**
 * ¿Es hora de descanso? Con varias zonas basta con que lo sea en una. El
 * descanso empieza en `from` y acaba justo antes de `to`: a las 08:00 en punto
 * ya se puede escribir. Una zona desconocida no bloquea.
 */
export function isQuietAt(q: QuietClock, at: Date): boolean {
  return q.zones.some((tz) => {
    const time = localClock(tz, at)?.time;
    if (!time) return false;
    return q.from < q.to ? time >= q.from && time < q.to : time >= q.from || time < q.to;
  });
}
