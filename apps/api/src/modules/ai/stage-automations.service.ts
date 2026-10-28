import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  NO_CONDITIONS,
  stageAutomationConditionsSchema,
  type StageAutomationApplyResult,
  type StageAutomationConditions,
  type StageAutomationExisting,
  type StageWebhookBody,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { QUEUE_FLOW } from "../../infra/queue/queue.constants";
import { FlowEngineService } from "./flow-engine.service";
import type { DealStageChangedEvent, MessageOutboundEvent } from "./flow-triggers.service";

/** Trabajo diferido: «pasa tiempo sin respuesta» estando en una etapa. */
export interface StageNoReplyJob {
  orgId: string;
  automationId: string;
  dealId: string;
  contactId: string;
  conversationId: string;
  /** Nuestro último mensaje cuando se programó: si sigue siendo el último, nadie contestó. */
  messageId: string;
}

/** Trabajo diferido que actúa si la oportunidad sigue en la etapa: «entra a la etapa» con espera, o «aplicar a los que ya están». */
export interface StageDelayedJob {
  orgId: string;
  automationId: string;
  dealId: string;
  contactId: string;
}

type Automation = {
  id: string;
  orgId: string;
  stageId: string;
  trigger: string;
  flowId: string;
  delayMinutes: number | null;
  enabled: boolean;
  conditions: unknown;
};

/** «Aplicar a los que ya están»: uno cada tantos segundos, para no saturar WhatsApp ni el modelo. */
const APPLY_GAP_MS = 3_000;
/** Máximo de oportunidades por aplicación. */
const APPLY_LIMIT = 2_000;

/** Filtros guardados; lo irreconocible cuenta como «sin filtros». */
function conditionsOf(raw: unknown): StageAutomationConditions {
  const r = stageAutomationConditionsSchema.safeParse(raw ?? NO_CONDITIONS);
  return r.success ? r.data : NO_CONDITIONS;
}

/**
 * Automatizaciones de etapa (Ajustes › Embudos): en cada etapa, una lista
 * libre de «cuando pase X, ejecuta el flujo Y». Disparadores:
 *
 *  - enters_stage: la oportunidad llega a la etapa (a mano, por la IA, por un
 *    flujo o al crearse ahí).
 *  - inbound_message: el cliente escribe mientras su oportunidad está ahí.
 *  - webhook: un sistema externo llama a la URL de la automatización.
 *  - no_reply: pasan N minutos sin que el cliente conteste nuestro último
 *    mensaje, estando en la etapa. Una vez por estancia en la etapa.
 *
 * El flujo corre en la conversación abierta del contacto (o en una nueva);
 * si otro flujo está a medias (esperando respuesta), no arranca.
 */
@Injectable()
export class StageAutomationsService {
  private readonly logger = new Logger("StageAutomations");

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: FlowEngineService,
    @InjectQueue(QUEUE_FLOW) private readonly flowQueue: Queue,
  ) {}

  // ── Entra a la etapa ────────────────────────────────────────
  @OnEvent("deal.stage_changed", { async: true })
  async onStage(e: DealStageChangedEvent): Promise<void> {
    if (!e.orgId) return;
    try {
      await runInOrg(e.orgId, () => this.enteredStage(e));
    } catch (err) {
      this.logger.error(`Al entrar en la etapa ${e.stageId}: ${(err as Error).message}`);
    }
  }

  private async enteredStage(e: DealStageChangedEvent): Promise<void> {
    // Estancia nueva: lo que ya se disparó «una vez» puede volver a dispararse.
    await this.prisma.stageAutomationRun.deleteMany({ where: { dealId: e.dealId } });
    const autos = await this.automationsOf(e.stageId);
    if (!autos.length) return;

    for (const a of autos.filter((x) => x.trigger === "enters_stage")) {
      if (a.delayMinutes) {
        // Con espera: al vencer se comprueba que siga en la etapa (y los filtros).
        const data: StageDelayedJob = { orgId: a.orgId, automationId: a.id, dealId: e.dealId, contactId: e.contactId };
        await this.flowQueue.add("stage_enter_delay", data, {
          delay: a.delayMinutes * 60_000,
          jobId: `stage-enter-${a.id}-${e.dealId}-${Date.now()}`,
        });
      } else {
        await this.fire(a, e.dealId, e.contactId);
      }
    }

    // Si lo último que hay es un mensaje nuestro, el reloj del silencio ya corre.
    const quiet = autos.filter((x) => x.trigger === "no_reply");
    if (!quiet.length) return;
    const convo = await this.prisma.conversation.findFirst({
      where: { contactId: e.contactId, status: { not: "CLOSED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!convo) return;
    const last = await this.prisma.message.findFirst({
      where: { conversationId: convo.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, direction: true },
    });
    if (!last || last.direction !== "OUTBOUND") return;
    for (const a of quiet) {
      await this.schedule(a, { dealId: e.dealId, contactId: e.contactId, conversationId: convo.id, messageId: last.id });
    }
  }

  // ── Pasa tiempo sin respuesta ───────────────────────────────
  @OnEvent("message.outbound", { async: true })
  async onOutbound(e: MessageOutboundEvent): Promise<void> {
    if (!e.orgId) return;
    try {
      await runInOrg(e.orgId, async () => {
        const convo = await this.prisma.conversation.findUnique({
          where: { id: e.conversationId },
          select: { contactId: true },
        });
        if (!convo) return;
        const deal = await this.openDeal(convo.contactId);
        if (!deal) return;
        const quiet = (await this.automationsOf(deal.stageId)).filter((x) => x.trigger === "no_reply");
        for (const a of quiet) {
          await this.schedule(a, { dealId: deal.id, contactId: convo.contactId, conversationId: e.conversationId, messageId: e.messageId });
        }
      });
    } catch (err) {
      this.logger.error(`Al programar «sin respuesta» en ${e.conversationId}: ${(err as Error).message}`);
    }
  }

  private async schedule(
    a: Automation,
    ctx: { dealId: string; contactId: string; conversationId: string; messageId: string },
  ): Promise<void> {
    const data: StageNoReplyJob = { orgId: a.orgId, automationId: a.id, ...ctx };
    await this.flowQueue.add("stage_no_reply", data, {
      delay: (a.delayMinutes ?? 1440) * 60_000,
      jobId: `stage-no-reply-${a.id}-${ctx.messageId}`,
    });
  }

  /** Venció el plazo: ¿sigue en la etapa y sigue sin contestar? (lo llama el worker, ya en su empresa) */
  async checkNoReply(job: StageNoReplyJob): Promise<void> {
    const a = await this.prisma.stageAutomation.findUnique({ where: { id: job.automationId } });
    if (!a || !a.enabled || a.trigger !== "no_reply") return;
    const deal = await this.prisma.deal.findUnique({
      where: { id: job.dealId },
      select: { stageId: true, discardedAt: true, contactId: true },
    });
    if (!deal || deal.discardedAt || deal.stageId !== a.stageId) return;
    const last = await this.prisma.message.findFirst({
      where: { conversationId: job.conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    // Contestó, o le escribimos otra vez (ese mensaje trae su propio aviso).
    if (!last || last.id !== job.messageId) return;
    await this.fire(a, job.dealId, deal.contactId, {}, { once: true });
  }

  /**
   * Venció la espera de «entra a la etapa» (o le toca el turno en «aplicar a
   * los que ya están»): actúa si la oportunidad sigue abierta en la etapa.
   * Una vez por estancia: si sale y vuelve, cuenta como una estancia nueva.
   */
  async checkStillInStage(job: StageDelayedJob): Promise<void> {
    const a = await this.prisma.stageAutomation.findUnique({ where: { id: job.automationId } });
    if (!a || !a.enabled || a.trigger !== "enters_stage") return;
    const deal = await this.prisma.deal.findUnique({
      where: { id: job.dealId },
      select: { stageId: true, discardedAt: true, contactId: true },
    });
    if (!deal || deal.discardedAt || deal.stageId !== a.stageId) return;
    await this.fire(a, job.dealId, deal.contactId, {}, { once: true });
  }

  // ── Lanzar un flujo a varias oportunidades (desde el tablero) ──
  async queueFlowForDeals(ids: string[], flowId: string): Promise<{ queued: number; gapSeconds: number }> {
    const flow = await this.prisma.flow.findUnique({ where: { id: flowId }, select: { id: true, isActive: true } });
    if (!flow) throw new NotFoundException("Ese flujo no existe");
    if (!flow.isActive) throw new BadRequestException("Ese flujo está desactivado: actívalo en Flujos.");
    const deals = await this.prisma.deal.findMany({ where: { id: { in: ids } }, select: { contactId: true, orgId: true } });
    // Un contacto con dos oportunidades recibe el flujo una vez.
    const contacts = [...new Map(deals.map((d) => [d.contactId, d.orgId])).entries()];
    const stamp = Date.now();
    for (let i = 0; i < contacts.length; i++) {
      const [contactId, orgId] = contacts[i]!;
      await this.flowQueue.add(
        "bulk_flow",
        { orgId, flowId, contactId },
        { delay: i * APPLY_GAP_MS, jobId: `bulk-flow-${flowId}-${contactId}-${stamp}` },
      );
    }
    this.logger.log(`Flujo ${flowId} lanzado a ${contacts.length} contactos desde el tablero`);
    return { queued: contacts.length, gapSeconds: APPLY_GAP_MS / 1000 };
  }

  /** Turno de un contacto en «lanzar flujo a varias». */
  async runBulkFlow(job: { flowId: string; contactId: string }): Promise<void> {
    const started = await this.engine.runFlowForContact(job.flowId, job.contactId);
    this.logger.log(`Flujo ${job.flowId} desde el tablero: ${started ? "iniciado" : "no arrancó"} para ${job.contactId}`);
  }

  // ── Aplicar a los que ya están en la etapa ──────────────────
  private async existingTargets(id: string) {
    const a = await this.prisma.stageAutomation.findUnique({ where: { id } });
    if (!a) throw new NotFoundException("Automatización no encontrada");
    if (a.trigger !== "enters_stage") {
      throw new BadRequestException("Solo las automatizaciones de «Entra a la etapa» se pueden aplicar a quien ya está en ella.");
    }
    const deals = await this.prisma.deal.findMany({
      where: { stageId: a.stageId, discardedAt: null },
      orderBy: { updatedAt: "asc" },
      select: { id: true, contactId: true },
      take: APPLY_LIMIT * 2,
    });
    const cond = conditionsOf(a.conditions);
    const matching: { id: string; contactId: string }[] = [];
    for (const d of deals) {
      if (await this.engine.contactRulesMatch(d.contactId, cond.rules, cond.match)) matching.push(d);
    }
    const ran = new Set(
      (
        await this.prisma.stageAutomationRun.findMany({
          where: { automationId: a.id, dealId: { in: matching.map((d) => d.id) } },
          select: { dealId: true },
        })
      ).map((r) => r.dealId),
    );
    return { a, total: deals.length, matching, toRun: matching.filter((d) => !ran.has(d.id)), alreadyRan: ran.size };
  }

  async previewExisting(id: string): Promise<StageAutomationExisting> {
    const t = await this.existingTargets(id);
    return {
      total: t.total,
      matching: t.matching.length,
      alreadyRan: t.alreadyRan,
      toRun: Math.min(t.toRun.length, APPLY_LIMIT),
      gapSeconds: APPLY_GAP_MS / 1000,
      limit: APPLY_LIMIT,
    };
  }

  /** Encola el flujo para cada una, escalonado. Se vuelve a comprobar todo en el momento de actuar. */
  async applyExisting(id: string): Promise<StageAutomationApplyResult> {
    const t = await this.existingTargets(id);
    if (!t.a.enabled) throw new BadRequestException("La automatización está pausada: actívala antes de aplicarla.");
    const batch = t.toRun.slice(0, APPLY_LIMIT);
    const stamp = Date.now();
    for (let i = 0; i < batch.length; i++) {
      const d = batch[i]!;
      const data: StageDelayedJob = { orgId: t.a.orgId, automationId: t.a.id, dealId: d.id, contactId: d.contactId };
      await this.flowQueue.add("stage_apply", data, { delay: i * APPLY_GAP_MS, jobId: `stage-apply-${t.a.id}-${d.id}-${stamp}` });
    }
    this.logger.log(`Automatización ${t.a.id}: aplicada a ${batch.length} oportunidades que ya estaban en la etapa`);
    return { queued: batch.length, skipped: t.matching.length - batch.length };
  }

  // ── Llega un mensaje del cliente ────────────────────────────
  /** true si algún flujo de etapa arrancó (la IA no debe responder ese turno). */
  async onInbound(conversationId: string): Promise<boolean> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true },
    });
    if (!convo) return false;
    const deal = await this.openDeal(convo.contactId);
    if (!deal) return false;
    let ran = false;
    for (const a of (await this.automationsOf(deal.stageId)).filter((x) => x.trigger === "inbound_message")) {
      ran = (await this.fire(a, deal.id, convo.contactId)) || ran;
    }
    return ran;
  }

  // ── Webhook entrante ────────────────────────────────────────
  async onWebhook(
    token: string,
    body: StageWebhookBody,
  ): Promise<{ started: boolean; reason?: string }> {
    // Sin empresa todavía: el token es lo que la identifica.
    const a = await runUnscoped("webhook de etapa: empresa por token", () =>
      this.prisma.stageAutomation.findUnique({ where: { token } }),
    );
    if (!a || a.trigger !== "webhook") throw new NotFoundException("Webhook no encontrado");
    return runInOrg(a.orgId, async () => {
      if (!a.enabled) return { started: false, reason: "automation_disabled" };
      const contact = await this.findContact(body);
      if (!contact) return { started: false, reason: "contact_not_found" };
      const deal = await this.openDeal(contact.id);
      if (!deal) return { started: false, reason: "no_open_deal" };
      if (deal.stageId !== a.stageId) return { started: false, reason: "not_in_stage" };
      const started = await this.fire(a, deal.id, contact.id, body.vars ?? {});
      return started ? { started } : { started, reason: "flow_inactive_or_busy" };
    });
  }

  private async findContact(body: StageWebhookBody) {
    if (body.contactId) {
      return this.prisma.contact.findUnique({ where: { id: body.contactId }, select: { id: true } });
    }
    if (body.phone) {
      const digits = body.phone.replace(/[^\d]/g, "");
      if (!digits) return null;
      return this.prisma.contact.findFirst({
        where: { OR: [{ phone: `+${digits}` }, { phone: digits }, { phone: body.phone.trim() }] },
        select: { id: true },
      });
    }
    return null;
  }

  // ── Comunes ─────────────────────────────────────────────────
  private automationsOf(stageId: string): Promise<Automation[]> {
    return this.prisma.stageAutomation.findMany({
      where: { stageId, enabled: true },
      orderBy: { order: "asc" },
      select: { id: true, orgId: true, stageId: true, trigger: true, flowId: true, delayMinutes: true, enabled: true, conditions: true },
    });
  }

  private openDeal(contactId: string) {
    return this.prisma.deal.findFirst({
      where: { contactId, discardedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, stageId: true },
    });
  }

  /**
   * Ejecuta el flujo de la automatización para el contacto. Con `once`, solo
   * una vez por estancia en la etapa (la fila de «runs» es el candado).
   */
  private async fire(
    a: Automation,
    dealId: string,
    contactId: string,
    vars: Record<string, string> = {},
    opts: { once?: boolean } = {},
  ): Promise<boolean> {
    // Filtros de la automatización: con quien no los cumple, no hace nada.
    const cond = conditionsOf(a.conditions);
    if (cond.rules.length && !(await this.engine.contactRulesMatch(contactId, cond.rules, cond.match))) {
      this.logger.log(`Automatización ${a.trigger} de la etapa ${a.stageId}: ${contactId} no cumple los filtros`);
      return false;
    }
    if (opts.once) {
      try {
        await this.prisma.stageAutomationRun.create({ data: { orgId: a.orgId, automationId: a.id, dealId } });
      } catch {
        return false; // ya corrió en esta estancia
      }
    }
    const started = await this.engine.runFlowForContact(a.flowId, contactId, vars);
    this.logger.log(
      `Automatización ${a.trigger} de la etapa ${a.stageId}: flujo ${a.flowId} ${started ? "iniciado" : "no arrancó"} para ${contactId}`,
    );
    return started;
  }
}
