import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { bulkFlowSchema, type BulkFlowInput, type BulkFlowResult } from "@crm/shared";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { StageAutomationsService } from "./stage-automations.service";

/** Lanzar un flujo a varias oportunidades seleccionadas en el tablero (escalonado). */
@Controller("deals")
@UseGuards(JwtAuthGuard)
export class BulkFlowController {
  constructor(private readonly autos: StageAutomationsService) {}

  @Post("bulk-flow")
  @HttpCode(200)
  run(@Body(new ZodValidationPipe(bulkFlowSchema)) body: BulkFlowInput): Promise<BulkFlowResult> {
    return this.autos.queueFlowForDeals(body.ids, body.flowId);
  }
}
