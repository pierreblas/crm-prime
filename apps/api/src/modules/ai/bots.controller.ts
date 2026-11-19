import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  createBotSchema,
  updateBotSchema,
  playgroundRequestSchema,
  simulateReviewRequestSchema,
  simulateTurnRequestSchema,
  type SimulateReviewRequest,
  type SimulateTurnRequest,
  promptAssistantRequestSchema,
  ASSISTANT_AUDIO_MAX_BYTES,
  type AssistantTranscript,
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
import { MediaUnderstandingService } from "./media-understanding.service";

@Controller("bots")
@UseGuards(JwtAuthGuard)
export class BotsController {
  constructor(
    private readonly bots: BotService,
    private readonly agent: AgentService,
    private readonly promptAssistant: PromptAssistantService,
    private readonly onboarding: OnboardingService,
    private readonly media: MediaUnderstandingService,
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

  // Simulador: la revisión de una conversación terminada (solo admin).
  @Post("simulate/review")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  simulateReview(
    @Body(new ZodValidationPipe(simulateReviewRequestSchema))
    body: SimulateReviewRequest,
  ) {
    return this.agent.reviewSimulation(body);
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

  // Una nota de voz de quien arma el agente, en texto: la revisa y la envía él.
  // Cuenta como «Asistente de redacción». No se guarda el audio.
  @Post("transcribe")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: ASSISTANT_AUDIO_MAX_BYTES } }))
  async transcribe(@UploadedFile() file?: Express.Multer.File): Promise<AssistantTranscript> {
    if (!file?.size) throw new BadRequestException("No llegó ningún audio. Vuelve a grabarlo o elige otro archivo.");
    if (!/^(audio|video)\//.test(file.mimetype)) {
      throw new BadRequestException("Ese archivo no es un audio. Sube una nota de voz (por ejemplo, la de WhatsApp) o un MP3.");
    }
    let result: Awaited<ReturnType<MediaUnderstandingService["transcribeForAssistant"]>>;
    try {
      result = await this.media.transcribeForAssistant({
        buffer: file.buffer,
        mimeType: file.mimetype,
        size: file.size,
        fileName: file.originalname,
      });
    } catch {
      throw new ServiceUnavailableException("No pudimos pasar el audio a texto ahora mismo. Inténtalo de nuevo en un momento.");
    }
    if ("text" in result) return { text: result.text };
    if (result.error === "no_ai") {
      throw new ServiceUnavailableException(
        "Para pasar audios a texto hace falta IA: añade una clave de OpenAI en Ajustes › IA, o revisa si te queda cupo de la IA de Driony.",
      );
    }
    if (result.error === "silent") throw new BadRequestException("No se oye a nadie hablar en ese audio. Prueba a grabarlo otra vez, más cerca del micrófono.");
    throw new BadRequestException("No pudimos leer ese audio. Prueba con otro formato (MP3, M4A, OGG) o grábalo aquí mismo.");
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
