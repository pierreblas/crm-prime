import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { MessageAuthor, MessageType } from "@prisma/client";
import type { BusinessHours, FollowUpStep } from "@crm/shared";
import { env } from "../../common/utils/env";
import { isWithinHours } from "../../common/utils/business-hours";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { MessagingService } from "../messaging/messaging.service";
import { AgentService } from "./agent.service";
import { AiSettingsService } from "./ai-settings.service";
import { BotService } from "./bot.service";
import { FOLLOW_UP_CANCELLED, dueAtFor, followUpAllowed, parseFollowUps } from "./follow-up.rules";
import type { MessageOutboundEvent } from "./flow-triggers.service";

const SWEEP_EVERY_MS = 60_000;
const BATCH = 50;
/** Fuera de horario de atención: se vuelve a mirar pasado este rato. */
const RETRY_MINUTES = 15;

/**
 * Seguimientos automáticos del agente: si el cliente deja de responder, se le
 * escribe solo, en la cadencia configurada en el agente (hasta cuatro toques).
 *
 * El plan vive en la conversación (`followUpStep`, `followUpDueAt`):
 *  - cada mensaje nuestro programa el toque que toca (una persona que escribe
 *    reinicia la secuencia; la IA no, porque sus mensajes ya son la secuencia);
 *  - un mensaje del cliente la cancela (lo hace MessagingService al recibirlo);
 *  - un barrido por minuto envía lo vencido, comprobando antes que siga
 *    tocando: chat abierto, cliente callado, oportunidad no ganada, horario.
 *
 * Qué se envía lo decide cada toque: texto fijo, plantilla aprobada o un
 * mensaje que redacta la IA con el contexto del chat. Pasada la ventana de
 * 24 h solo cabe plantilla: un toque de texto o de IA que caiga ahí se salta.
 */
@Injectable()
export class FollowUpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Seguimientos");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly bots: BotService,
    private readonly agent: AgentService,
    private readonly aiSettings: AiSettingsService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    if (env("FOLLOW_UPS_SWEEP") === "off") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Programar ───────────────────────────────────────────────
  @OnEvent("message.outbound", { async: true })
  async onOutbound(e: MessageOutboundEvent): Promise<void> {
    if (!e.orgId) return;
    try {
      await runInOrg(e.orgId, () => this.schedule(e.conversationId, e.author));
    } catch (err) {
      this.logger.error(`Al programar el seguimiento de ${e.conversationId}: ${(err as Error).message}`);
    }
  }

  /** Tras un mensaje nuestro: deja programado el toque que toca, o nada si no aplica. */
  private async schedule(conversationId: string, author: string): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, orgId: true, contactId: true, channelId: true, status: true, aiMode: true, handoffAt: true, followUpStep: true, followUpDueAt: true },
    });
    if (!convo) return;
    const bot = await this.bots.resolveForConversation(convo);
    const cfg = bot?.isActive ? parseFollowUps(bot.followUps) : null;
    // Una persona escribió: la secuencia empieza de nuevo. Si alguien la
    // canceló desde la bandeja, sigue cancelada hasta que el cliente escriba.
    const step = author === MessageAuthor.HUMAN && convo.followUpStep !== FOLLOW_UP_CANCELLED ? 0 : convo.followUpStep;
    const applies = !!cfg && convo.status !== "CLOSED" && followUpAllowed(cfg, convo);
    const dueAt = applies ? dueAtFor(cfg!.steps, step, new Date()) : null;
    if (step === convo.followUpStep && sameInstant(dueAt, convo.followUpDueAt)) return;
    await this.prisma.conversation.update({ where: { id: convo.id }, data: { followUpStep: step, followUpDueAt: dueAt } });
    this.events.emit("inbox.changed", { conversationId: convo.id, orgId: convo.orgId });
  }

  // ── Enviar lo vencido ───────────────────────────────────────
  /** Una pasada por todas las empresas. Devuelve cuántos toques procesó. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await runUnscoped("seguimientos vencidos", () =>
        this.prisma.conversation.findMany({
          where: { followUpDueAt: { lte: new Date() } },
          select: { id: true, orgId: true },
          orderBy: { followUpDueAt: "asc" },
          take: BATCH,
        }),
      );
      const startedAt = new Date();
      for (const c of due) {
        try {
          await runInOrg(c.orgId, () => this.fire(c.id));
        } catch (e) {
          this.logger.error(`Seguimiento en ${c.id}: ${(e as Error).message}`);
          // Que un fallo no se repita cada minuto: se quita del plan, salvo
          // que alguien lo haya reprogramado mientras tanto.
          await runInOrg(c.orgId, () =>
            this.prisma.conversation.updateMany({
              where: { id: c.id, followUpDueAt: { lte: startedAt } },
              data: { followUpDueAt: null },
            }),
          ).catch(() => undefined);
        }
      }
      return due.length;
    } catch (e) {
      this.logger.error(`Barrido de seguimientos: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Venció el plazo: comprueba que siga tocando y envía el toque. */
  async fire(conversationId: string): Promise<void> {
    const now = new Date();
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        orgId: true,
        contactId: true,
        channelId: true,
        status: true,
        aiMode: true,
        handoffAt: true,
        windowExpiresAt: true,
        followUpStep: true,
        followUpDueAt: true,
      },
    });
    if (!convo?.followUpDueAt || convo.followUpDueAt > now) return; // alguien lo movió mientras tanto
    const clear = async (why: string) => {
      await this.prisma.conversation.update({ where: { id: convo.id }, data: { followUpDueAt: null } });
      this.logger.log(`Seguimiento en ${convo.id} cancelado: ${why}`);
      this.events.emit("inbox.changed", { conversationId: convo.id, orgId: convo.orgId });
    };

    const bot = await this.bots.resolveForConversation(convo);
    const cfg = bot?.isActive ? parseFollowUps(bot.followUps) : null;
    const i = convo.followUpStep;
    const step = cfg?.steps[i];
    if (!bot || !cfg || !step) return clear("el agente ya no tiene seguimientos");
    if (convo.status === "CLOSED") return clear("chat cerrado");
    if (!followUpAllowed(cfg, convo)) return clear("el chat lo lleva una persona");

    // Lo normal es que un mensaje del cliente ya haya limpiado el plan; por si acaso.
    const last = await this.prisma.message.findFirst({
      where: { conversationId: convo.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { direction: true },
    });
    if (!last || last.direction !== "OUTBOUND") return clear("el cliente ya respondió");

    const deal = await this.prisma.deal.findFirst({
      where: { contactId: convo.contactId, discardedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { stage: { select: { isWon: true } } },
    });
    if (deal?.stage.isWon) return clear("oportunidad ganada");

    if (bot.businessHoursEnabled && bot.businessHours && !isWithinHours(bot.businessHours as BusinessHours, now)) {
      await this.prisma.conversation.update({
        where: { id: convo.id },
        data: { followUpDueAt: new Date(now.getTime() + RETRY_MINUTES * 60_000) },
      });
      return;
    }

    // Primero se avanza el plan y luego se envía: si el envío falla, no se
    // reintenta cada minuto (quedaría en el registro).
    const next = i + 1;
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { followUpStep: next, followUpDueAt: dueAtFor(cfg.steps, next, now) },
    });

    const windowOpen = !!convo.windowExpiresAt && convo.windowExpiresAt > now;
    if (step.kind !== "template" && !windowOpen) {
      this.logger.log(`Seguimiento ${i + 1}/${cfg.steps.length} en ${convo.id} omitido: ventana de 24 h cerrada y no es plantilla`);
      this.events.emit("inbox.changed", { conversationId: convo.id, orgId: convo.orgId });
      return;
    }

    const sent = await this.send(convo.id, step);
    this.logger.log(
      `Seguimiento ${i + 1}/${cfg.steps.length} (${step.kind}) en ${convo.id}: ${sent ? "enviado" : "sin texto, omitido"}`,
    );
  }

  /** Envía el toque. false si no había nada que enviar (plantilla borrada, IA sin texto). */
  private async send(conversationId: string, step: FollowUpStep): Promise<boolean> {
    if (step.kind === "template") {
      if (!step.templateId) return false;
      const template = await this.prisma.template.findUnique({ where: { id: step.templateId }, select: { body: true } });
      if (!template) {
        this.logger.warn(`La plantilla ${step.templateId} del seguimiento ya no existe`);
        return false;
      }
      const body = /\{\{\s*1\s*\}\}/.test(template.body) ? [{ index: 1, source: "contact_name" as const }] : [];
      await this.messaging.sendTemplateMessage(
        { conversationId, templateId: step.templateId, fill: { body, urlButtons: [] } },
        MessageAuthor.AI,
      );
      return true;
    }
    if (step.kind === "ai" && !(await this.aiSettings.status()).ready) {
      this.logger.warn(`Toque de IA en ${conversationId} omitido: la empresa no tiene clave de IA`);
      return false;
    }
    const text = step.kind === "ai" ? await this.agent.draftFollowUp(conversationId, step.text) : step.text;
    if (!text?.trim()) return false;
    await this.messaging.queueOutbound({ conversationId, type: MessageType.TEXT, text: text.trim() }, MessageAuthor.AI);
    return true;
  }
}

/** Mismo instante con margen de unos segundos (el evento llega un poco después de programar). */
function sameInstant(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.getTime() - b.getTime()) < 5_000;
}
