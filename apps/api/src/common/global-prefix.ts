import { RequestMethod } from "@nestjs/common";

/** Versionado de la API interna: todo cuelga de /api/v1. */
export const GLOBAL_PREFIX = "api/v1";

/**
 * La API pública queda fuera del prefijo: lleva su propia versión en la ruta
 * (/api/public/v1) para poder evolucionar sin arrastrar la interna.
 *
 * Ojo: Nest antepone el prefijo también a los middlewares de `forRoutes("*")`,
 * así que a estas rutas no les llega `TenantMiddleware`. El contexto de empresa
 * lo abre entonces `TenantInterceptor` (probado en rls.test.ts por HTTP).
 */
export const GLOBAL_PREFIX_OPTIONS = {
  exclude: [{ path: "api/public/v1/(.*)", method: RequestMethod.ALL }],
};
