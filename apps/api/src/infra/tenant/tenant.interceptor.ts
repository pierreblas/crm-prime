import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tenantStorage, type TenantStore } from "./tenant.context";

/**
 * Escribe la organización de la petición en el contexto que abrió
 * `TenantMiddleware`, para que la extensión de Prisma filtre sin que ningún
 * servicio tenga que acordarse.
 *
 * Va como interceptor y no como middleware porque necesita leer lo que dejan
 * los guardias (`req.user` del JWT, `req.apiKey` de la clave de API), y los
 * guardias corren después del middleware y antes del interceptor.
 *
 * Si no hay contexto, lo abre aquí. Le pasa a la API pública
 * (/api/public/v1): queda fuera del prefijo global y Nest no le aplica el
 * middleware. Hasta el 2026-11-16 eso dejaba toda la API pública sin empresa
 * en la nube (500 en cada consulta). La suscripción corre dentro de `run()`,
 * así que el handler y lo que encadene heredan el contexto.
 *
 * **La regla que no se puede romper:** el `orgId` sale del token firmado o de
 * la clave de API, nunca del `Host` ni de una cabecera. El subdominio sirve
 * para *enseñar* la pantalla de acceso correcta; quién eres lo dice la firma.
 * Si se confiara en el Host, cambiar una cabecera bastaría para leer los datos
 * de otra empresa.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const req = context.switchToHttp().getRequest<{
      user?: { org?: string; sub?: string };
      apiKey?: { orgId?: string; id?: string } | null;
    }>();
    const orgId = req.user?.org ?? req.apiKey?.orgId ?? null;
    // Autor de los cambios para el historial de oportunidades.
    const actor = req.user?.sub ? `user:${req.user.sub}` : req.apiKey ? `api:${req.apiKey.id ?? ""}` : undefined;

    const store = tenantStorage.getStore();
    if (store) {
      if (orgId) store.orgId = orgId;
      if (actor) store.actor = actor;
      return next.handle();
    }

    const fresh: TenantStore = { orgId, ...(actor ? { actor } : {}) };
    return new Observable((subscriber) => tenantStorage.run(fresh, () => next.handle().subscribe(subscriber)));
  }
}
