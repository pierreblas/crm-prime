import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  Role,
  emailAccountInputSchema,
  emailTemplateInputSchema,
  sendEmailSchema,
  updateEmailAccountSchema,
  updateEmailTemplateSchema,
  type AccessTokenClaims,
  type EmailAccountInput,
  type EmailTemplateInput,
  type SendEmailInput,
  type UpdateEmailAccountInput,
  type UpdateEmailTemplateInput,
} from "@crm/shared";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { EmailAccountsService } from "./email-accounts.service";
import { EmailTemplatesService } from "./email-templates.service";
import { EmailService } from "./email.service";

/**
 * Correo. Todo el equipo escribe y usa las plantillas; conectar buzones, crear
 * plantillas y tocar la lista de bajas queda para quien administra.
 */
@Controller("email")
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailController {
  constructor(
    private readonly accounts: EmailAccountsService,
    private readonly templates: EmailTemplatesService,
    private readonly emails: EmailService,
  ) {}

  // ── Buzones ─────────────────────────────────────────────────
  @Get("accounts")
  listAccounts(@CurrentUser() user: AccessTokenClaims) {
    return this.accounts.list(user);
  }

  @Post("accounts")
  @Roles(Role.ADMIN)
  createAccount(@Body(new ZodValidationPipe(emailAccountInputSchema)) body: EmailAccountInput) {
    return this.accounts.create(body);
  }

  @Patch("accounts/:id")
  @Roles(Role.ADMIN)
  updateAccount(@Param("id") id: string, @Body(new ZodValidationPipe(updateEmailAccountSchema)) body: UpdateEmailAccountInput) {
    return this.accounts.update(id, body);
  }

  @Delete("accounts/:id")
  @Roles(Role.ADMIN)
  removeAccount(@Param("id") id: string) {
    return this.accounts.remove(id);
  }

  @Post("accounts/:id/test")
  @Roles(Role.ADMIN)
  testAccount(@Param("id") id: string) {
    return this.accounts.sendTest(id);
  }

  // ── Plantillas ──────────────────────────────────────────────
  @Get("templates")
  listTemplates() {
    return this.templates.list();
  }

  @Post("templates")
  @Roles(Role.ADMIN)
  createTemplate(@Body(new ZodValidationPipe(emailTemplateInputSchema)) body: EmailTemplateInput) {
    return this.templates.create(body);
  }

  @Patch("templates/:id")
  @Roles(Role.ADMIN)
  updateTemplate(@Param("id") id: string, @Body(new ZodValidationPipe(updateEmailTemplateSchema)) body: UpdateEmailTemplateInput) {
    return this.templates.update(id, body);
  }

  @Delete("templates/:id")
  @Roles(Role.ADMIN)
  removeTemplate(@Param("id") id: string) {
    return this.templates.remove(id);
  }

  // ── Escribir a un contacto ──────────────────────────────────
  @Get("contacts/:contactId/compose")
  compose(@Param("contactId") contactId: string, @CurrentUser() user: AccessTokenClaims) {
    return this.emails.compose(contactId, user);
  }

  @Get("contacts/:contactId")
  history(@Param("contactId") contactId: string, @CurrentUser() user: AccessTokenClaims) {
    return this.emails.history(contactId, user);
  }

  @Post("send")
  send(@Body(new ZodValidationPipe(sendEmailSchema)) body: SendEmailInput, @CurrentUser() user: AccessTokenClaims) {
    return this.emails.send(body, user);
  }

  // ── Bajas ───────────────────────────────────────────────────
  @Get("unsubscribes")
  @Roles(Role.ADMIN)
  unsubscribes() {
    return this.emails.unsubscribes();
  }

  @Delete("unsubscribes/:id")
  @Roles(Role.ADMIN)
  removeUnsubscribe(@Param("id") id: string) {
    return this.emails.removeUnsubscribe(id);
  }
}
