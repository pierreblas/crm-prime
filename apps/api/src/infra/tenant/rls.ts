import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../common/utils/env";
import { currentOrgId, isUnscoped, tenancyMode, tenantStorage } from "./tenant.context";

/** Quién hace el cambio (historial de oportunidades): va en la misma transacción que la escritura. */
function actorSetting(base: PrismaClient): Prisma.PrismaPromise<unknown>[] {
  const actor = tenantStorage.getStore()?.actor;
  return actor ? [base.$executeRaw`SELECT set_config('app.actor', ${actor}, true)`] : [];
}

/**
 * Capa 2 del aislamiento: fija `app.current_org` para que Row-Level Security
 * haga su trabajo.
 *
 * Por defecto solo se activa en modo SaaS. En una instalación de una sola
 * empresa RLS no aporta nada y sí cuesta: cada consulta pasa a ser una
 * transacción de dos sentencias. `DB_RLS=on|off` fuerza cualquiera de los dos.
 */
export const rlsEnabled =
  env("DB_RLS") === "on" || (env("DB_RLS") !== "off" && tenancyMode === "multi");

/**
 * Marca "ya estamos dentro de una transacción con la organización fijada".
 *
 * Sin esto, cada operación de un `$transaction([...])` intentaría abrir su
 * propia transacción dentro de la que ya está abierta. Es un
 * `AsyncLocalStorage` y no un booleano compartido a propósito: con un booleano,
 * dos operaciones concurrentes de la misma petición se pisarían.
 */
const insideTx = new AsyncLocalStorage<true>();

/** ¿Estamos dentro de una transacción que ya fijó la organización? */
export function isInsideTransaction(): boolean {
  return insideTx.getStore() === true;
}

/** Marca que el bloque ya fijó la organización; las operaciones de dentro no repiten. */
export function markInsideTransaction<T>(fn: () => T): T {
  return insideTx.run(true, fn);
}

/**
 * `'*'` desactiva la política. Lo produce únicamente `runUnscoped()`, y la
 * política de la base lo reconoce explícitamente.
 */
function orgSetting(): string | null {
  if (isUnscoped()) return "*";
  return currentOrgId();
}

/** El `set_config` que abre cada transacción. */
export function orgSettingValue(): string | null {
  return orgSetting();
}

/**
 * Envuelve un cliente ya extendido para que `$transaction` siga siendo atómico.
 *
 * Sin esto, cada operación de un `$transaction([a, b])` entra por
 * `$allOperations` y se abre **su propia** transacción: dos transacciones
 * separadas en vez de una. Todo parece funcionar hasta que la segunda falla y
 * la primera ya está aplicada. Lo rompía, entre otras cosas, la revocación de
 * sesiones al cerrar un dispositivo: se marcaba la sesión y no los tokens.
 *
 * Aquí se hace al revés: una sola transacción, con el `set_config` de cabeza, y
 * las operaciones de dentro marcadas para que no lo repitan.
 */
export function withAtomicTransactions<T extends object>(client: T, base: PrismaClient): T {
  if (!rlsEnabled) return client;

  const original = Reflect.get(client as object, "$transaction") as (
    ...a: unknown[]
  ) => Promise<unknown>;

  const patched = async (...args: unknown[]): Promise<unknown> => {
    const value = orgSetting();
    if (!value) return original.apply(client, args);

    const setConfig = base.$executeRaw`SELECT set_config('app.current_org', ${value}, true)`;
    const actorCfg = actorSetting(base);

    // Forma por lotes: $transaction([op, op]). Es la que usa la aplicación.
    if (Array.isArray(args[0])) {
      const [ops, ...rest] = args as [unknown[], ...unknown[]];
      const res = (await markInsideTransaction(() =>
        original.apply(client, [[setConfig, ...actorCfg, ...ops], ...rest]),
      )) as unknown[];
      return res.slice(1 + actorCfg.length); // fuera los resultados de los set_config
    }

    // Forma interactiva: $transaction(async (tx) => …).
    const fn = args[0] as (tx: unknown) => Promise<unknown>;
    const [, ...rest] = args;
    return original.apply(client, [
      (tx: { $executeRaw: (...a: unknown[]) => Promise<unknown> }) =>
        markInsideTransaction(async () => {
          await tx.$executeRaw`SELECT set_config('app.current_org', ${value}, true)`;
          return fn(tx);
        }),
      ...rest,
    ]);
  };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "$transaction") return patched;
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function createRlsExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: "rls-org-context",
    query: {
      // Sin `$allModels`: así intercepta también $queryRaw y $executeRaw, que
      // es justo donde la capa 1 no llega y esta tiene que llegar.
      async $allOperations({ args, query }) {
        if (!rlsEnabled) return query(args);
        if (insideTx.getStore()) return query(args);

        const value = orgSetting();
        // Sin valor, RLS falla cerrado (cero filas). Se deja pasar a propósito:
        // que la consulta devuelva vacío es exactamente lo que debe ocurrir.
        if (!value) return query(args);

        // Por lotes y no con transacción interactiva: dentro de una interactiva
        // la consulta de la extensión se ejecuta en OTRA conexión, así que el
        // `set_config` no le llegaría. Comprobado, no supuesto.
        // El autor (si lo hay) va en la misma transacción: lo lee el historial de oportunidades.
        const res = await markInsideTransaction(() =>
          base.$transaction([
            base.$executeRaw`SELECT set_config('app.current_org', ${value}, true)`,
            ...actorSetting(base),
            query(args) as Prisma.PrismaPromise<unknown>,
          ]),
        );
        return res[res.length - 1];
      },
    },
  });
}
