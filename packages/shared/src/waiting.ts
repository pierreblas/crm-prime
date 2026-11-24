/** Las fechas de un chat que hacen falta para saber cuánto espera el cliente. */
export interface ChatDates {
  awaitingReply?: boolean;
  /** Lo último que se envió, sea de quien sea. */
  lastMessageAt: string | null;
  /** Lo último que escribió el cliente. */
  lastInboundAt?: string | null;
}

/** Cuándo escribió el cliente por última vez, en ms (0 si no se sabe). */
export function lastInboundMs(c: ChatDates): number {
  const at = c.lastInboundAt ?? c.lastMessageAt;
  return at ? new Date(at).getTime() : 0;
}

/** Cuánto lleva esperando el cliente, en ms; null si no espera respuesta. */
export function waitingMs(c: ChatDates, now: number = Date.now()): number | null {
  const at = c.awaitingReply ? lastInboundMs(c) : 0;
  return at ? now - at : null;
}
