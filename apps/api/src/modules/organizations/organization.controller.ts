import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  registerOrgSchema,
  signupCodeRequestSchema,
  type RegisterOrgInput,
  type SignupCodeRequest,
  type SignupCodeSent,
  type SignupOptions,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { tenancyMode } from "../../infra/tenant/tenant.context";
import { OrganizationService } from "./organization.service";
import { SignupVerificationService } from "./signup-verification.service";

/**
 * Alta y resolución de empresas.
 *
 * Sin `JwtAuthGuard` a propósito: en este proyecto los guardias se ponen por
 * ruta, y estas son públicas por necesidad — se usan antes de tener sesión. Es la única parte del CRM que vive **fuera**
 * de cualquier organización: son las rutas que se usan antes de pertenecer a
 * ninguna.
 *
 * Todo esto solo existe en modo SaaS. En la versión open source hay una sola
 * empresa y estas rutas devuelven 400, para no dejar abierto un alta que ahí no
 * significa nada.
 */
@ApiTags("Organizaciones")
@Controller("organizations")
export class OrganizationController {
  constructor(
    private readonly orgs: OrganizationService,
    private readonly verification: SignupVerificationService,
  ) {}

  private assertSaaS(): void {
    if (tenancyMode !== "multi") {
      throw new BadRequestException(
        "Esta instalación funciona con una sola empresa (TENANCY_MODE=single)",
      );
    }
  }

  /** Qué pide el alta: sin correo del sistema no hay código que confirmar. */
  @Get("signup-options")
  @ApiOperation({ summary: "Qué pasos tiene el alta en este servidor" })
  signupOptions(): SignupOptions {
    this.assertSaaS();
    return this.verification.options();
  }

  /** Manda el código para confirmar el correo del administrador antes de crear la empresa. */
  @Post("signup-code")
  @HttpCode(202)
  @ApiOperation({ summary: "Manda el código para confirmar el correo del alta" })
  signupCode(
    @Body(new ZodValidationPipe(signupCodeRequestSchema)) body: SignupCodeRequest,
  ): Promise<SignupCodeSent> {
    this.assertSaaS();
    return this.verification.request(body);
  }

  @Post("register")
  @ApiOperation({ summary: "Da de alta una empresa y su administrador" })
  register(
    @Body(new ZodValidationPipe(registerOrgSchema)) body: RegisterOrgInput,
    @Req() req: Request,
  ) {
    this.assertSaaS();
    return this.orgs.register(body, req.ip);
  }

  @Get("slug-available")
  @ApiOperation({ summary: "¿Está libre este subdominio?" })
  available(@Query("slug") slug: string) {
    this.assertSaaS();
    if (!slug?.trim()) throw new BadRequestException("Falta el subdominio");
    return this.orgs.slugDisponible(slug);
  }

  // Solo el nombre, para poder saludar en la pantalla de acceso. Nada más:
  // cualquiera puede llamar a esto probando subdominios.
  @Get(":slug/public")
  @ApiOperation({ summary: "Datos públicos de una empresa por su subdominio" })
  publicInfo(@Param("slug") slug: string) {
    this.assertSaaS();
    return this.orgs.publicInfo(slug);
  }
}
