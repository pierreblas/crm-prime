import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  assignSourcesSchema,
  createSourceSchema,
  createUserSchema,
  setContactSourceSchema,
  updateSourceSchema,
  updateUserSchema,
  Role,
  type AssignSourcesInput,
  type CreateSourceInput,
  type CreateUserInput,
  type SetContactSourceInput,
  type UpdateSourceInput,
  type UpdateUserInput,
  type AccessTokenClaims,
  type PasswordResetLink,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SourceService } from "./source.service";
import { PasswordResetService } from "../auth/password-reset.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class SourcesController {
  constructor(
    private readonly sources: SourceService,
    private readonly passwordResets: PasswordResetService,
  ) {}

  // ── Fuentes ────────────────────────────────────────────────
  @Get("sources")
  list() {
    return this.sources.list();
  }

  @Post("sources")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  create(
    @Body(new ZodValidationPipe(createSourceSchema)) body: CreateSourceInput,
  ) {
    return this.sources.create(body);
  }

  @Patch("sources/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSourceSchema)) body: UpdateSourceInput,
  ) {
    return this.sources.update(id, body);
  }

  @Delete("sources/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param("id") id: string) {
    return this.sources.remove(id);
  }

  // ── Vendedores ─────────────────────────────────────────────
  @Get("sellers")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  sellers() {
    return this.sources.listSellers();
  }

  @Patch("sellers/:id/sources")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  assign(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignSourcesSchema)) body: AssignSourcesInput,
  ) {
    return this.sources.assignSources(id, body.sourceIds);
  }

  // ── Gestión de usuarios del equipo (admin) ─────────────────
  @Post("users")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  createUser(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ) {
    return this.sources.createUser(body);
  }

  @Patch("users/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  updateUser(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
  ) {
    return this.sources.updateUser(id, body, user.sub);
  }

  /**
   * Enlace de 24 horas para que alguien del equipo elija contraseña nueva. El
   * administrador se lo manda por WhatsApp; no necesita correo del sistema.
   */
  @Post("users/:id/password-reset-link")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  passwordResetLink(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
  ): Promise<PasswordResetLink> {
    return this.passwordResets.linkForTeamMember(id, user.sub);
  }

  // ── Fuente de un contacto ──────────────────────────────────
  @Post("contacts/source")
  setContactSource(
    @Body(new ZodValidationPipe(setContactSourceSchema))
    body: SetContactSourceInput,
  ) {
    return this.sources.setContactSource(body.contactId, body.sourceId);
  }
}
