import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { AccessTokenClaims } from "@crm/shared";
import { runInOrg } from "../../infra/tenant/tenant.context";
import { PermissionsService } from "./permissions.service";

/**
 * Un vendedor solo toca las conversaciones de su alcance.
 *
 * Va en el controlador de mensajería entero: mira si la petición apunta a una
 * conversación (`/conversations/:id/...`, `body.conversationId`) o a un
 * mensaje (`body.messageId`) y comprueba que entra en el alcance del usuario.
 * Las rutas sin conversación (el listado) pasan; el listado se acota solo.
 *
 * Corre antes del interceptor que fija la empresa, así que entra en ella con
 * la del token: es la misma que usará el resto de la petición.
 */
@Injectable()
export class ConversationAccessGuard implements CanActivate {
  constructor(private readonly perms: PermissionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      user?: AccessTokenClaims;
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      route?: { path?: string };
    }>();
    const user = req.user;
    if (!user || user.role === "ADMIN") return true;

    const path = req.route?.path ?? "";
    const id = req.params?.id;
    const body = req.body ?? {};
    await runInOrg(user.org, async () => {
      if (id && /conversations\/:id/.test(path)) return this.perms.assertConversation(user.sub, id);
      if (typeof body.conversationId === "string") return this.perms.assertConversation(user.sub, body.conversationId);
      if (typeof body.messageId === "string") return this.perms.assertMessageConversation(user.sub, body.messageId);
    });
    return true;
  }
}
