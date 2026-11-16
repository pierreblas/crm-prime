import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  loginSchema,
  handoffSchema,
  type HandoffInput,
  registerSchema,
  refreshSchema,
  logoutSchema,
  updateProfileSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  passwordResetCheckSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type PasswordResetCheck,
  type PasswordResetCheckInput,
  type PasswordResetDone,
  type PasswordResetOptions,
  type ResetPasswordInput,
  type LoginInput,
  type RegisterInput,
  type RefreshInput,
  type LogoutInput,
  type UpdateProfileInput,
  type ChangePasswordInput,
  type AccessTokenClaims,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { tenancyMode } from "../../infra/tenant/tenant.context";
import { hostDe, subdominioDe } from "../../common/utils/subdomain";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuthService } from "./auth.service";
import { PasswordResetService } from "./password-reset.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordResets: PasswordResetService,
  ) {}

  /**
   * Alta de usuario dentro de una empresa que ya existe.
   *
   * En modo SaaS esto se cierra: si estuviera abierto, cualquiera que supiera
   * el subdominio de una empresa podría crearse una cuenta dentro. Los usuarios
   * entran por invitación de quien administra, no por formulario público.
   *
   * Antes devolvía un 500 ("no hay organización en contexto") porque fallaba
   * más abajo. Fallar cerrado estaba bien; no explicar por qué, no.
   */
  @Post("register")
  @HttpCode(201)
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ) {
    if (tenancyMode === "multi") {
      throw new ForbiddenException(
        "El registro público está desactivado. Pide a quien administra tu empresa que te invite, o crea una empresa nueva.",
      );
    }
    return this.auth.register(body);
  }

  @Post("login")
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
  ) {
    // De dónde sale el subdominio, por orden:
    //
    // 1. Del cuerpo, que es lo normal: la petición llega desde el servidor de
    //    Next (patrón BFF), así que el `Host` que vemos aquí es el suyo, no el
    //    del navegador. Quien conoce el subdominio real es el middleware de
    //    Next, y lo manda explícito.
    // 2. Del `Host`, para quien llame directo a la API (una app móvil contra
    //    `acme.driony.com`).
    //
    // Aceptarlo del cuerpo es seguro porque **solo elige a quién buscar**. Sin
    // la contraseña no se entra, y el `orgId` del token sale de la fila del
    // usuario. Pedir que te busquen en otra empresa no te da nada.
    const orgSlug = body.orgSlug ?? subdominioDe(hostDe(req.headers));

    return this.auth.login({ ...body, orgSlug }, {
      platform: body.platform,
      deviceName: body.deviceName,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
  }

  // Canjea el pase que devolvió el alta de empresa. Público por necesidad:
  // quien lo trae todavía no tiene sesión.
  @Post("handoff")
  @HttpCode(200)
  handoff(
    @Body(new ZodValidationPipe(handoffSchema)) body: HandoffInput,
    @Req() req: Request,
  ) {
    return this.auth.redeemHandoff(body.token, {
      platform: body.platform,
      deviceName: body.deviceName,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
  }

  // ── Recuperar la contraseña (público: quien lo usa no puede entrar) ──
  /** Qué caminos hay: sin correo del sistema, la pantalla manda a pedírselo al administrador. */
  @Get("password/options")
  passwordOptions(): PasswordResetOptions {
    return this.passwordResets.options();
  }

  /** «¿Olvidaste tu contraseña?». Responde lo mismo exista o no la cuenta. */
  @Post("password/forgot")
  @HttpCode(202)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    // El subdominio, como en el login: del cuerpo (lo pone la web) o del Host.
    const orgSlug = body.orgSlug ?? subdominioDe(hostDe(req.headers));
    await this.passwordResets.requestByEmail({ ...body, orgSlug });
    return { ok: true };
  }

  /** El token va en el cuerpo y no en la URL: así no queda en los registros del proxy. */
  @Post("password/check")
  @HttpCode(200)
  checkPasswordReset(
    @Body(new ZodValidationPipe(passwordResetCheckSchema)) body: PasswordResetCheckInput,
  ): Promise<PasswordResetCheck> {
    return this.passwordResets.check(body.token);
  }

  @Post("password/reset")
  @HttpCode(200)
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
  ): Promise<PasswordResetDone> {
    return this.passwordResets.reset(body.token, body.password, body.locale);
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(logoutSchema)) body: LogoutInput,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  // ── Perfil de la cuenta ────────────────────────────────────
  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AccessTokenClaims) {
    return this.auth.getMe(user.sub);
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  updateProfile(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.auth.updateProfile(user.sub, body.name);
  }

  @Post("change-password")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(
      user.sub,
      body.currentPassword,
      body.newPassword,
      user.sid,
    );
  }

  @Get("sessions")
  @UseGuards(JwtAuthGuard)
  sessions(@CurrentUser() user: AccessTokenClaims) {
    return this.auth.listSessions(user.sub, user.sid);
  }

  // Cierra todas las demás sesiones (deja viva solo la actual).
  @Delete("sessions")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async revokeOtherSessions(
    @CurrentUser() user: AccessTokenClaims,
  ): Promise<void> {
    await this.auth.revokeOtherSessions(user.sub, user.sid);
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async revokeSession(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
  ): Promise<void> {
    await this.auth.revokeUserSession(user.sub, id);
  }

  @Get("realtime-token")
  @UseGuards(JwtAuthGuard)
  async realtimeToken(@CurrentUser() user: AccessTokenClaims) {
    return { token: await this.auth.issueRealtimeToken(user) };
  }
}
