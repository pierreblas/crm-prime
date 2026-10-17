import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { isPlatformAdmin } from "../../common/utils/platform-admin";
import { tenancyMode } from "../../infra/tenant/tenant.context";

/** Lo que lleva el token de la cuenta maestra. */
export interface PlatformClaims {
  sub: "platform";
  email: string;
  purpose: "platform";
}

/**
 * Solo la cuenta maestra (admin.<dominio>).
 *
 * Su token no es el de un usuario: no tiene sesión en la base ni empresa, así
 * que no pasa por JwtAuthGuard. Se comprueba la firma, el propósito y que el
 * correo siga siendo el de PLATFORM_ADMIN_EMAIL: cambiarlo en el servidor
 * deja fuera al instante a quien tuviera un token viejo.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (tenancyMode !== "multi") {
      throw new ForbiddenException("La consola de plataforma solo existe en modo SaaS");
    }
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw this.expired();

    let claims: PlatformClaims;
    try {
      claims = await this.jwt.verifyAsync<PlatformClaims>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-secret",
      });
    } catch {
      throw this.expired();
    }
    if (claims.purpose !== "platform" || !isPlatformAdmin(claims.email)) {
      throw new ForbiddenException("Solo la cuenta maestra de la plataforma puede entrar aquí");
    }
    // Quién actúa: lo lee el controlador para el diario del operador.
    (req as { platformClaims?: PlatformClaims }).platformClaims = claims;
    return true;
  }

  // Mismo formato que JwtAuthGuard: la web cierra la sesión y vuelve al login.
  private expired(): UnauthorizedException {
    return new UnauthorizedException({
      statusCode: 401,
      message: "Tu sesión expiró. Vuelve a iniciar sesión.",
      code: "SESSION_EXPIRED",
    });
  }
}
