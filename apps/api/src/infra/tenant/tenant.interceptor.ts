import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tenantStorage } from "./tenant.context";

/**
 * Escribe la organización de la petición en el contexto que abrió
 * `TenantMiddleware`, para que la extensión de Prisma filtre sin que ningún
 * servicio tenga que acordarse.
 *
 * Va como interceptor y no como middleware porque necesita leer lo que dejan
 * los guardias (`req.user` del JWT, `req.apiKey` de la clave de API), y los
 * guardias corren después del middleware y antes del interceptor.
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
    if (context.getType() === "http") {
      const req = context.switchToHttp().getRequest<{
        user?: { org?: string; sub?: string };
        apiKey?: { orgId?: string; id?: string } | null;
      }>();

      const orgId = req.user?.org ?? req.apiKey?.orgId ?? null;
      const store = tenantStorage.getStore();
      if (orgId && store) store.orgId = orgId;
      // Autor de los cambios para el historial de oportunidades.
      if (store) store.actor = req.user?.sub ? `user:${req.user.sub}` : req.apiKey ? `api:${req.apiKey.id ?? ""}` : store.actor;
    }
    return next.handle();
  }
}
