import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createManualCallSchema,
  updateCallSchema,
  Role,
  type AccessTokenClaims,
  type CreateManualCallInput,
  type UpdateCallInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CallsService } from "./calls.service";

@Controller("calls")
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  // ¿Hay llamadas desde el CRM en esta empresa?
  @Get("config")
  config() {
    return this.calls.config();
  }

  // Token del softphone del navegador.
  @Post("token")
  token(@CurrentUser() user: AccessTokenClaims) {
    return this.calls.token(user.sub);
  }

  // Deja Twilio apuntando a Driony (TwiML App + URL de voz del número).
  @Post("provision")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  provision() {
    return this.calls.provision();
  }

  // Llamadas de una conversación o de un contacto.
  @Get()
  list(@Query("conversationId") conversationId?: string, @Query("contactId") contactId?: string) {
    return this.calls.list({ conversationId: conversationId || undefined, contactId: contactId || undefined });
  }

  // Registrar a mano una llamada hecha fuera del CRM.
  @Post()
  logManual(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createManualCallSchema)) body: CreateManualCallInput,
  ) {
    return this.calls.logManual(user.sub, body);
  }

  // Resultado y nota (id nuestro o CallSid de Twilio).
  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateCallSchema)) body: UpdateCallInput) {
    return this.calls.update(id, body);
  }
}
