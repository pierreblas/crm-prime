import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  assignConversationSchema,
  conversationsQuerySchema,
  createNoteSchema,
  reactMessageSchema,
  sendInteractiveSchema,
  sendMessageSchema,
  sendTemplateMessageSchema,
  setAiModeSchema,
  setStatusSchema,
  MessageAuthor,
  type AssignConversationInput,
  type AccessTokenClaims,
  type CreateNoteInput,
  type ReactMessageInput,
  type SendInteractiveInput,
  type SendMessageInput,
  type SendTemplateMessageInput,
  type SetAiModeInput,
  type SetStatusInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { MessagingService } from "./messaging.service";
import { ConversationAccessGuard } from "../permissions/conversation-access.guard";
import { PermissionsService } from "../permissions/permissions.service";
import { maskPhone } from "@crm/shared";

@Controller()
@UseGuards(JwtAuthGuard, ConversationAccessGuard)
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly perms: PermissionsService,
  ) {}

  @Get("conversations")
  async listConversations(
    @CurrentUser() user: AccessTokenClaims,
    @Query("filter") filter?: string,
    @Query("reply") reply?: string,
    @Query("status") status?: string,
    @Query("tags") tags?: string,
    @Query("sourceId") sourceId?: string,
    @Query("agentId") agentId?: string,
    @Query("channelId") channelId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("q") q?: string,
  ) {
    // Parámetros vacíos cuentan como ausentes; las etiquetas van separadas por coma.
    const nz = (v?: string) => (v && v.trim() ? v.trim() : undefined);
    const parsed = conversationsQuerySchema.safeParse({
      filter,
      reply,
      status: nz(status),
      tags: nz(tags)?.split(",").map((x) => x.trim()).filter(Boolean),
      sourceId: nz(sourceId),
      agentId: nz(agentId),
      channelId: nz(channelId),
      from: nz(from),
      to: nz(to),
      q: nz(q),
    });
    // Un filtro mal formado (fecha inválida, etc.) es un 400, no un fallo del servidor.
    if (!parsed.success) throw new BadRequestException("Filtros inválidos");
    const list = await this.messaging.listConversations(user.sub, parsed.data, user.role);
    // Sin permiso de ver el teléfono, la bandeja lo muestra enmascarado.
    if (!(await this.perms.canSeePhone(user.sub))) {
      for (const c of list) c.contact.phone = maskPhone(c.contact.phone);
    }
    return list;
  }

  @Get("conversations/:id/messages")
  getMessages(@Param("id") id: string) {
    return this.messaging.getMessages(id);
  }

  @Get("conversations/unread-count")
  unreadCount() {
    return this.messaging.unreadCount();
  }

  @Post("messages")
  send(@Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput) {
    return this.messaging.queueOutbound(body, MessageAuthor.HUMAN);
  }

  // Mensaje con botones de respuesta rápida (solo dentro de las 24h).
  @Post("messages/interactive")
  sendInteractive(
    @Body(new ZodValidationPipe(sendInteractiveSchema))
    body: SendInteractiveInput,
  ) {
    return this.messaging.queueInteractive(body, MessageAuthor.HUMAN);
  }

  // Plantilla aprobada: sirve también fuera de la ventana de 24h.
  @Post("messages/template")
  sendTemplate(
    @Body(new ZodValidationPipe(sendTemplateMessageSchema))
    body: SendTemplateMessageInput,
  ) {
    return this.messaging.sendTemplateMessage(body, MessageAuthor.HUMAN);
  }

  @Post("messages/react")
  react(
    @Body(new ZodValidationPipe(reactMessageSchema)) body: ReactMessageInput,
  ) {
    return this.messaging.reactToMessage(body.messageId, body.emoji);
  }

  @Patch("conversations/:id/assign")
  async assign(
    @CurrentUser() user: AccessTokenClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignConversationSchema))
    body: AssignConversationInput,
  ) {
    // Tomar un chat para uno mismo siempre se puede; dárselo a otro, con permiso.
    if (body.agentId !== user.sub) await this.perms.assertAction(user.sub, "reassign");
    return this.messaging.assignConversation(id, body.agentId);
  }

  @Patch("conversations/:id/status")
  setStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setStatusSchema)) body: SetStatusInput,
  ) {
    return this.messaging.setStatus(id, body.status);
  }

  /** Cancela el seguimiento automático programado en el chat; no vuelve hasta que el cliente escriba. */
  @Delete("conversations/:id/follow-up")
  cancelFollowUp(@Param("id") id: string) {
    return this.messaging.cancelFollowUp(id);
  }

  // Al abrir el chat: los mensajes del contacto dejan de contar como nuevos.
  @Patch("conversations/:id/read")
  markRead(@Param("id") id: string) {
    return this.messaging.markRead(id);
  }

  @Patch("conversations/:id/ai-mode")
  setAiMode(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setAiModeSchema)) body: SetAiModeInput,
  ) {
    return this.messaging.setAiMode(id, body.mode);
  }

  @Get("conversations/:id/notes")
  listNotes(@Param("id") id: string) {
    return this.messaging.listNotes(id);
  }

  @Post("conversations/:id/notes")
  addNote(
    @Param("id") id: string,
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(createNoteSchema)) body: CreateNoteInput,
  ) {
    return this.messaging.addNote(id, user.sub, body.body);
  }
}
