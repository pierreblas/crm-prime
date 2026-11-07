import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  AiMode,
  type BusinessHours,
  ConversationStatus,
  type KeywordTrigger,
  MessageAuthor,
  MessageType,
  normalizeKeywordTrigger,
  splitParagraphs,
  typingPauseMs,
  type Weekday,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { isWithinHours } from "../../common/utils/business-hours";
import { fold } from "../../common/utils/fold";
import { MessagingService } from "../messaging/messaging.service";
import { BotService } from "./bot.service";
import { AutopilotService } from "./autopilot.service";
import { MediaUnderstandingService } from "./media-understanding.service";
import { FlowEngineService } from "./flow-engine.service";
import { StageAutomationsService } from "./stage-automations.service";
import { BookingNotificationsService } from "../bookings/booking-notifications.service";

// getDay(): 0=domingo … 6=sábado.

/**
 * Reglas de automatización que se ejecutan ALREDEDOR del agente IA:
 *  - al crear conversación: bienvenida + arranque en autopilot,
 *  - en cada entrante: disparadores por palabra clave + horario de atención,
 *  - y si nada de eso aplica, delega al autopilot.
 * Es el único listener de `conversation.inbound` (llama a AutopilotService).
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger("Automation");

  constructor(
    private readonly prisma: PrismaService,
    private readonly bots: BotService,
    private readonly messaging: MessagingService,
    private readonly autopilot: AutopilotService,
    private readonly flows: FlowEngineService,
    private readonly stageAutomations: StageAutomationsService,
    private readonly media: MediaUnderstandingService,
    private readonly bookingReplies: BookingNotificationsService,
  ) {}

  /**
   * Conversación nueva: «creada» y «entrante» se emiten seguidas por el mismo
   * primer mensaje y sus manejadores corrían a la vez. Si «creada» arrancaba un
   * flujo con botones, «entrante» tomaba ese primer «Hola» como la respuesta a
   * los botones y el flujo se iba por «otra respuesta»; cuando el cliente
   * pulsaba un botón ya no quedaba nada esperando. Ahora «entrante» espera a
   * «creada» (true = arrancó un flujo y el mensaje ya está atendido).
   */
  private readonly creating = new Map<string, Promise<boolean>>();

  // ── Conversación nueva: bienvenida + autopilot por defecto ──
  @OnEvent("conversation.created")
  async onCreated(payload: { conversationId: string; messageId?: string }): Promise<void> {
    const { conversationId } = payload;
    // Se registra antes del primer await: el «entrante» se emite justo después.
    const run = this.handleCreated(conversationId, payload.messageId);
    this.creating.set(conversationId, run);
    try {
      await run;
    } finally {
      // Por si el «entrante» no llega a recogerlo.
      setTimeout(() => this.creating.delete(conversationId), 60_000).unref?.();
    }
  }

  private async handleCreated(conversationId: string, messageId?: string): Promise<boolean> {
    try {
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { contact: true },
      });
      if (!convo || !convo.contact.optIn) return false;

      // El modo de la IA se decide antes de cualquier bienvenida: un flujo «al
      // iniciar» no debe dejar la conversación sin Autopilot. Si el contacto ya
      // tuvo conversaciones, la nueva hereda el modo de la última (lo fija la
      // mensajería al crearla) y aquí no se toca.
      const bot = await this.bots.resolveForConversation(convo);
      const previous = await this.prisma.conversation.count({
        where: { contactId: convo.contactId, id: { not: conversationId } },
      });
      if (bot?.autopilotByDefault && previous === 0 && convo.aiMode !== AiMode.AUTOPILOT) {
        await this.messaging.setAiMode(conversationId, AiMode.AUTOPILOT);
      }

      // Un flujo "al iniciar conversación" tiene prioridad sobre la bienvenida del bot.
      if (await this.flows.onCreated(conversationId, messageId)) return true;
      if (!bot) return false;

      if (bot.welcomeEnabled && bot.welcomeMessage?.trim()) {
        await this.messaging.queueOutbound(
          {
            conversationId,
            type: MessageType.TEXT,
            text: bot.welcomeMessage.trim(),
          },
          MessageAuthor.AI,
        );
        this.logger.log(`Bienvenida enviada en ${conversationId}`);
      }
      return false;
    } catch (e) {
      this.logger.error(
        `onCreated falló en ${conversationId}: ${(e as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Los mensajes de una conversación se atienden de uno en uno y en orden.
   * Varios seguidos («Hola» + «quiero el precio») corrían a la vez: cada uno
   * veía que no había ningún flujo en marcha y el mismo flujo, o la misma
   * automatización, salía dos veces.
   */
  private readonly turns = new Map<string, Promise<void>>();

  // ── Entrante: palabras clave → horario → autopilot ──────────
  @OnEvent("conversation.inbound")
  async onInbound(payload: { conversationId: string; messageId?: string }): Promise<void> {
    const { conversationId } = payload;
    const turn = (this.turns.get(conversationId) ?? Promise.resolve()).then(() => this.handleInbound(payload));
    this.turns.set(conversationId, turn);
    try {
      await turn;
    } finally {
      if (this.turns.get(conversationId) === turn) this.turns.delete(conversationId);
    }
  }

  private async handleInbound(payload: { conversationId: string; messageId?: string }): Promise<void> {
    const { conversationId, messageId } = payload;
    try {
      // Primer mensaje de una conversación nueva: primero lo de «creada».
      const created = this.creating.get(conversationId);
      if (created) {
        this.creating.delete(conversationId);
        if (await created) return; // arrancó un flujo con este mensaje
      }
      const convo = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { contact: true },
      });
      if (!convo || !convo.contact.optIn) return;

      // Un audio, una imagen o un sticker: primero entenderlos, para que las
      // palabras clave, los flujos y la IA trabajen con lo que dicen.
      await this.media.enrichLatest(conversationId);

      // «Confirmar» o «Cancelar» tras un recordatorio de cita: se atiende aquí
      // y nadie más contesta.
      if (await this.bookingReplies.onInbound(conversationId, messageId)) return;

      // Prioridad máxima: si hay un flujo activo/disparado, lo maneja el motor.
      if (await this.flows.onInbound(conversationId, messageId)) return;
      // Después, las automatizaciones «llega un mensaje» de su etapa del embudo.
      if (await this.stageAutomations.onInbound(conversationId)) return;

      const bot = await this.bots.resolveForConversation(convo);

      // Último texto entrante del contacto (el autopilot contesta a lo último)
      // y el de este aviso (lo que se mira para las palabras clave).
      const lastInbound = await this.prisma.message.findFirst({
        where: { conversationId, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
      });
      const thisInbound =
        messageId && messageId !== lastInbound?.id
          ? await this.prisma.message.findFirst({ where: { id: messageId, conversationId } })
          : lastInbound;
      const text = thisInbound ? MediaUnderstandingService.textOf(thisInbound) : "";

      // 1) Disparadores por palabra clave (tienen prioridad), sin mirar tildes ni mayúsculas.
      const said = fold(text);
      if (bot && said) {
        const triggers = (bot.keywordTriggers as KeywordTrigger[] | null) ?? [];
        const hit = triggers.find((t) =>
          t.keywords.some((k) => !!fold(k) && said.includes(fold(k))),
        );
        if (hit) {
          await this.applyTrigger(conversationId, hit, text, !!bot.splitReplies);
          this.logger.log(`Disparador "${hit.action}" en ${conversationId}`);
          return; // el disparador resuelve el turno
        }
      }

      // 2) Horario de atención.
      if (bot?.businessHoursEnabled && bot.businessHours) {
        const hours = bot.businessHours as BusinessHours;
        if (!this.isWithinHours(hours)) {
          if (hours.outOfHoursMessage?.trim()) {
            await this.messaging.queueOutbound(
              {
                conversationId,
                type: MessageType.TEXT,
                text: hours.outOfHoursMessage.trim(),
              },
              MessageAuthor.AI,
            );
          }
          if (convo.status !== ConversationStatus.PENDING) {
            await this.messaging.setStatus(
              conversationId,
              ConversationStatus.PENDING,
            );
          }
          this.logger.log(`Fuera de horario en ${conversationId}`);
          return;
        }
      }

      // Evitar doble mensaje: si la bienvenida está activa y este es el primer
      // entrante, ya respondió el saludo; el autopilot entra desde el 2º mensaje.
      if (bot?.welcomeEnabled && bot.welcomeMessage?.trim()) {
        const inboundCount = await this.prisma.message.count({
          where: { conversationId, direction: "INBOUND" },
        });
        if (inboundCount <= 1) return;
      }

      // 3) Autopilot. Con unos segundos de espera: si el cliente escribe en
      // varias partes, se le responde una sola vez a todo (replyDelaySec).
      await this.autopilot.schedule(
        conversationId,
        lastInbound?.id ?? null,
        bot?.replyDelaySec ?? 4,
        convo.orgId,
      );
    } catch (e) {
      this.logger.error(
        `onInbound falló en ${conversationId}: ${(e as Error).message}`,
      );
    }
  }

  // ── Acción de un disparador por palabra clave ───────────────
  private async applyTrigger(
    conversationId: string,
    trigger: KeywordTrigger,
    inboundText: string,
    splitReplies = false,
  ): Promise<void> {
    let text = (trigger.value ?? "").trim();
    if (trigger.action === "reply") {
      // La primera versión cuyas condiciones se cumplen (país, etiqueta,
      // etapa…); si ninguna, el texto general.
      for (const v of normalizeKeywordTrigger(trigger).variants ?? []) {
        if (await this.flows.rulesMatch(conversationId, v.rules, v.match ?? "all", inboundText)) {
          text = v.value.trim();
          break;
        }
      }
    }
    if (trigger.action === "reply" && text) {
      // Con «varios mensajes cortos», una línea en blanco en el texto fijo = mensaje aparte.
      const parts = splitReplies ? splitParagraphs(text) : [text];
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, typingPauseMs(parts[i]!)));
        await this.messaging.queueOutbound(
          { conversationId, type: MessageType.TEXT, text: parts[i]! },
          MessageAuthor.AI,
        );
      }
    } else if (trigger.action === "handoff") {
      await this.messaging.setStatus(
        conversationId,
        ConversationStatus.PENDING,
      );
    } else if (trigger.action === "set_off") {
      await this.messaging.setAiMode(conversationId, AiMode.OFF);
    }
  }

  // ── Horario: ¿la hora actual cae dentro del rango del día? ──
  private isWithinHours(hours: BusinessHours): boolean {
    return isWithinHours(hours);
  }
}
