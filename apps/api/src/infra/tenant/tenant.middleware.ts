import { Injectable, NestMiddleware, RequestMethod } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { tenantStorage } from "./tenant.context";

/**
 * Dónde se aplica. Nest le antepone el prefijo global (/api/v1), así que las
 * rutas que quedan fuera de él —la API pública, /api/public/v1— NO pasan por
 * aquí: para ellas abre el contexto `TenantInterceptor`.
 */
export const TENANT_MIDDLEWARE_ROUTES = { path: "*", method: RequestMethod.ALL };

/**
 * Abre el contenedor de contexto al principio de cada petición.
 *
 * Va vacío: en este punto los guardias todavía no han corrido, así que no se
 * sabe quién llama. Lo rellena `TenantInterceptor` un paso después, mutando
 * **este mismo objeto**.
 *
 * Abrirlo aquí, y no solo en el interceptor, hace que el contexto envuelva
 * toda la petición: también los guardias y los filtros de excepción.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    tenantStorage.run({ orgId: null }, () => next());
  }
}
