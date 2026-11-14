import {
  FOLLOW_UP_BEFORE_CLOSE_MIN,
  FOLLOW_UP_MIN_GAP_MINUTES,
  followUpsSchema,
  type BusinessHours,
  type FollowUps,
} from "@crm/shared";
import { firstOpenAtOrAfter, lastOpenAtOrBefore } from "../../common/utils/business-hours";

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
 *
 * `hours` es el horario de atención del agente si lo tiene activado.
 */
export function planFollowUp(
  cfg: FollowUps,
  step: number,
  from: Date,
  windowExpiresAt: Date | null,
  hours: BusinessHours | null = null,
): FollowUpPlan {
  const skipped: FollowUpPlan["skipped"] = [];
  if (step < 0) return { step, dueAt: null, skipped, movedUp: false };
  const open = !!windowExpiresAt && windowExpiresAt > from;
  const earliest = new Date(from.getTime() + FOLLOW_UP_MIN_GAP_MINUTES * 60_000);
  /** El último momento, sin pasar de `at`, en que se puede enviar. */
  const lastSendable = (at: Date): Date | null => {
    if (at < earliest) return null;
    return hours ? lastOpenAtOrBefore(hours, at, earliest) : at;
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
      // Cuándo saldría de verdad: fuera de horario, el toque espera a que abra.
      const real = due > limit ? null : hours ? firstOpenAtOrAfter(hours, due, limit) : due;
      if (!real) {
        const moved = lastSendable(due < limit ? due : limit);
        if (moved) return { step: i, dueAt: moved, skipped, movedUp: true };
      }
    }
    return { step: i, dueAt: due, skipped, movedUp: false };
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
