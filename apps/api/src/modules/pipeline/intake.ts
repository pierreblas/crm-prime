import type { Prisma } from "@prisma/client";

/**
 * Reglas puras de la entrada automática al embudo. Van aparte del servicio
 * para poder probarlas sin base de datos.
 */

/**
 * Entre los vendedores candidatos, el que menos oportunidades abiertas tiene
 * en el embudo. Con empate, el primero de la lista (que es el orden de
 * asignación a la fuente). Reparte parejo sin necesitar memoria de turnos.
 */
export function pickLeastLoaded(
  candidates: string[],
  openByOwner: Map<string, number>,
): string | null {
  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const id of candidates) {
    const n = openByOwner.get(id) ?? 0;
    if (n < bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

export interface LastDeal {
  discardedAt: Date | null;
  discardReason: string | null;
  stage: { isWon: boolean; isLost: boolean; pipelineId: string };
}

const INTAKE_INCLUDE = { stage: { select: { isWon: true, isLost: true, pipelineId: true } } } as const;

/**
 * La oportunidad que decide: una abierta, si hay alguna; si no, la última. Mirar
 * solo la última abría otra cuando la más nueva se había descartado, perdido o
 * ganado y quedaba una anterior en curso (por ejemplo, al limpiar repetidas).
 */
export async function intakeDeal(db: Pick<Prisma.TransactionClient, "deal">, contactId: string) {
  return (
    (await db.deal.findFirst({
      where: { contactId, discardedAt: null, stage: { isWon: false, isLost: false } },
      orderBy: { createdAt: "desc" },
      include: INTAKE_INCLUDE,
    })) ?? (await db.deal.findFirst({ where: { contactId }, orderBy: { createdAt: "desc" }, include: INTAKE_INCLUDE }))
  );
}

/**
 * Qué hacer con un contacto que escribe, según su oportunidad (ver intakeDeal):
 *
 *   - abierta y en curso  → nada, ya se está trabajando;
 *   - descartada por inactividad en este mismo embudo → vuelve (respondió);
 *   - ganada, perdida, descartada a mano o inexistente → una nueva.
 */
export function decideIntake(
  last: LastDeal | null,
  pipelineId: string,
): "skip" | "restore" | "create" {
  if (!last) return "create";
  if (!last.discardedAt && !last.stage.isWon && !last.stage.isLost) return "skip";
  if (
    last.discardedAt &&
    last.discardReason === "auto" &&
    last.stage.pipelineId === pipelineId
  ) {
    return "restore";
  }
  return "create";
}
