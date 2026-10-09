import { Inject, Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { QUEUE_AI_REPLY } from "../../infra/queue/queue.constants";
import {
  AiMode,
  ConversationStatus,
  DEFAULT_HANDOFF_MESSAGE,
  MessageAuthor,
  MessageType,
  HANDOFF_REASON_MEDIA,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { MessagingService } from "../messaging/messaging.service";
import { AgentService } from "./agent.service";
import { BotService } from "./bot.service";
import { WebhookOutService } from "../webhooks-out/webhook-out.service";
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from "../whatsapp/whatsapp-provider.interface";

/**
 * Responde automáticamente a mensajes entrantes cuando la conversación está
 * en modo AUTOPILOT. Aplica los guardrails antes de enviar:
 *  - solo autopilot, contacto con opt-in, IA no pausada por un humano,
 *  - dentro de la ventana de 24h,
 *  - la IA no recomienda escalar.
 * Si algún guardrail falla, marca la conversación como PENDING para un humano.
 */
@Injectable()
export class AutopilotService {
  private readonly logger = new Logger("Autopilot");

  constructor(
    private readonly bots: BotService,
    private readonly prisma: PrismaService,
    private readonly agent: AgentService,
    private readonly messaging: MessagingService,
    @Inject(WHATSAPP_PROVIDER) private readonly wa: WhatsAppProvider,
    private readonly webhooks: WebhookOutService,
    private readonly events: EventEmitter2,
    @InjectQueue(QUEUE_AI_REPLY) private readonly replyQueue: Queue,
  ) {}

  /** Conversaciones en las que el modelo está redactando ahora mismo. */
  private readonly inFlight = new Set<string>();

  /**
   * Pide un turno de respuesta para un mensaje entrante. Con espera, el turno
   * se encola para dentro de `delaySec`; si mientras tanto llega otro
   * mensaje, el suyo gana y este se descarta al vencer (ver runIfLatest).
   * Así, a un cliente que escribe en tres partes se le responde una vez, a
   * las tres, en vez de tres respuestas a medias o ninguna.
   */
  async schedule(
    conversationId: string,
    messageId: string | null,
    delaySec: number,
    orgId: string,
  ): Promise<void> {
    if (!messageId || delaySec <= 0) {
      await this.runIfLatest(conversationId, messageId);
      return;
    }
    await this.replyQueue.add(
      "reply",
      { conversationId, orgId, messageId },
      { delay: Math.min(60, delaySec) * 1000, jobId: `ai-reply-${messageId}` },
    );
  }

  /**
   * Corre el turno solo si ese mensaje sigue siendo el último del cliente.
   * Si el modelo ya está redactando en esta conversación (un mensaje llegó a
   * mitad de la respuesta anterior), se vuelve a intentar en dos segundos:
   * así la segunda respuesta ve la primera y no se pisan.
   */
  async runIfLatest(conversationId: string, messageId: string | null): Promise<void> {
    if (messageId) {
      const last = await this.prisma.message.findFirst({
        where: { conversationId, direction: "INBOUND" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, conversation: { select: { orgId: true } } },
      });
      if (!last || last.id !== messageId) return; // llegó otro: su turno manda
      if (this.inFlight.has(conversationId)) {
        await this.replyQueue.add(
          "reply",
          { conversationId, orgId: last.conversation.orgId, messageId },
          { delay: 2000, jobId: `ai-reply-${messageId}-${Date.now()}` },
        );
        return;
      }
    }
    await this.run(conversationId);
  }

  /**
   * Enciende o apaga «la IA está escribiendo» en la bandeja. Solo mientras
   * el modelo redacta de verdad: si un guardrail decide no contestar, nunca
   * se enciende, y si algo falla a medias, se apaga igual (finally).
   */
  private typing(conversationId: string, orgId: string | undefined, on: boolean): void {
    this.events.emit("ai.typing", { conversationId, orgId, on });
  }

  /**
   * Muestra "escribiendo…" al cliente. Necesita el waMessageId del último
   * entrante, que es sobre el que Meta cuelga el indicador. El indicador
   * caduca solo a los 25 s, así que no hay nada que limpiar.
   */
  private async showTyping(conversationId: string): Promise<void> {
    try {
      const last = await this.prisma.message.findFirst({
        where: { conversationId, direction: "INBOUND", waMessageId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { waMessageId: true, conversation: { select: { channel: true } } },
      });
      if (!last?.waMessageId) return;
      await this.wa.sendTypingIndicator(
        last.waMessageId,
        last.conversation.channel?.phoneNumberId,
      );
    } catch (e) {
      this.logger.debug(`No se pudo mostrar "escribiendo…": ${(e as Error).message}`);
    }
  }

  /**
   * La IA se retira: el cliente recibe el aviso configurado (si la ventana
   * de 24 h sigue abierta) y el equipo ve una nota con el motivo. Una vez por
   * conversación: si ya avisó, no repite.
   */
  private async handoff(
    conversationId: string,
    orgId: string,
    reason: string,
    sendNotice: boolean,
    contact: { name: string | null; phone: string },
  ): Promise<void> {
    try {
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { channelId: true, contactId: true, aiMode: true },
      });
      if (!convo) return;
      // Queda constancia de quién lo pasó y por qué, y la IA deja de responder
      // sola (pasa a Copilot: sigue sugiriendo) hasta que alguien lo atienda.
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          handoffAt: new Date(),
          handoffReason: reason.slice(0, 500),
          ...(convo.aiMode === AiMode.AUTOPILOT ? { aiMode: AiMode.COPILOT } : {}),
        },
      });
      const bot = await this.bots.resolveForConversation(convo);
      const rules = (bot?.escalationRules as { handoffMessage?: string } | null) ?? null;
      const text = (rules?.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE).trim();
      const already = text
        ? await this.prisma.message.findFirst({
            where: { conversationId, direction: "OUTBOUND", author: MessageAuthor.AI, content: text },
            select: { id: true },
          })
        : null;
      if (text && sendNotice && !already) {
        await this.messaging.queueOutbound({ conversationId, type: MessageType.TEXT, text }, MessageAuthor.AI);
      }
      const author =
        (await this.prisma.user.findFirst({ where: { orgId, role: "ADMIN" }, orderBy: { createdAt: "asc" } })) ??
        (await this.prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" } }));
      if (author) await this.messaging.addNote(conversationId, author.id, `🤖 La IA pasó el chat a una persona. Motivo: ${reason}`);
      // Aviso en la bandeja de quien esté conectado (y notificación del navegador).
      this.events.emit("inbox.changed", {
        conversationId,
        orgId,
        handoff: { contactName: contact.name ?? contact.phone, reason },
      });
    } catch (e) {
      this.logger.warn(`Aviso de traspaso en ${conversationId} falló: ${(e as Error).message}`);
    }
  }

  /**
   * Ejecuta el agente en autopilot para una conversación. Lo invoca
   * AutomationService tras pasar sus reglas (palabras clave, horario).
   */
  async run(conversationId: string): Promise<void> {
    let redactando: { orgId: string | undefined } | null = null;
    this.inFlight.add(conversationId);
    try {
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { contact: true },
      });
      if (!convo || convo.aiMode !== AiMode.AUTOPILOT) return;
      if (!convo.contact.optIn) return;
      if (convo.aiPausedUntil && convo.aiPausedUntil > new Date()) {
        this.logger.debug(`IA pausada (humano activo) en ${conversationId}`);
        return;
      }

      // "Escribiendo…" en el móvil del cliente y en la bandeja mientras el
      // modelo redacta. Lo del móvil va sin await: es cosmético.
      redactando = { orgId: convo.orgId ?? undefined };
      this.typing(conversationId, redactando.orgId, true);
      void this.showTyping(conversationId);

      const res = await this.agent.suggest(conversationId);

      if (res.escalate || !res.suggestion || !res.windowOpen) {
        // La IA se rinde: alguien fuera puede querer enterarse (avisar a un
        // supervisor, abrir un ticket…).
        void this.webhooks.emit("conversation.escalated", {
          conversationId,
          contact: { id: convo.contact.id, phone: convo.contact.phone },
          reason: res.escalationReason,
        });
        if (convo.status !== ConversationStatus.PENDING) {
          await this.messaging.setStatus(
            conversationId,
            ConversationStatus.PENDING,
          );
        }
        const reason = res.escalationReason ?? "La IA no tuvo una respuesta.";
        this.logger.log(`Autopilot escaló ${conversationId}: ${reason}`);
        // Si la IA usó handoff_to_human y además redactó su despedida («una
        // persona validará tu pago…»), se envía esa: es lo que pidió el prompt.
        const ownGoodbye =
          !!res.suggestion?.trim() &&
          (res.toolsUsed.includes("handoff_to_human") || res.escalationReason === HANDOFF_REASON_MEDIA);
        if (ownGoodbye && res.windowOpen) {
          await this.messaging.queueOutbound(
            { conversationId, type: MessageType.TEXT, text: res.suggestion!.trim() },
            MessageAuthor.AI,
          );
        }
        // Si no, el aviso configurado; y en todo caso, nota y aviso al equipo.
        await this.handoff(conversationId, convo.orgId, reason, res.windowOpen && !ownGoodbye, convo.contact);
        return;
      }

      await this.messaging.queueOutbound(
        { conversationId, type: MessageType.TEXT, text: res.suggestion },
        MessageAuthor.AI,
      );
      this.logger.log(`Autopilot respondió ${conversationId}`);
    } catch (e) {
      this.logger.error(
        `Autopilot falló en ${conversationId}: ${(e as Error).message}`,
      );
    } finally {
      this.inFlight.delete(conversationId);
      if (redactando) this.typing(conversationId, redactando.orgId, false);
    }
  }
}
