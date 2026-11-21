import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  applyImproveSchema,
  draftCaseFromChatSchema,
  Role,
  saveAgentTestCaseSchema,
  startImproveRunSchema,
  updateAgentTestCaseSchema,
  type ApplyImproveInput,
  type DraftCaseFromChatInput,
  type SaveAgentTestCaseInput,
  type StartImproveRunInput,
  type UpdateAgentTestCaseInput,
} from "@crm/shared";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AgentImproveService } from "./agent-improve.service";

/**
 * «Mejorar agente»: la batería de casos de un agente, sus mediciones y las
 * versiones anteriores de sus instrucciones. Solo administradores: gasta
 * tokens y, al aplicar una propuesta, cambia cómo atiende el agente.
 */
@Controller("bots/:botId/improve")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AgentImproveController {
  constructor(private readonly improve: AgentImproveService) {}

  @Get()
  overview(@Param("botId") botId: string) {
    return this.improve.overview(botId);
  }

  // ── Casos de prueba ──
  @Post("cases")
  createCase(@Param("botId") botId: string, @Body(new ZodValidationPipe(saveAgentTestCaseSchema)) body: SaveAgentTestCaseInput) {
    return this.improve.createCase(botId, body);
  }

  /** El borrador de un caso a partir de un chat real: no guarda nada, lo revisa el dueño. */
  @Post("cases/draft")
  draftCase(@Param("botId") botId: string, @Body(new ZodValidationPipe(draftCaseFromChatSchema)) body: DraftCaseFromChatInput) {
    return this.improve.draftCaseFromChat(botId, body.conversationId);
  }

  @Patch("cases/:caseId")
  updateCase(
    @Param("botId") botId: string,
    @Param("caseId") caseId: string,
    @Body(new ZodValidationPipe(updateAgentTestCaseSchema)) body: UpdateAgentTestCaseInput,
  ) {
    return this.improve.updateCase(botId, caseId, body);
  }

  @Delete("cases/:caseId")
  deleteCase(@Param("botId") botId: string, @Param("caseId") caseId: string) {
    return this.improve.deleteCase(botId, caseId);
  }

  // ── Mediciones ──
  @Post("runs")
  start(@Param("botId") botId: string, @Body(new ZodValidationPipe(startImproveRunSchema)) body: StartImproveRunInput) {
    return this.improve.start(botId, body);
  }

  @Get("runs/:runId")
  run(@Param("botId") botId: string, @Param("runId") runId: string) {
    return this.improve.run(botId, runId);
  }

  @Get("runs/:runId/results")
  results(
    @Param("botId") botId: string,
    @Param("runId") runId: string,
    @Query("variant", ParseIntPipe) variant: number,
    @Query("caseId") caseId?: string,
  ) {
    return this.improve.results(botId, runId, variant, caseId || undefined);
  }

  @Post("runs/:runId/cancel")
  cancel(@Param("botId") botId: string, @Param("runId") runId: string) {
    return this.improve.cancelRun(botId, runId);
  }

  @Post("runs/:runId/apply")
  apply(@Param("botId") botId: string, @Param("runId") runId: string, @Body(new ZodValidationPipe(applyImproveSchema)) body: ApplyImproveInput) {
    return this.improve.apply(botId, runId, body);
  }

  // ── Versiones anteriores de las instrucciones ──
  @Post("versions/:versionId/restore")
  restore(@Param("botId") botId: string, @Param("versionId") versionId: string) {
    return this.improve.restore(botId, versionId);
  }
}
