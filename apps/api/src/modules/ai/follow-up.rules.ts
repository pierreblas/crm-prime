import { followUpsSchema, type FollowUps, type FollowUpStep } from "@crm/shared";

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

/** Cuándo toca el toque `step` contando desde `from`; null si la secuencia terminó o está cancelada. */
export function dueAtFor(steps: FollowUpStep[], step: number, from: Date): Date | null {
  if (step < 0) return null;
  const s = steps[step];
  return s ? new Date(from.getTime() + s.afterMinutes * 60_000) : null;
}

/**
 * ¿Toca hacer seguimiento en este chat? Por defecto solo en los que atiende
 * la IA (autopilot y sin pasar a una persona); con `includeHuman`, en todos.
 */
export function followUpAllowed(cfg: FollowUps, convo: { aiMode: string; handoffAt: Date | null }): boolean {
  return cfg.includeHuman || (convo.aiMode === "AUTOPILOT" && !convo.handoffAt);
}
