import {
  FOLLOW_UP_BEFORE_CLOSE_MIN,
  FOLLOW_UP_MIN_GAP_MINUTES,
  followUpsSchema,
  type BusinessHours,
  type FollowUps,
} from "@crm/shared";
import { firstMomentAtOrAfter, isWithinHours, lastMomentAtOrBefore } from "../../common/utils/business-hours";
import { isQuietAt, type QuietClock } from "../../common/utils/quiet-hours";

/**
 * Reglas de los seguimientos que no tocan base de datos ni proveedor, para
 * poder probarlas solas. El servicio (follow-up.service.ts) las aplica.
 */

/** Toque cancelado desde la bandeja: no se reprograma hasta que el cliente escriba. */
export const FOLLOW_UP_CANCELLED = -1;

/** Lo guardado en el agente; null si está apagado, vacío o no se reconoce. */
export function parseFollowUps(raw: unknown): FollowUps | null {
  if (!raw || typeof raw !== "object") return null;
  const r = followUpsSchema.safeParse(raw);
  return r.success && r.data.enabled && r.data.steps.length ? r.data : null;
}

/** Por qué un toque «antes del cierre» no llega a programarse. */
export type FollowUpSkipReason =
  /** La ventana ya está cerrada (el chat lo retomamos nosotros con una plantilla). */
  | "window_closed"
  /** Ya queda menos que eso para el cierre, o no hay horario de atención antes. */
  | "no_time";

export interface FollowUpPlan {
  /** Toque que queda programado; `steps.length` si la secuencia terminó. */
  step: number;
  dueAt: Date | null;
  /** Toques «antes del cierre» que se saltan porque ya no llegan. */
  skipped: { step: number; reason: FollowUpSkipReason }[];
  /** El toque programado se adelantó para que salga con la ventana abierta. */
  movedUp: boolean;
}

/**
 * Cuándo puede salir un toque en un chat: dentro del horario de atención del
 * agente (si lo tiene activado) y fuera del horario de descanso de los
 * seguimientos (si lo tiene), mirado con el reloj de ese cliente.
 */
export interface SendTimes {
  hours: BusinessHours | null;
  quiet: QuietClock | null;
}

/** Sin horario de atención ni de descanso: sale a cualquier hora. */
export const ANY_TIME: SendTimes = { hours: null, quiet: null };

export function canSendAt(times: SendTimes, at: Date): boolean {
  return (!times.hours || isWithinHours(times.hours, at)) && (!times.quiet || !isQuietAt(times.quiet, at));
}

/** Hasta cuánto se mira hacia delante buscando un momento en que se pueda enviar. */
const WAIT_SCAN_MS = 7 * 24 * 60 * 60_000;

/**
 * El primer momento desde `at` en que se puede enviar. Devuelve `at` si se
 * puede a cualquier hora o si no se encuentra ninguno en una semana (un
 * horario sin ningún día abierto): entonces decide el barrido al vencer.
 */
export function nextSendable(times: SendTimes, at: Date): Date {
  if (!times.hours && !times.quiet) return at;
  return firstMomentAtOrAfter((d) => canSendAt(times, d), at, new Date(at.getTime() + WAIT_SCAN_MS)) ?? at;
}

/**
 * Qué toque queda programado, y para cuándo, tras un mensaje nuestro enviado
 * en `from`.
 *
 * La ventana la fija el canal: en WhatsApp, 24 h desde el último mensaje del
 * cliente; nuestros mensajes no la alargan. Por eso un toque «tras X de
 * silencio» puede caer fuera aunque la secuencia sume menos de 24 h (lo
 * normal: porque esperó al horario de atención).
 *
 *  - «Antes del cierre»: sale `beforeCloseMinutes` antes de que se cierre. Si
 *    a esa hora no se atiende, en el último momento de atención anterior. Si
 *    ya no hay tiempo o la ventana está cerrada, se salta.
 *  - «Tras X de silencio» con `keepInWindow`: si es de texto o de IA y saldría
 *    con la ventana cerrada, se adelanta al último momento en que aún cabe.
 *    Si no cabe ninguno, se queda donde estaba y al vencer se omite.
 *  - Un toque que cae cuando no se puede enviar (`times`: fuera del horario de
 *    atención o en horario de descanso) queda programado para el primer
 *    momento en que sí: es la hora que ve el equipo en la bandeja.
 */
export function planFollowUp(
  cfg: FollowUps,
  step: number,
  from: Date,
  windowExpiresAt: Date | null,
  times: SendTimes = ANY_TIME,
): FollowUpPlan {
  const skipped: FollowUpPlan["skipped"] = [];
  if (step < 0) return { step, dueAt: null, skipped, movedUp: false };
  const open = !!windowExpiresAt && windowExpiresAt > from;
  const earliest = new Date(from.getTime() + FOLLOW_UP_MIN_GAP_MINUTES * 60_000);
  const ok = times.hours || times.quiet ? (d: Date) => canSendAt(times, d) : null;
  /** El último momento, sin pasar de `at`, en que se puede enviar. */
  const lastSendable = (at: Date): Date | null => {
    if (at < earliest) return null;
    return ok ? lastMomentAtOrBefore(ok, at, earliest) : at;
  };

  for (let i = Math.max(0, step); i < cfg.steps.length; i++) {
    const s = cfg.steps[i]!;
    if (s.timing === "before_close") {
      if (!open) {
        skipped.push({ step: i, reason: "window_closed" });
        continue;
      }
      const target = lastSendable(new Date(windowExpiresAt!.getTime() - s.beforeCloseMinutes * 60_000));
      if (!target) {
        skipped.push({ step: i, reason: "no_time" });
        continue;
      }
      return { step: i, dueAt: target, skipped, movedUp: false };
    }

    const due = new Date(from.getTime() + s.afterMinutes * 60_000);
    if (cfg.keepInWindow && s.kind !== "template" && open) {
      const limit = new Date(windowExpiresAt!.getTime() - FOLLOW_UP_BEFORE_CLOSE_MIN * 60_000);
      // Cuándo saldría de verdad: fuera de horario o en horario de descanso, el toque espera.
      const real = due > limit ? null : ok ? firstMomentAtOrAfter(ok, due, limit) : due;
      if (!real) {
        const moved = lastSendable(due < limit ? due : limit);
        if (moved) return { step: i, dueAt: moved, skipped, movedUp: true };
      }
    }
    return { step: i, dueAt: nextSendable(times, due), skipped, movedUp: false };
  }
  return { step: Math.max(step, cfg.steps.length), dueAt: null, skipped, movedUp: false };
}

/**
 * ¿Toca hacer seguimiento en este chat? Por defecto solo en los que atiende
 * la IA (autopilot y sin pasar a una persona); con `includeHuman`, en todos.
 */
export function followUpAllowed(cfg: FollowUps, convo: { aiMode: string; handoffAt: Date | null }): boolean {
  return cfg.includeHuman || (convo.aiMode === "AUTOPILOT" && !convo.handoffAt);
}

/** Un listado de más productos no dice qué le interesa al cliente. */
const SPECIFIC_MAX = 3;

/**
 * De lo que consultó el agente en el catálogo (lo que devolvió search_products,
 * de la consulta más reciente a la más antigua), los productos de la última
 * búsqueda concreta: los que le interesan al cliente. Un listado del catálogo
 * entero se salta.
 */
export function consultedProductNames(outputs: unknown[]): string[] {
  for (const output of outputs) {
    const raw = output && typeof output === "object" ? (output as { result?: unknown }).result : null;
    if (typeof raw !== "string") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const products = parsed && typeof parsed === "object" ? (parsed as { products?: unknown }).products : null;
    if (!Array.isArray(products)) continue;
    const names = products.map((p) => (p && typeof p === "object" ? (p as { name?: unknown }).name : null)).filter((n): n is string => typeof n === "string" && !!n.trim());
    if (names.length >= 1 && names.length <= SPECIFIC_MAX) return names;
  }
  return [];
}

/** «A», «A y B», «A, B y C»: varios nombres en una frase, para el hueco de una plantilla. */
export function listText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

const amount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** «Genómica bacteriana: USD 40 (antes USD 50, 20 % de descuento hasta el 30 de noviembre)». */
export function productFactLine(
  name: string,
  p: { price: number; currency: string; regularPrice?: number; discount?: string; discountUntil?: string },
): string {
  const sale =
    p.regularPrice !== undefined
      ? ` (antes ${p.currency} ${amount(p.regularPrice)}, ${p.discount} de descuento${p.discountUntil ? ` hasta el ${p.discountUntil}` : ""})`
      : "";
  return `${name}: ${p.currency} ${amount(p.price)}${sale}`;
}

/**
 * Lo que se le pide al modelo cuando redacta un seguimiento. No consulta el
 * catálogo: escribe a partir del chat, donde puede haber un precio o una
 * oferta que ya cambió o venció. Con `facts` (los datos de hoy de lo que
 * consultó el cliente, ver consultedProductNames) puede citar esos y solo
 * esos; sin ellos, no menciona ninguno.
 */
export function followUpDraftAsk(goal: string, facts: string[] = []): string {
  const prices = facts.length
    ? ` Datos de hoy de lo que consultó el cliente:\n${facts.map((f) => `- ${f}`).join("\n")}\nEsos son los únicos precios, descuentos y fechas de oferta que puedes mencionar (los del chat pueden haber cambiado); si ayudan a retomar, dilos tal cual, sin calcular nada.`
    : " No menciones precios, descuentos ni fechas de oferta: pueden haber cambiado desde que se hablaron.";
  return (
    "[Nota del sistema, no es un mensaje del cliente] El cliente lleva un tiempo sin responder. Escribe UN solo mensaje de seguimiento, breve (una o dos frases), cálido y sin presionar, que retome lo último que hablaban. No saludes como si fuera el primer contacto ni repitas lo que ya dijiste." +
    prices +
    (goal.trim() ? ` Objetivo del mensaje: ${goal.trim()}.` : "") +
    " Devuelve solo el texto del mensaje."
  );
}
