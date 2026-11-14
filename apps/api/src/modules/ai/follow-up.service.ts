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
import { FOLLOW_UP_CANCELLED, followUpAllowed, parseFollowUps, planFollowUp, type FollowUpPlan } from "./follow-up.rules";
import type { MessageOutboundEvent } from "./flow-triggers.service";

const SWEEP_EVERY_MS = 60_000;
const BATCH = 50;
/** Fuera de horario de atención: se vuelve a mirar pasado este rato. */
const RETRY_MINUTES = 15;

/** Un toque que no salió y por qué, para dejarlo anotado en el chat. */
interface Unsent {
  step: number;
  why: string;
  /** El mismo motivo dicho de varios toques a la vez, si cambia la frase. */
  whyMany?: string;
}

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
 * mensaje que redacta la IA con el contexto del chat. Cuándo, las reglas de
 * follow-up.rules.ts: tras un rato de silencio o un rato antes de que se
 * cierre la ventana del canal (en WhatsApp, 24 h desde el último mensaje del
 * cliente). Con la ventana cerrada solo cabe plantilla: un toque de texto o
 * de IA que caiga ahí no sale, y queda anotado en el chat para el equipo.
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
      select: {
        id: true,
        orgId: true,
        contactId: true,
        channelId: true,
        channelKind: true,
        metaPageId: true,
        tiktokAccountId: true,
        status: true,
        aiMode: true,
        handoffAt: true,
        windowExpiresAt: true,
        followUpStep: true,
        followUpDueAt: true,
      },
    });
    if (!convo) return;
    const bot = await this.bots.resolveForConversation(convo);
    const cfg = bot?.isActive ? parseFollowUps(bot.followUps) : null;
    // Una persona escribió: la secuencia empieza de nuevo. Si alguien la
    // canceló desde la bandeja, sigue cancelada hasta que el cliente escriba.
    const step = author === MessageAuthor.HUMAN && convo.followUpStep !== FOLLOW_UP_CANCELLED ? 0 : convo.followUpStep;
    const applies = !!cfg && convo.status !== "CLOSED" && followUpAllowed(cfg, convo);
    const hours = hoursOf(bot);
    const plan: FollowUpPlan = applies
      ? planFollowUp(cfg!, step, new Date(), convo.windowExpiresAt, hours)
      : { step, dueAt: null, skipped: [], movedUp: false };
    if (plan.step === convo.followUpStep && sameInstant(plan.dueAt, convo.followUpDueAt)) return;
    // Varios mensajes nuestros seguidos (una respuesta partida) llegan casi a
    // la vez: solo el primero mueve el plan y deja la nota de lo que se saltó.
    const moved = await this.prisma.conversation.updateMany({
      where: { id: convo.id, followUpStep: convo.followUpStep },
      data: { followUpStep: plan.step, followUpDueAt: plan.dueAt },
    });
    if (!moved.count) return;
    if (plan.movedUp && plan.dueAt) {
      this.logger.log(`Seguimiento ${plan.step + 1} en ${convo.id} adelantado a ${plan.dueAt.toISOString()} para que salga con la ventana abierta`);
    }
    if (cfg && plan.skipped.length) {
      await this.noteUnsent(
        convo,
        cfg.steps.length,
        plan.skipped.map((s) => ({ step: s.step, ...skipText(s.reason, !!hours) })),
      );
    }
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
        channelKind: true,
        metaPageId: true,
        tiktokAccountId: true,
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

    // Con la ventana cerrada solo cabe plantilla. Un toque de texto o de IA ya
    // no puede salir: no tiene sentido hacerle esperar al horario de atención.
    const windowOpen = !!convo.windowExpiresAt && convo.windowExpiresAt > now;
    const blocked = step.kind !== "template" && !windowOpen;
    const hours = hoursOf(bot);
    if (!blocked && hours && !isWithinHours(hours, now)) {
      await this.prisma.conversation.update({
        where: { id: convo.id },
        data: { followUpDueAt: new Date(now.getTime() + RETRY_MINUTES * 60_000) },
      });
      return;
    }

    // Primero se avanza el plan y luego se envía: si el envío falla, no se
    // reintenta cada minuto (queda en el registro y anotado en el chat).
    const plan = planFollowUp(cfg, i + 1, now, convo.windowExpiresAt, hours);
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { followUpStep: plan.step, followUpDueAt: plan.dueAt },
    });

    const total = cfg.steps.length;
    const unsent: Unsent[] = [];
    if (blocked) {
      unsent.push({
        step: i,
        why:
          convo.channelKind === "whatsapp"
            ? "la ventana de 24 h ya estaba cerrada y este toque no es una plantilla"
            : "la ventana para escribirle ya estaba cerrada",
      });
    } else {
      try {
        const why = await this.send(convo.id, convo.channelKind, step);
        if (why) unsent.push({ step: i, why });
      } catch (e) {
        const message = (e as Error).message.slice(0, 200);
        this.logger.error(`Seguimiento ${i + 1}/${total} en ${convo.id}: ${message}`);
        unsent.push({ step: i, why: `falló el envío (${message})` });
      }
    }
    for (const s of plan.skipped) unsent.push({ step: s.step, ...skipText(s.reason, !!hours) });

    const mine = unsent.find((u) => u.step === i);
    this.logger.log(`Seguimiento ${i + 1}/${total} (${step.kind}) en ${convo.id}: ${mine ? `no enviado, ${mine.why}` : "enviado"}`);
    if (unsent.length) await this.noteUnsent(convo, total, unsent);
    this.events.emit("inbox.changed", { conversationId: convo.id, orgId: convo.orgId });
  }

  /** Envía el toque. Devuelve null si salió, o por qué no había nada que enviar. */
  private async send(conversationId: string, channelKind: string, step: FollowUpStep): Promise<string | null> {
    if (step.kind === "template") {
      if (!step.templateId) return "no tiene una plantilla elegida";
      // Messenger, Instagram y TikTok no tienen plantillas.
      if (channelKind !== "whatsapp") return `las plantillas solo existen en WhatsApp y este chat es de ${channelKind}`;
      const template = await this.prisma.template.findUnique({ where: { id: step.templateId }, select: { body: true } });
      if (!template) return "su plantilla ya no existe";
      const body = /\{\{\s*1\s*\}\}/.test(template.body) ? [{ index: 1, source: "contact_name" as const }] : [];
      await this.messaging.sendTemplateMessage(
        { conversationId, templateId: step.templateId, fill: { body, urlButtons: [] } },
        MessageAuthor.AI,
      );
      return null;
    }
    if (step.kind === "ai" && !(await this.aiSettings.status()).ready) return "la empresa no tiene la IA configurada";
    const text = step.kind === "ai" ? await this.agent.draftFollowUp(conversationId, step.text) : step.text;
    if (!text?.trim()) return step.kind === "ai" ? "la IA no redactó el mensaje (cupo agotado o respuesta vacía)" : "no tiene texto";
    await this.messaging.queueOutbound({ conversationId, type: MessageType.TEXT, text: text.trim() }, MessageAuthor.AI);
    return null;
  }

  /**
   * Deja en el chat, como nota interna, los toques que no salieron: el equipo
   * ve qué pasó sin ir al registro del servidor. Un motivo, una nota. Va a
   * nombre del primer administrador (una nota necesita autor), como las de
   * los flujos.
   */
  private async noteUnsent(convo: { id: string; orgId: string }, total: number, unsent: Unsent[]): Promise<void> {
    try {
      const author =
        (await this.prisma.user.findFirst({ where: { orgId: convo.orgId, role: "ADMIN" }, orderBy: { createdAt: "asc" } })) ??
        (await this.prisma.user.findFirst({ where: { orgId: convo.orgId }, orderBy: { createdAt: "asc" } }));
      if (!author) return;
      const byWhy = new Map<string, { steps: number[]; many: string }>();
      for (const u of unsent) {
        const group = byWhy.get(u.why) ?? { steps: [], many: u.whyMany ?? u.why };
        group.steps.push(u.step + 1);
        byWhy.set(u.why, group);
      }
      for (const [why, { steps, many }] of byWhy) {
        const text =
          steps.length === 1
            ? `el toque ${steps[0]} de ${total} no se envió: ${why}`
            : `los toques ${steps.slice(0, -1).join(", ")} y ${steps[steps.length - 1]} de ${total} no se enviaron: ${many}`;
        await this.messaging.addNote(convo.id, author.id, `🤖 Seguimiento: ${text}.`);
      }
    } catch (e) {
      this.logger.warn(`No se pudo anotar el seguimiento no enviado en ${convo.id}: ${(e as Error).message}`);
    }
  }
}

/** El horario de atención del agente, si lo tiene activado. */
function hoursOf(bot: { businessHoursEnabled: boolean; businessHours: unknown } | null): BusinessHours | null {
  return bot?.businessHoursEnabled && bot.businessHours ? (bot.businessHours as BusinessHours) : null;
}

/** Por qué se saltó un toque «antes del cierre», en palabras para la nota del chat. */
function skipText(reason: FollowUpPlan["skipped"][number]["reason"], withHours: boolean): { why: string; whyMany: string } {
  const rest =
    reason === "window_closed"
      ? "antes del cierre de la ventana y la ventana ya estaba cerrada"
      : `antes del cierre de la ventana y ya no quedaba tiempo${withHours ? " dentro del horario de atención" : ""}`;
  return { why: `iba ${rest}`, whyMany: `iban ${rest}` };
}

/** Mismo instante con margen de unos segundos (el evento llega un poco después de programar). */
function sameInstant(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.getTime() - b.getTime()) < 5_000;
}
