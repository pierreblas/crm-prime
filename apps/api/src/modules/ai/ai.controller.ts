import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  resolveActionsSchema,
  type AccessTokenClaims,
  type AiRunTrace,
  type ResolveActionsInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ConversationAccessGuard } from "../permissions/conversation-access.guard";
import { AgentActionsService } from "./agent-actions.service";
import { AgentService } from "./agent.service";
import { AiTraceService } from "./ai-trace.service";

// Como la mensajería: un vendedor solo pide la IA de las conversaciones de su
// alcance. Antes cualquiera de la empresa podía pedir una sugerencia (y ver la
// conversación a través de ella) con el id de una conversación ajena.
@Controller("conversations")
@UseGuards(JwtAuthGuard, ConversationAccessGuard)
export class AiController {
  constructor(
    private readonly agent: AgentService,
    private readonly actions: AgentActionsService,
    private readonly traces: AiTraceService,
  ) {}

  // Copilot: la IA redacta una sugerencia de respuesta (el humano la revisa).
  @Post(":id/ai/suggest")
  suggest(@Param("id") id: string) {
    return this.agent.suggest(id);
  }

  // «¿Por qué respondió esto?»: qué entendió, qué consultó y qué hizo la IA en esa respuesta.
  @Get(":id/ai/runs/:runId")
  trace(@Param("id") id: string, @Param("runId") runId: string): Promise<AiRunTrace> {
    return this.traces.trace(id, runId);
  }

  // Resuelve las acciones que la IA dejó pendientes en ese run: se aplican
  // cuando el humano envía la respuesta, o se descartan si la desecha.
  @Post(":id/ai/runs/:runId/actions")
  resolveActions(
    @Param("id") id: string,
    @Param("runId") runId: string,
    @Body(new ZodValidationPipe(resolveActionsSchema))
    body: ResolveActionsInput,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.actions.resolve(id, runId, body.approve, user.sub);
  }
}
