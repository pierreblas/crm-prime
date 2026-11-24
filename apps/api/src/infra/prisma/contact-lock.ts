import type { Conversation, Prisma } from "@prisma/client";
import { currentActor } from "../tenant/actor";
import { markInsideTransaction } from "../tenant/rls";
import type { PrismaService } from "./prisma.service";

/**
 * «Mirar si ya tiene y, si no, crear» de una sola vez por contacto.
 *
 * Un lead entra por varios lados a la vez (el formulario, su mensaje de
 * WhatsApp, un flujo, una llamada): cada uno miraba, no veía nada y creaba lo
 * suyo, y la persona salía dos veces en el embudo o en la bandeja. El cerrojo
 * es de la base, así que vale también entre procesos, y se suelta solo al
 * terminar la transacción.
 *
 * Dentro de `run` se usa **solo** `tx`: otra consulta pediría otra conexión
 * mientras esta espera. Los avisos (`events.emit`) van fuera, ya guardado todo.
 */
export function withContactLock<T>(
  prisma: PrismaService,
  contactId: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const actor = currentActor();
  return prisma.$transaction(
    (tx) =>
      markInsideTransaction(async () => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contact:${contactId}`}))`;
        // Quién lo hace, para el historial de la oportunidad.
        if (actor) await tx.$executeRaw`SELECT set_config('app.actor', ${actor}, true)`;
        return run(tx);
      }),
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/**
 * El chat abierto del contacto o, si no tiene, uno nuevo con `data`. Solo
 * espera turno cuando parece que hay que abrirlo: lo normal es que ya exista.
 */
export async function findOrOpenConversation(
  prisma: PrismaService,
  contactId: string,
  data: Omit<Prisma.ConversationUncheckedCreateInput, "contactId">,
  orderBy: Prisma.ConversationOrderByWithRelationInput = { createdAt: "desc" },
): Promise<{ conversation: Conversation; created: boolean }> {
  const find = (db: Pick<Prisma.TransactionClient, "conversation">) =>
    db.conversation.findFirst({ where: { contactId, status: { not: "CLOSED" } }, orderBy });
  const open = await find(prisma);
  if (open) return { conversation: open, created: false };
  return withContactLock(prisma, contactId, async (tx) => {
    const late = await find(tx);
    if (late) return { conversation: late, created: false };
    return { conversation: await tx.conversation.create({ data: { ...data, contactId } }), created: true };
  });
}
