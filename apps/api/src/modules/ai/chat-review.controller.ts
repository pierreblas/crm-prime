import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  Role,
  runChatReviewSchema,
  updateChatReviewSettingsSchema,
  type RunChatReviewInput,
  updateConversationReviewSchema,
  type UpdateChatReviewSettingsInput,
  type UpdateConversationReviewInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ChatReviewService } from "./chat-review.service";

/** Revisión de las conversaciones que atendió la IA (solo admin: gasta tokens y ve todos los chats). */
@Controller("chat-reviews")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ChatReviewController {
  constructor(private readonly reviews: ChatReviewService) {}

  @Get()
  overview(@Query("status") status?: string) {
    return this.reviews.overview(status === "all" ? "all" : "open");
  }

  /** «Revisar ahora»: corre en segundo plano; el panel ve el avance en el resumen. */
  @Post("run")
  run(@Body(new ZodValidationPipe(runChatReviewSchema)) body: RunChatReviewInput) {
    return this.reviews.start(body.days);
  }

  @Patch("settings")
  settings(@Body(new ZodValidationPipe(updateChatReviewSettingsSchema)) body: UpdateChatReviewSettingsInput) {
    return this.reviews.setEnabled(body.enabled);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateConversationReviewSchema)) body: UpdateConversationReviewInput) {
    return this.reviews.setStatus(id, body.status);
  }
}
