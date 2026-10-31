import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import {
  businessSetupSchema,
  Role,
  type BusinessSetupInput,
  type BusinessSetupState,
  type SetupAgentResult,
  type SetupKnowledgeResult,
  type SetupProfileResult,
} from "@crm/shared";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { BusinessSetupService } from "./business-setup.service";

// Asistente de bienvenida: configura la empresa entera (agente, embudo,
// conocimiento), así que solo un administrador.
@Controller("onboarding/setup")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class BusinessSetupController {
  constructor(private readonly setup: BusinessSetupService) {}

  @Get()
  state(): Promise<BusinessSetupState> {
    return this.setup.state();
  }

  @Post("profile")
  profile(
    @Body(new ZodValidationPipe(businessSetupSchema)) body: BusinessSetupInput,
  ): Promise<SetupProfileResult> {
    return this.setup.saveProfile(body);
  }

  @Post("knowledge")
  knowledge(): Promise<SetupKnowledgeResult> {
    return this.setup.buildKnowledge();
  }

  @Post("agent")
  agent(): Promise<SetupAgentResult> {
    return this.setup.buildAgent();
  }
}
