import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { MessageAuthor, MessageType } from "@prisma/client";
import {
  fillTemplateText,
  followUpTemplateFor,
  followUpTemplateVars,
  namedTemplateVars,
  templateVarCount,
  type BusinessHours,
  type FollowUpPreview,
  type FollowUpStep,
  type FollowUpVar,
  type FollowUps,
  type VariableValue,
} from "@crm/shared";
import { env } from "../../common/utils/env";
import { isWithinHours } from "../../common/utils/business-hours";
import { isQuietAt, quietClockFor } from "../../common/utils/quiet-hours";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { MessagingService } from "../messaging/messaging.service";
import { AgentService } from "./agent.service";
import { AiSettingsService } from "./ai-settings.service";
import { BotService } from "./bot.service";
import {
  ANY_TIME,
  FOLLOW_UP_CANCELLED,
  canSendAt,
  consultedProductNames,
  followUpAllowed,
  listText,
  nextSendable,
  parseFollowUps,
  planFollowUp,
  type FollowUpPlan,
  type SendTimes,
} from "./follow-up.rules";
import type { MessageOutboundEvent } from "./flow-triggers.service";
import { customerTextFor } from "./contact-vars";

const SWEEP_EVERY_MS = 60_000;
const BATCH = 50;
/** No se puede enviar ahora y no se sabe cuándo se podrá: se vuelve a mirar pasado este rato. */
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
 * mensaje que redacta la IA con el contexto del chat. La plantilla es un
 * texto fijo que aprobó Meta; el contexto le entra por dos sitios: cuál se
 * elige (una por etapa del embudo, si se configuró) y qué va en sus huecos
 * (el nombre, lo que el cliente consultó en el catálogo o un texto). Cuándo, las reglas de
 * follow-up.rules.ts: tras un rato de silencio o un rato antes de que se
 * cierre la ventana del canal (en WhatsApp, 24 h desde el último mensaje del
 * cliente). Con la ventana cerrada solo cabe plantilla: un toque de texto o
 * de IA que caiga ahí no sale, y queda anotado en el chat para el equipo.
 *
 * Ningún toque sale fuera del horario de atención del agente ni en el horario
 * de descanso de los seguimientos (la noche, con la hora del cliente): espera
 * al primer momento en que se pueda.
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
    const times = applies ? await this.sendTimes(bot, cfg!, convo.contactId) : ANY_TIME;
    const plan: FollowUpPlan = applies
      ? planFollowUp(cfg!, step, new Date(), convo.windowExpiresAt, times)
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
        plan.skipped.map((s) => ({ step: s.step, ...skipText(s.reason, times) })),
      );
    }
    this.events.emit("inbox.changed", { conversationId: convo.id, orgId: convo.orgId });
  }

  // ── Lo que va a salir, antes de que salga ───────────────────
  /**
   * El próximo seguimiento del chat como lo ve el equipo: qué toque es, cuándo
   * sale y qué va a decir. No envía ni cambia nada. null si no hay ninguno
   * programado o el agente ya no tiene ese toque.
   */
  async preview(conversationId: string): Promise<FollowUpPreview | null> {
    const found = await this.nextStep(conversationId);
    if (!found) return null;
    const { convo, step, index, total } = found;
    const dueAt = convo.followUpDueAt!;
    const base = { step: index + 1, total, dueAt: dueAt.toISOString(), kind: step.kind, goal: null, templateName: null, message: null, blocked: null };
    // Fuera de la ventana solo cabe una plantilla (ver fire()).
    const windowOpen = !!convo.windowExpiresAt && convo.windowExpiresAt > dueAt;
    const closed =
      convo.channelKind === "whatsapp"
        ? "No va a salir: para entonces la ventana de 24 h estará cerrada y este toque no es una plantilla."
        : "No va a salir: para entonces la ventana para escribirle estará cerrada.";

    if (step.kind === "template") {
      const pick = followUpTemplateFor(step, await this.stageOf(convo.contactId));
      const template = pick.templateId ? await this.prisma.template.findUnique({ where: { id: pick.templateId }, select: { name: true, body: true } }) : null;
      if (!template) return { ...base, blocked: pick.templateId ? "No va a salir: su plantilla ya no existe." : "No va a salir: no tiene una plantilla elegida." };
      const contact = await this.prisma.contact.findUnique({ where: { id: convo.contactId }, select: { name: true } });
      const filled = await this.templateValues(convo.id, template.body, pick.vars);
      // Los huecos sin valor se quedan a la vista ({{2}}): es lo que hay que arreglar.
      const values = filled.slots.map((v) => (!v ? undefined : v.source === "contact_name" ? contact?.name?.trim() || "…" : (v.value ?? "")));
      return {
        ...base,
        templateName: template.name,
        message: fillTemplateText(template.body, values as string[], namedTemplateVars(template.body)),
        blocked:
          convo.channelKind !== "whatsapp"
            ? `No va a salir: las plantillas solo existen en WhatsApp y este chat es de ${convo.channelKind}.`
            : filled.missing
              ? `No va a salir: a su plantilla le falta el valor de ${filled.missing}.`
              : null,
      };
    }
    if (step.kind === "ai") return { ...base, goal: step.text?.trim() || null, blocked: windowOpen ? null : closed };
    const message = (await customerTextFor(this.prisma, convo.id, step.text ?? "")).trim();
    return { ...base, message: message || null, blocked: !windowOpen ? closed : message ? null : "No va a salir: este toque no tiene texto." };
  }

  /**
   * Un borrador de lo que redactaría la IA ahora mismo para el próximo toque.
   * No se envía: el mensaje real se redacta cuando toca y puede variar.
   */
  async draft(conversationId: string): Promise<{ text: string }> {
    const found = await this.nextStep(conversationId);
    if (!found) throw new NotFoundException("Este chat no tiene un seguimiento programado");
    if (found.step.kind !== "ai") throw new BadRequestException("Solo los seguimientos que redacta la IA tienen borrador");
    if (!(await this.aiSettings.status()).ready) throw new BadRequestException("La IA no está disponible ahora (sin clave o con el cupo lleno)");
    const text = await this.agent.draftFollowUp(conversationId, found.step.text);
    if (!text?.trim()) throw new BadRequestException("La IA no redactó nada (cupo agotado o respuesta vacía)");
    return { text: text.trim() };
  }

  /** La conversación y el toque que tiene programado, si lo tiene. */
  private async nextStep(conversationId: string) {
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
    if (!convo?.followUpDueAt) return null;
    const bot = await this.bots.resolveForConversation(convo);
    const cfg = bot?.isActive ? parseFollowUps(bot.followUps) : null;
    const step = cfg?.steps[convo.followUpStep];
    if (!cfg || !step) return null;
    return { convo, step, index: convo.followUpStep, total: cfg.steps.length };
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
    const contact = await this.prisma.contact.findUnique({ where: { id: convo.contactId }, select: { optIn: true, phone: true } });
    if (contact && !contact.optIn) return clear("el cliente pidió la baja");

    // Lo normal es que un mensaje del cliente ya haya limpiado el plan; por si acaso.
    const last = await this.prisma.message.findFirst({
      where: { conversationId: convo.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { direction: true, createdAt: true },
    });
    if (!last || last.direction !== "OUTBOUND") return clear("el cliente ya respondió");

    const deal = await this.prisma.deal.findFirst({
      where: { contactId: convo.contactId, discardedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { stageId: true, stage: { select: { isWon: true } } },
    });
    if (deal?.stage.isWon) return clear("oportunidad ganada");

    // Con la ventana cerrada solo cabe plantilla. Un toque de texto o de IA ya
    // no puede salir: no tiene sentido hacerle esperar al horario de atención.
    const windowOpen = !!convo.windowExpiresAt && convo.windowExpiresAt > now;
    const blocked = step.kind !== "template" && !windowOpen;
    const times = await this.sendTimes(bot, cfg, convo.contactId, contact?.phone ?? null);
    if (!blocked && !canSendAt(times, now)) {
      // Fuera del horario de atención o en horario de descanso (cambiaron
      // después de programar el toque): espera al primer momento en que se pueda.
      const next = nextSendable(times, now);
      const known = next > now;
      await this.prisma.conversation.update({
        where: { id: convo.id },
        data: { followUpDueAt: known ? next : new Date(now.getTime() + RETRY_MINUTES * 60_000) },
      });
      if (known) this.events.emit("inbox.changed", { conversationId: convo.id, orgId: convo.orgId });
      return;
    }

    // Primero se avanza el plan y luego se envía: si el envío falla, no se
    // reintenta cada minuto (queda en el registro y anotado en el chat).
    const plan = planFollowUp(cfg, i + 1, now, convo.windowExpiresAt, times);
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { followUpStep: plan.step, followUpDueAt: plan.dueAt },
    });

    const total = cfg.steps.length;
    const unsent: Unsent[] = [];
    if (blocked) {
      unsent.push({ step: i, why: closedWhy(convo.channelKind, delayedBy(step, last.createdAt, convo.windowExpiresAt, times)) });
    } else {
      try {
        const why = await this.send(convo.id, convo.channelKind, step, deal?.stageId ?? null);
        if (why) unsent.push({ step: i, why });
      } catch (e) {
        const message = (e as Error).message.slice(0, 200);
        this.logger.error(`Seguimiento ${i + 1}/${total} en ${convo.id}: ${message}`);
        unsent.push({ step: i, why: `falló el envío (${message})` });
      }
    }
    for (const s of plan.skipped) unsent.push({ step: s.step, ...skipText(s.reason, times) });

    const mine = unsent.find((u) => u.step === i);
    this.logger.log(`Seguimiento ${i + 1}/${total} (${step.kind}) en ${convo.id}: ${mine ? `no enviado, ${mine.why}` : "enviado"}`);
    if (unsent.length) await this.noteUnsent(convo, total, unsent);
    this.events.emit("inbox.changed", { conversationId: convo.id, orgId: convo.orgId });
  }

  /** Envía el toque. Devuelve null si salió, o por qué no había nada que enviar. */
  private async send(conversationId: string, channelKind: string, step: FollowUpStep, stageId: string | null): Promise<string | null> {
    if (step.kind === "template") {
      // La de la etapa en que está el cliente, si el toque tiene una para ella.
      const pick = followUpTemplateFor(step, stageId);
      if (!pick.templateId) return "no tiene una plantilla elegida";
      // Messenger, Instagram y TikTok no tienen plantillas.
      if (channelKind !== "whatsapp") return `las plantillas solo existen en WhatsApp y este chat es de ${channelKind}`;
      const template = await this.prisma.template.findUnique({ where: { id: pick.templateId }, select: { body: true } });
      if (!template) return "su plantilla ya no existe";
      const filled = await this.templateValues(conversationId, template.body, pick.vars);
      // Con un hueco vacío Meta rechaza el mensaje entero: mejor decir cuál falta.
      if (filled.missing) return `a su plantilla le falta el valor de ${filled.missing} (se elige en el agente, en Seguimientos)`;
      await this.messaging.sendTemplateMessage(
        { conversationId, templateId: pick.templateId, fill: { body: filled.slots as VariableValue[], urlButtons: [] } },
        MessageAuthor.AI,
      );
      return null;
    }
    if (step.kind === "ai" && !(await this.aiSettings.status()).ready) return "la empresa no tiene la IA configurada";
    const text = step.kind === "ai" ? await this.agent.draftFollowUp(conversationId, step.text) : await customerTextFor(this.prisma, conversationId, step.text ?? "");
    if (!text?.trim()) return step.kind === "ai" ? "la IA no redactó el mensaje (cupo agotado o respuesta vacía)" : "no tiene texto";
    await this.messaging.queueOutbound({ conversationId, type: MessageType.TEXT, text: text.trim() }, MessageAuthor.AI);
    return null;
  }

  /**
   * Los valores de cada hueco de la plantilla para este chat, en su orden.
   * `missing` nombra el primero que se queda sin valor («{{2}}»), si hay alguno.
   */
  private async templateValues(conversationId: string, body: string, vars: FollowUpVar[]): Promise<{ slots: (VariableValue | null)[]; missing: string | null }> {
    const picked = followUpTemplateVars(templateVarCount(body), vars);
    const product = picked.some((v) => v?.source === "product") ? await this.consultedProduct(conversationId) : "";
    const slots = picked.map((v, i): VariableValue | null => {
      if (!v) return null;
      if (v.source === "contact_name") return { index: i + 1, source: "contact_name" };
      // Si el cliente no consultó nada, va lo que el dueño dejó escrito para ese caso.
      return { index: i + 1, source: "static", value: v.source === "product" ? product || v.value : v.value };
    });
    const gap = slots.findIndex((v) => !v);
    const name = gap >= 0 ? namedTemplateVars(body)[gap] : undefined;
    return { slots, missing: gap >= 0 ? `{{${name ?? gap + 1}}}` : null };
  }

  /**
   * Lo que el cliente consultó en el catálogo en este chat, en una frase
   * («Power BI», «Power BI y Excel»): los productos de la última búsqueda
   * concreta del agente que siguen a la venta. Vacío si no consultó ninguno.
   */
  private async consultedProduct(conversationId: string): Promise<string> {
    const calls = await this.prisma.aiToolCall.findMany({
      where: { toolName: "search_products", aiRun: { conversationId } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { output: true },
    });
    const names = consultedProductNames(calls.map((c) => c.output));
    if (!names.length) return "";
    const active = await this.prisma.product.findMany({ where: { isActive: true, name: { in: names } }, select: { name: true } });
    return listText(names.filter((n) => active.some((p) => p.name === n)));
  }

  /** La etapa del embudo en que está el cliente (la de su oportunidad más reciente), si tiene. */
  private async stageOf(contactId: string): Promise<string | null> {
    const deal = await this.prisma.deal.findFirst({
      where: { contactId, discardedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { stageId: true },
    });
    return deal?.stageId ?? null;
  }

  /**
   * Cuándo puede salir un toque en este chat: el horario de atención del
   * agente y el horario de descanso. Este último se mira con el reloj del
   * cliente, que sale del país de su teléfono: si no viene dado, se busca.
   */
  private async sendTimes(
    bot: { businessHoursEnabled: boolean; businessHours: unknown } | null,
    cfg: FollowUps,
    contactId: string,
    phone?: string | null,
  ): Promise<SendTimes> {
    const hours = hoursOf(bot);
    if (!cfg.quiet.enabled) return { hours, quiet: null };
    if (phone === undefined && cfg.quiet.clock === "contact") {
      phone = (await this.prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true } }))?.phone ?? null;
    }
    return { hours, quiet: quietClockFor(cfg.quiet, phone) };
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
function skipText(reason: FollowUpPlan["skipped"][number]["reason"], times: SendTimes): { why: string; whyMany: string } {
  const when = [times.hours ? "dentro del horario de atención" : "", times.quiet ? "fuera del horario de descanso" : ""].filter(Boolean).join(" y ");
  const rest =
    reason === "window_closed"
      ? "antes del cierre de la ventana y la ventana ya estaba cerrada"
      : `antes del cierre de la ventana y ya no quedaba tiempo${when ? ` ${when}` : ""}`;
  return { why: `iba ${rest}`, whyMany: `iban ${rest}` };
}

/**
 * Qué retrasó un toque «tras X de silencio» que por su espera cabía en la
 * ventana y llegó con ella cerrada: el horario de descanso o el de atención.
 * null si no fue eso (nuestro mensaje ya había salido tarde).
 */
function delayedBy(step: FollowUpStep, sentAt: Date | undefined, windowExpiresAt: Date | null, times: SendTimes): "quiet" | "hours" | null {
  if (step.timing !== "after" || !sentAt || !windowExpiresAt) return null;
  const due = new Date(sentAt.getTime() + step.afterMinutes * 60_000);
  if (due >= windowExpiresAt) return null;
  if (times.quiet && isQuietAt(times.quiet, due)) return "quiet";
  if (times.hours && !isWithinHours(times.hours, due)) return "hours";
  return null;
}

/** Por qué no salió un toque de texto o de IA con la ventana cerrada, para la nota del chat. */
function closedWhy(channelKind: string, delayed: "quiet" | "hours" | null): string {
  const whatsapp = channelKind === "whatsapp";
  const window = whatsapp ? "la ventana de 24 h" : "la ventana para escribirle";
  const tail = whatsapp ? "; este toque no es una plantilla" : "";
  if (delayed === "quiet") return `le tocaba en el horario de descanso y ${window} se cerró antes de que terminara${tail}`;
  if (delayed === "hours") return `le tocaba fuera del horario de atención y ${window} se cerró antes de que abriera${tail}`;
  return whatsapp ? "la ventana de 24 h ya estaba cerrada y este toque no es una plantilla" : "la ventana para escribirle ya estaba cerrada";
}

/** Mismo instante con margen de unos segundos (el evento llega un poco después de programar). */
function sameInstant(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.getTime() - b.getTime()) < 5_000;
}
