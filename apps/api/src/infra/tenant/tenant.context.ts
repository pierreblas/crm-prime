import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "../../common/utils/env";

export interface TenantStore {
  orgId: string | null;
  /** Escapatoria deliberada: ver `runUnscoped`. */
  unscoped?: boolean;
  /** Quién hace los cambios (historial de oportunidades): ver infra/tenant/actor.ts. */
  actor?: string;
}

/**
 * Organización de la operación en curso.
 *
 * Se usa `AsyncLocalStorage` y no una propiedad de la petición porque el
 * `orgId` hace falta en sitios que no ven el `Request`: procesadores de cola,
 * herramientas del agente, adaptadores. Pasarlo a mano por toda la pila es
 * justo el tipo de cambio que alguien acaba olvidando en una rama.
 */
export const tenantStorage = new AsyncLocalStorage<TenantStore>();

/** `single` = una sola empresa (open source). `multi` = SaaS por subdominio. */
export const tenancyMode: "single" | "multi" =
  env("TENANCY_MODE") === "multi" ? "multi" : "single";

// La organización única del modo `single`. La fija TenantService al arrancar.
// Vive aquí, fuera del contenedor de dependencias, porque la extensión de
// Prisma la necesita y no puede inyectar un servicio que depende de Prisma.
let singleOrgId: string | null = null;

export function setSingleOrg(id: string | null): void {
  singleOrgId = id;
}

/**
 * El `orgId` que aplica ahora mismo, o null si no hay ninguno.
 *
 * En modo `single` cae en la organización única; en `multi` **no hay
 * respaldo**, porque un valor por defecto en SaaS es una fuga de datos con
 * forma de comodidad.
 */
export function currentOrgId(): string | null {
  const fromStore = tenantStorage.getStore()?.orgId;
  if (fromStore) return fromStore;
  return tenancyMode === "single" ? singleOrgId : null;
}

/**
 * Ejecuta `fn` como si la operación viniera de esta organización.
 *
 * Es `async` y espera a `fn()` **dentro** del contexto a propósito. Las
 * promesas de Prisma son perezosas: `run(() => prisma.x.findMany())` crea la
 * promesa dentro del contexto pero la ejecuta al hacer `await`, ya fuera, y el
 * contexto se ha perdido para entonces. Con el `await` aquí dentro, el patrón
 * corto y natural funciona igual que el largo.
 */
export async function runInOrg<T>(
  orgId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  return tenantStorage.run({ orgId }, async () => fn());
}

/**
 * Ejecuta `fn` **sin filtrar por organización**.
 *
 * Es un agujero deliberado en el aislamiento, y hay exactamente cuatro sitios
 * donde es correcto usarlo: los que tienen que averiguar de qué empresa es algo
 * *antes* de saberlo. Todos están enumerados en ARCHITECTURE-MULTITENANT.md §5.
 *
 * Existe como función con nombre feo, y no como "se me olvidó filtrar", para
 * que salte a la vista en una revisión de código.
 */
export async function runUnscoped<T>(
  motivo: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  void motivo; // documenta la llamada; no se usa en tiempo de ejecución
  return tenantStorage.run({ orgId: null, unscoped: true }, async () => fn());
}

export function isUnscoped(): boolean {
  return tenantStorage.getStore()?.unscoped === true;
}
