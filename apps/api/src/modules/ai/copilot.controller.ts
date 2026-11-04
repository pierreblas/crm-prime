import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import {
  Role,
  adminCopilotRequestSchema,
  copilotAskSchema,
  copilotRewriteSchema,
  type AccessTokenClaims,
  type AdminCopilotReply,
  type AdminCopilotRequest,
  type AiStatus,
  type ContactMemory,
  type CopilotAskInput,
  type CopilotAskResult,
  type CopilotRewriteInput,
  type CopilotRewriteResult,
  type CopilotSummary,
} from "@crm/shared";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AdminCopilotService } from "./admin-copilot.service";
import { CopilotService } from "./copilot.service";

/** Copiloto del equipo. Lo usa cualquier usuario que atiende conversaciones. */
@Controller("ai")
@UseGuards(JwtAuthGuard)
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly adminCopilot: AdminCopilotService,
  ) {}

  /** ¿Hay IA con clave para esta empresa? Sin claves ni datos sensibles. */
  @Get("status")
  status(): Promise<AiStatus> {
    return this.copilot.status();
  }

  /** Copiloto del administrador: el chat de ayuda de toda la app. Solo lee. */
  @Post("admin-copilot")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  askAdmin(
    @Body(new ZodValidationPipe(adminCopilotRequestSchema)) body: AdminCopilotRequest,
    @CurrentUser() user: AccessTokenClaims,
  ): Promise<AdminCopilotReply> {
    return this.adminCopilot.ask(body, user.sub);
  }

  @Post("conversations/:id/rewrite")
  @HttpCode(200)
  rewrite(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(copilotRewriteSchema)) body: CopilotRewriteInput,
  ): Promise<CopilotRewriteResult> {
    return this.copilot.rewrite(id, body);
  }

  @Post("conversations/:id/summary")
  @HttpCode(200)
  summary(@Param("id") id: string): Promise<CopilotSummary> {
    return this.copilot.summary(id);
  }

  @Post("conversations/:id/ask")
  @HttpCode(200)
  ask(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(copilotAskSchema)) body: CopilotAskInput,
  ): Promise<CopilotAskResult> {
    return this.copilot.ask(id, body);
  }

  @Get("conversations/:id/memory")
  memory(@Param("id") id: string): Promise<ContactMemory> {
    return this.copilot.memoryFor(id);
  }

  @Post("conversations/:id/memory")
  @HttpCode(200)
  refreshMemory(@Param("id") id: string): Promise<ContactMemory> {
    return this.copilot.refreshMemory(id);
  }
}
