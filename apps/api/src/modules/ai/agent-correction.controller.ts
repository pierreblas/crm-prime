import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  applyCorrectionSchema,
  measureCorrectionSchema,
  Role,
  startCorrectionSchema,
  type ApplyCorrectionInput,
  type MeasureCorrectionInput,
  type StartCorrectionInput,
} from "@crm/shared";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AgentCorrectionService } from "./agent-correction.service";

/**
 * «Corregir al agente» con los chats revisados. Solo administradores: gasta
 * tokens, ve los chats y, al aplicar, cambia cómo atiende el agente.
 */
@Controller("bots/:botId/corrections")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AgentCorrectionController {
  constructor(private readonly corrections: AgentCorrectionService) {}

  /** Corre en segundo plano: la ventana pregunta por el avance. */
  @Post()
  start(@Param("botId") botId: string, @Body(new ZodValidationPipe(startCorrectionSchema)) body: StartCorrectionInput) {
    return this.corrections.start(botId, body);
  }

  @Get(":id")
  get(@Param("botId") botId: string, @Param("id") id: string) {
    return this.corrections.get(botId, id);
  }

  @Post(":id/apply")
  apply(@Param("botId") botId: string, @Param("id") id: string, @Body(new ZodValidationPipe(applyCorrectionSchema)) body: ApplyCorrectionInput) {
    return this.corrections.apply(botId, id, body);
  }

  @Post(":id/discard")
  discard(@Param("botId") botId: string, @Param("id") id: string) {
    return this.corrections.discard(botId, id);
  }

  @Post(":id/measure")
  measure(@Param("botId") botId: string, @Param("id") id: string, @Body(new ZodValidationPipe(measureCorrectionSchema)) body: MeasureCorrectionInput) {
    return this.corrections.measure(botId, id, body);
  }
}
