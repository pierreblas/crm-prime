import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import type { StageAutomationApplyResult, StageAutomationExisting } from "@crm/shared";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { StageAutomationsService } from "./stage-automations.service";

/**
 * Aplicar una automatización de «entra a la etapa» a las oportunidades que ya
 * estaban en ella antes de crearla. Primero se consulta a cuántas afectaría.
 */
@Controller("stage-automations")
@UseGuards(JwtAuthGuard)
export class StageAutomationOpsController {
  constructor(private readonly autos: StageAutomationsService) {}

  @Get(":id/existing")
  existing(@Param("id") id: string): Promise<StageAutomationExisting> {
    return this.autos.previewExisting(id);
  }

  @Post(":id/apply-existing")
  @HttpCode(200)
  apply(@Param("id") id: string): Promise<StageAutomationApplyResult> {
    return this.autos.applyExisting(id);
  }
}
