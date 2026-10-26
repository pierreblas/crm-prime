import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import {
  Role,
  loginSchema,
  updatePlatformOrgSchema,
  updatePlatformFeedbackSchema,
  feedbackKinds,
  feedbackStatuses,
  type AuthTokens,
  type FeedbackKind,
  type FeedbackStatus,
  type PlatformFeedback,
  type PlatformFeedbackList,
  type UpdatePlatformFeedbackInput,
  type LoginInput,
  type PlatformAuditEntry,
  type PlatformHealth,
  type PlatformLoginAsResult,
  type PlatformOrg,
  type PlatformOrgDetail,
  type PlatformOverview,
  type UpdatePlatformOrgInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { verifyPlatformAdmin } from "../../common/utils/platform-admin";
import { PlatformAdminGuard, type PlatformClaims } from "./platform-admin.guard";
import { PlatformService } from "./platform.service";

/** Doce horas: al caducar se vuelve a entrar. La cuenta maestra no se renueva sola. */
const TTL_SECONDS = 12 * 60 * 60;

/** Intentos fallidos por IP antes de bloquear un rato. */
const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60_000;

/** Consola del operador del SaaS: todas las empresas, altas, planes. */
@Controller("platform")
export class PlatformController {
  private fails = new Map<string, { n: number; since: number }>();

  constructor(
    private readonly platform: PlatformService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Entrada de la cuenta maestra (admin.<dominio>). Devuelve la misma forma
   * que el login normal para que la web la trate igual, pero el token es de
   * plataforma: sin empresa, sin sesión en la base y sin renovación.
   */
  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
  ): Promise<AuthTokens> {
    const key = req.ip ?? "?";
    const f = this.fails.get(key);
    if (f && Date.now() - f.since < WINDOW_MS && f.n >= MAX_FAILS) {
      throw new UnauthorizedException("Demasiados intentos. Espera unos minutos.");
    }

    const email = body.email.trim().toLowerCase();
    if (!(await verifyPlatformAdmin(email, body.password))) {
      const cur = f && Date.now() - f.since < WINDOW_MS ? f : { n: 0, since: Date.now() };
      this.fails.set(key, { n: cur.n + 1, since: cur.since });
      throw new UnauthorizedException("Credenciales inválidas");
    }
    this.fails.delete(key);

    const claims: PlatformClaims = { sub: "platform", email, purpose: "platform" };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: process.env.JWT_ACCESS_SECRET ?? "dev-secret",
      expiresIn: TTL_SECONDS,
    });
    return {
      accessToken,
      refreshToken: "",
      expiresIn: TTL_SECONDS,
      user: { id: "platform", email, name: "Operador", role: Role.ADMIN, platformAdmin: true },
    };
  }

  /** Correo de la cuenta maestra que hace la petición (lo deja el guard). */
  private actor(req: Request): string {
    return (req as unknown as { platformClaims?: PlatformClaims }).platformClaims?.email ?? "?";
  }

  @Get("overview")
  @UseGuards(PlatformAdminGuard)
  overview(): Promise<PlatformOverview> {
    return this.platform.overview();
  }

  @Get("health")
  @UseGuards(PlatformAdminGuard)
  health(): Promise<PlatformHealth> {
    return this.platform.health();
  }

  @Get("audit")
  @UseGuards(PlatformAdminGuard)
  audit(@Query("limit") limit?: string): Promise<PlatformAuditEntry[]> {
    const n = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.platform.auditList(n);
  }

  @Get("feedback")
  @UseGuards(PlatformAdminGuard)
  feedback(@Query("kind") kind?: string, @Query("status") status?: string): Promise<PlatformFeedbackList> {
    return this.platform.feedbackList({
      kind: (feedbackKinds as readonly string[]).includes(kind ?? "") ? (kind as FeedbackKind) : undefined,
      status: status === "open" || (feedbackStatuses as readonly string[]).includes(status ?? "") ? (status as FeedbackStatus | "open") : undefined,
    });
  }

  @Patch("feedback/:id")
  @UseGuards(PlatformAdminGuard)
  updateFeedback(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlatformFeedbackSchema)) body: UpdatePlatformFeedbackInput,
  ): Promise<PlatformFeedback> {
    return this.platform.updateFeedback(id, body.status);
  }

  @Get("orgs/:id")
  @UseGuards(PlatformAdminGuard)
  detail(@Param("id") id: string): Promise<PlatformOrgDetail> {
    return this.platform.detail(id);
  }

  @Post("orgs/:id/login-as")
  @UseGuards(PlatformAdminGuard)
  @HttpCode(200)
  loginAs(@Param("id") id: string, @Req() req: Request): Promise<PlatformLoginAsResult> {
    return this.platform.loginAs(id, this.actor(req));
  }

  @Get("orgs")
  @UseGuards(PlatformAdminGuard)
  orgs(@Query("search") search?: string): Promise<PlatformOrg[]> {
    return this.platform.orgs(search ?? "");
  }

  @Patch("orgs/:id")
  @UseGuards(PlatformAdminGuard)
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlatformOrgSchema)) body: UpdatePlatformOrgInput,
    @Req() req: Request,
  ): Promise<PlatformOrg> {
    return this.platform.update(id, body, this.actor(req));
  }
}
