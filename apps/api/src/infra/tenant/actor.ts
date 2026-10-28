import { Prisma, PrismaClient } from "@prisma/client";
import { tenantStorage } from "./tenant.context";
import { isInsideTransaction, markInsideTransaction, orgSettingValue, rlsEnabled } from "./rls";

/**
 * Quién hace un cambio, para el historial de las oportunidades.
 *
 * El historial lo escribe un disparador de Postgres (así ningún camino se lo
 * salta) y lee el autor de `app.actor`. Aquí se decide qué poner ahí:
 *
 *   user:<id>        una persona desde el panel (lo fija el interceptor)
 *   api:<id>         una clave de API
 *   ai               el agente de IA
 *   flow:<id>        un flujo
 *   system:<motivo>  un proceso automático (descarte, entrada desde WhatsApp…)
 *
 * Vive en el mismo almacén que la organización, así que viaja solo por la pila.
 */
export function currentActor(): string | null {
  return tenantStorage.getStore()?.actor ?? null;
}

/** Ejecuta `fn` firmando los cambios como `actor` (conserva la organización del contexto). */
export async function runAsActor<T>(actor: string, fn: () => T | Promise<T>): Promise<T> {
  const store = tenantStorage.getStore();
  return tenantStorage.run({ ...(store ?? { orgId: null }), actor }, async () => fn());
}

const WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert"]);

/**
 * En las escrituras de oportunidades, deja `app.actor` en la misma transacción
 * que la escritura, para que el disparador del historial lo lea. Va por fuera
 * de la extensión de RLS: si hace falta, fija también la organización aquí.
 */
export function createActorExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: "deal-actor",
    query: {
      deal: {
        async $allOperations({ operation, args, query }) {
          const actor = currentActor();
          // Con RLS activo, la propia extensión de RLS ya pasa el autor en su transacción.
          if (!actor || !WRITES.has(operation) || isInsideTransaction() || (rlsEnabled && orgSettingValue())) return query(args);
          const ops: Prisma.PrismaPromise<unknown>[] = [
            base.$executeRaw`SELECT set_config('app.actor', ${actor}, true)`,
            query(args) as Prisma.PrismaPromise<unknown>,
          ];
          const res = await markInsideTransaction(() => base.$transaction(ops));
          return res[res.length - 1];
        },
      },
    },
  });
}
