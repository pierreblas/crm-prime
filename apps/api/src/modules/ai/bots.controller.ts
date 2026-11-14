import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  createBotSchema,
  updateBotSchema,
  playgroundRequestSchema,
  simulateTurnRequestSchema,
  type SimulateTurnRequest,
  promptAssistantRequestSchema,
  Role,
  type CreateBotInput,
  type UpdateBotInput,
  type PlaygroundRequest,
  type PromptAssistantRequest,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { BotService } from "./bot.service";
import { AgentService } from "./agent.service";
import { PromptAssistantService } from "./prompt-assistant.service";
import { OnboardingService } from "../onboarding/onboarding.service";

@Controller("bots")
@UseGuards(JwtAuthGuard)
export class BotsController {
  constructor(
    private readonly bots: BotService,
    private readonly agent: AgentService,
    private readonly promptAssistant: PromptAssistantService,
    private readonly onboarding: OnboardingService,
  ) {}

  @Get()
  list() {
    return this.bots.list();
  }

  // Playground: probar el agente sin enviar nada (solo admin).
  @Post("playground")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  playground(
    @Body(new ZodValidationPipe(playgroundRequestSchema))
    body: PlaygroundRequest,
  ) {
    // Probar el agente es un paso de Primeros pasos que no se deduce de
    // los datos (el simulador no persiste nada), así que se marca aquí.
    void this.onboarding.markDone("try_agent");
    return this.agent.playground(body);
  }

  // Simulador: un paso de una conversación con un cliente de mentira (solo admin).
  @Post("simulate/turn")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  simulateTurn(
    @Body(new ZodValidationPipe(simulateTurnRequestSchema))
    body: SimulateTurnRequest,
  ) {
    void this.onboarding.markDone("try_agent");
    return this.agent.simulateTurn(body);
  }

  // Asistente de redacción: propone instrucciones o mensajes; no guarda nada.
  @Post("prompt-assistant")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  promptAssist(
    @Body(new ZodValidationPipe(promptAssistantRequestSchema))
    body: PromptAssistantRequest,
  ) {
    return this.promptAssistant.run(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.bots.getById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  create(
    @Body(new ZodValidationPipe(createBotSchema)) body: CreateBotInput,
  ) {
    return this.bots.create(body);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBotSchema)) body: UpdateBotInput,
  ) {
    return this.bots.update(id, body);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param("id") id: string) {
    return this.bots.remove(id);
  }
}
