import { Inject, Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  AiMode,
  ConversationStatus,
  MessageAuthor,
  MessageType,
  contactCurrency,
  countryFromPhone,
  type FlowBranch,
  type FlowEdge,
  type FlowNode,
  type FlowRule,
  type FlowTrigger,
  type FlowTriggerType,
  templateVarCount,
} from "@crm/shared";
import { isWithinHours } from "../../common/utils/business-hours";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runAsActor } from "../../infra/tenant/actor";
import { currentOrgId } from "../../infra/tenant/tenant.context";
import { TenantService } from "../../infra/tenant/tenant.service";
import { QUEUE_FLOW } from "../../infra/queue/queue.constants";
import { MessagingService } from "../messaging/messaging.service";
import { AutopilotService } from "./autopilot.service";
import { parseTriggers } from "./flow.service";
import { MediaUnderstandingService } from "./media-understanding.service";

const MAX_STEPS = 50; // cortafuegos anti-bucle

type Vars = Record<string, string>;

/** Lo último que escribió el contacto: texto y, si pulsó un botón, su id. */
interface Inbound {
  text: string;
  payload: string | null;
  /** El mensaje llegó tras un clic en un anuncio Click-to-WhatsApp. */
  fromAd?: boolean;
  /** Cuándo llegó. */
  at?: Date;
}

/** Todo lo que puede mirar una condición, cargado una vez por bloque. */
interface CondCtx {
  text: string;
  vars: Vars;
  contact: { name: string | null; phone: string; tags: string[]; sourceId: string | null; fields: Record<string, string> };
  convo: { status: string; assignedAgentId: string | null; channelId: string | null; aiMode: string };
  stageId: string | null;
  /** Valor de su oportunidad abierta, o null. */
  dealValue: number | null;
  /** Responsable de su oportunidad abierta, o null. */
  dealOwnerId: string | null;
  inboundCount: number;
  /** País por el prefijo del teléfono (código ISO), o null si no se reconoce. */
  country: string | null;
}

// Qué decir cuando la respuesta no pasa la validación (si el bloque no trae texto propio).
const RETRY_TEXT: Record<string, string> = {
  phone: "No reconocí un número de teléfono. ¿Me lo escribes con código de país? (ej. +51 999 999 999)",
  email: "Ese correo no parece válido. ¿Me lo escribes de nuevo?",
  number: "Necesito un número. ¿Me lo escribes en cifras?",
  regex: "No entendí tu respuesta. ¿Me la repites?",
  any: "No entendí tu respuesta. ¿Me la repites?",
};

/**
 * Motor de ejecución de flujos visuales. Recorre el grafo (nodos + aristas)
 * por cada conversación, manteniendo el estado en FlowSession:
 *  - envía mensajes, hace preguntas (y espera la respuesta), ramifica por
 *    condición y ejecuta acciones (IA, handoff, etiqueta, mover deal).
 * Tiene prioridad sobre el autopilot mientras la sesión está activa.
 */
@Injectable()
export class FlowEngineService {
  private readonly logger = new Logger("FlowEngine");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly messaging: MessagingService,
    private readonly autopilot: AutopilotService,
    @InjectQueue(QUEUE_FLOW) private readonly flowQueue: Queue,
    private readonly events: EventEmitter2,
  ) {}

  // ── Conversación nueva: ¿arranca un flujo "al iniciar"? ─────
  async onCreated(conversationId: string): Promise<boolean> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });
    if (!convo || !convo.contact.optIn) return false;
    const ctx = () => this.condCtx(conversationId, "", {});

    // Nace desde un anuncio Click-to-WhatsApp: ese disparador va primero.
    if (convo.referral) {
      const ad = await this.firstPassing(await this.candidates(convo.channelId, "ad_click"), ctx);
      if (ad) {
        await this.startFlow(ad.flow, conversationId, "");
        return true;
      }
    }

    const hit = await this.firstPassing(await this.candidates(convo.channelId, "conversation_start"), ctx);
    if (!hit) return false;
    await this.startFlow(hit.flow, conversationId, "");
    return true;
  }

  // ── Disparadores por eventos del CRM (no por un mensaje) ────
  /** Lead nuevo: de un formulario de Meta Lead Ads, o por webhook/API. */
  async onLead(
    contactId: string,
    via: "meta" | "webhook" | "api",
    form: { formName: string | null; formId: string | null },
  ): Promise<void> {
    const type: FlowTriggerType = via === "meta" ? "meta_lead" : "lead_webhook";
    await this.onContactEvent(contactId, type, (t) => {
      if (type !== "meta_lead" || t.config.forms.length === 0) return true;
      const wanted = t.config.forms.map((x) => x.toLowerCase());
      return [form.formName, form.formId].some((v) => !!v && wanted.includes(v.toLowerCase()));
    });
  }

  async onTagAdded(contactId: string, tag: string): Promise<void> {
    await this.onContactEvent(contactId, "tag_added", (t) => tagMatches(t, tag), { tag });
  }

  async onTagRemoved(contactId: string, tag: string): Promise<void> {
    await this.onContactEvent(contactId, "tag_removed", (t) => tagMatches(t, tag), { tag });
  }

  async onDealStage(contactId: string, stageId: string): Promise<void> {
    await this.onContactEvent(
      contactId,
      "deal_stage",
      (t) => t.config.stageIds.length === 0 || t.config.stageIds.includes(stageId),
      { stageId },
    );
  }

  /** Cambió el responsable de su oportunidad (a mano, en bloque, la IA). */
  async onOwnerChanged(contactId: string, ownerId: string | null): Promise<void> {
    await this.onContactEvent(contactId, "owner_changed", () => true, { ownerId });
  }

  /** Llamada telefónica que nadie contestó: p. ej. escribirle por WhatsApp. */
  async onMissedCall(contactId: string): Promise<void> {
    await this.onContactEvent(contactId, "missed_call", () => true);
  }

  async onClosed(conversationId: string): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });
    if (!convo || !convo.contact.optIn) return;
    const hits = await this.candidates(convo.channelId, "conversation_closed");
    for (const h of hits.filter((x) => x.trigger.delayMin > 0)) {
      await this.scheduleTrigger(h, convo.orgId, convo.contactId, conversationId, {});
    }
    const now = await this.firstPassing(
      hits.filter((x) => x.trigger.delayMin === 0),
      () => this.condCtx(conversationId, "", {}),
    );
    if (now) await this.startIfIdle(now.flow, conversationId);
  }

  /**
   * Le escribimos (una persona, la IA o un flujo): por cada disparador «sin
   * respuesta», se programa la comprobación para dentro de sus horas. Sus
   * condiciones y su horario se miran al vencer, que es cuando arrancaría.
   */
  async onOutbound(conversationId: string, messageId: string, _author: string): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channelId: true, orgId: true },
    });
    if (!convo) return;
    for (const h of await this.candidates(convo.channelId, "no_reply")) {
      await this.flowQueue.add(
        "no_reply",
        { conversationId, orgId: convo.orgId, messageId, flowId: h.flow.id, triggerId: h.trigger.id },
        { delay: h.trigger.config.hours * 3600_000, jobId: `no-reply-${messageId}-${h.flow.id}-${h.trigger.id}` },
      );
    }
  }

  /** Venció el plazo: ¿sigue sin contestar y sigue siendo nuestro último mensaje? */
  async checkNoReply(conversationId: string, messageId: string, flowId?: string, triggerId?: string): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });
    if (!convo || !convo.contact.optIn || convo.status === ConversationStatus.CLOSED) return;
    // Desempate por id (cuid, creciente): dos mensajes en el mismo milisegundo
    // no deben decidir al azar cuál fue el último.
    const last = await this.prisma.message.findFirst({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    // Respondió, o le escribimos otra vez (ese mensaje trae su propio aviso).
    if (!last || last.id !== messageId) return;
    // El flujo y el disparador que lo programaron, si siguen ahí; los trabajos
    // anteriores no los traen y se busca como antes.
    const programmed = flowId ? await this.loadFlow(flowId) : null;
    const hit: Hit | null = programmed
      ? (() => {
          const trigger = programmed.triggers.find((t) => t.type === "no_reply" && (!triggerId || t.id === triggerId));
          return trigger ? { flow: programmed, trigger } : null;
        })()
      : ((await this.candidates(convo.channelId, "no_reply"))[0] ?? null);
    if (!hit) return;
    if (!(await this.firstPassing([hit], () => this.condCtx(conversationId, "", {})))) return;
    const flow = hit.flow;
    // Una vez por silencio: si este flujo ya corrió desde el último mensaje
    // del cliente, no se repite (si no, se dispararía con sus propios mensajes).
    const [session, lastInbound] = await Promise.all([
      this.prisma.flowSession.findUnique({ where: { conversationId } }),
      this.prisma.message.findFirst({
        where: { conversationId, direction: "INBOUND" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true },
      }),
    ]);
    if (session && session.flowId === flow.id && (!lastInbound || session.updatedAt > lastInbound.createdAt)) return;
    await this.startIfIdle(flow, conversationId);
  }

  /**
   * Un evento del contacto (lead, etiqueta, etapa, responsable) se atiende en
   * su conversación abierta más reciente; si no tiene, se abre una. Así el
   * flujo puede etiquetar, mover el embudo, avisar por HTTP o mandarle una
   * plantilla. Los disparadores con espera se programan; los demás arrancan
   * ya, el primero que cumpla sus condiciones y su horario.
   */
  private async onContactEvent(
    contactId: string,
    type: FlowTriggerType,
    pick: (t: FlowTrigger) => boolean,
    event: TriggerEvent = {},
  ): Promise<void> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { optIn: true, orgId: true },
    });
    if (!contact?.optIn) return;
    const open = await this.prisma.conversation.findFirst({
      where: { contactId, status: { not: ConversationStatus.CLOSED } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, channelId: true },
    });
    const hits = await this.candidates(open?.channelId ?? null, type, pick);
    if (!hits.length) return;
    for (const h of hits.filter((x) => x.trigger.delayMin > 0)) {
      await this.scheduleTrigger(h, contact.orgId, contactId, open?.id ?? null, event);
    }
    const now = await this.firstPassing(
      hits.filter((x) => x.trigger.delayMin === 0),
      () => this.contactCtx(contactId),
    );
    if (!now) return;
    const conversationId =
      open?.id ??
      (
        await this.prisma.conversation.create({
          data: { orgId: contact.orgId, contactId, status: ConversationStatus.OPEN },
        })
      ).id;
    await this.startIfIdle(now.flow, conversationId);
  }

  /** «A los 10 min», «al día siguiente»: el arranque queda en la cola. */
  private async scheduleTrigger(
    h: Hit,
    orgId: string,
    contactId: string,
    conversationId: string | null,
    event: TriggerEvent,
  ): Promise<void> {
    const job: DelayedTriggerJob = { orgId, flowId: h.flow.id, triggerId: h.trigger.id, contactId, conversationId, event };
    await this.flowQueue.add("trigger_delay", job, {
      delay: h.trigger.delayMin * 60_000,
      jobId: `trg-${h.flow.id}-${h.trigger.id}-${contactId}-${Date.now()}`,
    });
  }

  /**
   * Venció la espera de un disparador: arranca si el flujo sigue activo con
   * ese disparador, si el evento sigue valiendo (sigue en la etapa, sigue con
   * o sin la etiqueta, mismo responsable) y si cumple sus condiciones y su
   * horario ahora.
   */
  async runDelayedTrigger(d: DelayedTriggerJob): Promise<boolean> {
    const flow = await this.loadFlow(d.flowId);
    const trigger = flow?.triggers.find((t) => t.id === d.triggerId);
    if (!flow || !trigger) return false;
    const contact = await this.prisma.contact.findUnique({
      where: { id: d.contactId },
      select: { optIn: true, orgId: true },
    });
    if (!contact?.optIn) return false;
    if (!(await this.stillHolds(trigger, d))) return false;
    if (!(await this.firstPassing([{ flow, trigger }], () => this.contactCtx(d.contactId)))) return false;
    const reuse = d.conversationId
      ? await this.prisma.conversation.findUnique({ where: { id: d.conversationId }, select: { id: true } })
      : null;
    const open =
      reuse ??
      (await this.prisma.conversation.findFirst({
        where: { contactId: d.contactId, status: { not: ConversationStatus.CLOSED } },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      }));
    const conversationId =
      open?.id ??
      (
        await this.prisma.conversation.create({
          data: { orgId: contact.orgId, contactId: d.contactId, status: ConversationStatus.OPEN },
        })
      ).id;
    return this.startIfIdle(flow, conversationId);
  }

  private async stillHolds(t: FlowTrigger, d: DelayedTriggerJob): Promise<boolean> {
    if (t.type === "deal_stage" || t.type === "owner_changed") {
      const deal = await this.prisma.deal.findFirst({
        where: { contactId: d.contactId, discardedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { stageId: true, ownerId: true },
      });
      return t.type === "deal_stage" ? deal?.stageId === d.event.stageId : (deal?.ownerId ?? null) === (d.event.ownerId ?? null);
    }
    if ((t.type === "tag_added" || t.type === "tag_removed") && d.event.tag) {
      const has = await this.prisma.contactTag.count({
        where: { contactId: d.contactId, tag: { name: { equals: d.event.tag, mode: "insensitive" } } },
      });
      return t.type === "tag_added" ? has > 0 : has === 0;
    }
    return true;
  }

  /**
   * De los disparadores candidatos (ya filtrados por su evento), el primero
   * que está en su horario y cumple sus condiciones. El contexto de las
   * condiciones se carga una sola vez y solo si alguna lo necesita.
   */
  private async firstPassing(hits: Hit[], ctx: () => Promise<CondCtx>): Promise<Hit | null> {
    let loaded: CondCtx | null = null;
    for (const h of hits) {
      if (h.trigger.activeHours && !isWithinHours(h.trigger.activeHours)) continue;
      const { rules, match } = h.trigger.conditions;
      if (rules.length) {
        loaded ??= await ctx();
        const results = rules.map((r) => this.ruleMatches(r, loaded!));
        if (!(match === "any" ? results.some(Boolean) : results.every(Boolean))) continue;
      }
      return h;
    }
    return null;
  }

  /** Contexto de las condiciones para un contacto: su conversación más reciente o, sin ella, su ficha. */
  private async contactCtx(contactId: string): Promise<CondCtx> {
    const convo = await this.prisma.conversation.findFirst({
      where: { contactId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    return convo ? this.condCtx(convo.id, "", {}) : this.contactOnlyCtx(contactId);
  }

  /**
   * Un flujo concreto para un contacto, venga de donde venga la orden
   * (automatizaciones de etapa, webhooks). Corre en su conversación abierta
   * más reciente o en una nueva. true si arrancó.
   */
  async runFlowForContact(flowId: string, contactId: string, vars: Vars = {}): Promise<boolean> {
    const flow = await this.loadFlow(flowId);
    if (!flow) return false;
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { optIn: true, orgId: true },
    });
    if (!contact?.optIn) return false;
    const open = await this.prisma.conversation.findFirst({
      where: { contactId, status: { not: ConversationStatus.CLOSED } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    const conversationId =
      open?.id ??
      (
        await this.prisma.conversation.create({
          data: { orgId: contact.orgId, contactId, status: ConversationStatus.OPEN },
        })
      ).id;
    return this.startIfIdle(flow, conversationId, vars);
  }

  /** Arranca el flujo salvo que otro esté a medias (esperando respuesta o un temporizador). */
  private async startIfIdle(flow: FlowRow, conversationId: string, vars: Vars = {}): Promise<boolean> {
    const session = await this.prisma.flowSession.findUnique({ where: { conversationId } });
    const busy =
      !!session &&
      (session.status === "waiting_timer" || (session.status === "running" && !!session.currentNodeId));
    if (busy) {
      this.logger.log(`Flujo "${flow.name}" no arranca en ${conversationId}: hay otro flujo a medias`);
      return false;
    }
    await this.startFlow(flow, conversationId, await this.lastInboundText(conversationId), vars);
    return true;
  }

  // ── Entrante: reanudar sesión o disparar flujo por palabra ──
  // Devuelve true si el flujo manejó el mensaje (el autopilot no debe correr).
  async onInbound(conversationId: string): Promise<boolean> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });
    if (!convo || !convo.contact.optIn) return false;

    const inbound = await this.lastInbound(conversationId);
    const text = inbound.text;
    const session = await this.prisma.flowSession.findUnique({
      where: { conversationId },
    });

    // Flujo pausado en un "Esperar": ignorar el mensaje hasta que venza el timer.
    if (session && session.status === "waiting_timer") return true;

    // Sesión esperando respuesta (pregunta o botones) → reanudar. Un mensaje
    // de antes de que se pusiera a esperar (el que arrancó el flujo, si llega
    // tarde) no es la respuesta: ya está atendido.
    if (session && session.status === "running" && session.currentNodeId && inbound.at && inbound.at < session.updatedAt) {
      return true;
    }
    if (session && session.status === "running" && session.currentNodeId) {
      const flow = await this.loadFlow(session.flowId);
      if (!flow) return false;
      await this.resume(flow, conversationId, session.currentNodeId, inbound, {
        ...((session.variables as Vars | null) ?? {}),
      });
      return true;
    }

    // Sin sesión activa y de vuelta por un anuncio con el chat ya abierto: su
    // flujo «desde un anuncio». En una conversación nueva ya lo arrancó onCreated.
    const ctx = () => this.condCtx(conversationId, text, {});
    if (inbound.fromAd) {
      const inbounds = await this.prisma.message.count({ where: { conversationId, direction: "INBOUND" } });
      const ad = inbounds > 1 ? await this.firstPassing(await this.candidates(convo.channelId, "ad_click"), ctx) : null;
      if (ad) {
        await this.startFlow(ad.flow, conversationId, text);
        return true;
      }
    }

    // ¿Algún flujo por palabra clave coincide?
    const t = text.toLowerCase();
    const hit = t
      ? await this.firstPassing(
          await this.candidates(convo.channelId, "keyword", (k) => k.keywords.some((w) => t.includes(w.toLowerCase()))),
          ctx,
        )
      : null;
    if (hit) {
      await this.startFlow(hit.flow, conversationId, text);
      return true;
    }

    // «Llega un mensaje del cliente»: cualquiera, con una pausa mínima entre
    // arranques del mismo flujo en esta conversación.
    const recent = (h: Hit) =>
      !!session &&
      session.flowId === h.flow.id &&
      !!session.startedAt &&
      Date.now() - session.startedAt.getTime() < h.trigger.config.cooldownMin * 60_000;
    const any = await this.firstPassing(
      (await this.candidates(convo.channelId, "inbound_message")).filter((h) => !recent(h)),
      ctx,
    );
    if (any) {
      await this.startFlow(any.flow, conversationId, text);
      return true;
    }
    return false;
  }

  // ── Arranque / reanudación ──────────────────────────────────
  private async startFlow(
    flow: FlowRow,
    conversationId: string,
    lastText: string,
    vars: Vars = {},
  ): Promise<void> {
    await this.prisma.flowSession.upsert({
      where: { conversationId },
      create: {
        conversationId,
        flowId: flow.id,
        variables: vars,
        status: "running",
        startedAt: new Date(),
      },
      update: {
        flowId: flow.id,
        variables: vars,
        status: "running",
        currentNodeId: null,
        startedAt: new Date(),
      },
    });
    const start = flow.nodes.find((n) => n.type === "start");
    const firstId = start
      ? this.nextNodeId(flow.edges, start.id)
      : (flow.nodes[0]?.id ?? null);
    this.logger.log(`Flujo "${flow.name}" iniciado en ${conversationId}`);
    try {
      await this.walk(flow, conversationId, firstId, lastText, { ...vars });
    } catch (e) {
      // Un bloque que falla (p. ej. un mensaje fuera de la ventana de 24 h)
      // no deja la sesión colgada en "running": queda parada, en el log y,
      // para que el equipo sepa por qué no siguió, como nota en el chat.
      await this.stopped(flow, conversationId, {}, e);
    }
  }

  private async resume(
    flow: FlowRow,
    conversationId: string,
    waitingNodeId: string,
    inbound: Inbound,
    vars: Vars,
  ): Promise<void> {
    const node = flow.nodes.find((n) => n.id === waitingNodeId);
    const text = inbound.text;
    try {
      if (node?.type === "askQuestion") {
        const check = this.validateAnswer(node, text);
        if (!check.ok) {
          // Respuesta que no vale: se repite la pregunta hasta agotar los
          // intentos; después sigue por la salida "no válida" (o la normal).
          const tries = Number(vars.__retries ?? 0) + 1;
          const max = node.data.maxRetries ?? 2;
          if (tries <= max) {
            vars.__retries = String(tries);
            const retry = node.data.retryText?.trim() || RETRY_TEXT[node.data.validate ?? "any"]!;
            await this.send(conversationId, this.interpolate(retry, vars));
            await this.persist(conversationId, node.id, vars, "running");
            return;
          }
          delete vars.__retries;
          if (node.data.variable) vars[node.data.variable] = text;
          await this.walk(flow, conversationId, this.nextNodeId(flow.edges, node.id, "invalid"), text, vars);
          return;
        }
        delete vars.__retries;
        if (node.data.variable) vars[node.data.variable] = check.value;
      }
      if (node?.type === "buttons" || node?.type === "list") {
        const handle = this.matchButton(node, inbound);
        if (node.data.variable) vars[node.data.variable] = text;
        await this.walk(flow, conversationId, this.nextNodeId(flow.edges, node.id, handle), text, vars);
        return;
      }
      if (node?.type === "carousel") {
        const handle = this.matchCard(node, inbound);
        if (node.data.variable) vars[node.data.variable] = text;
        await this.walk(flow, conversationId, this.nextNodeId(flow.edges, node.id, handle), text, vars);
        return;
      }
      const nextId = node ? this.nextNodeId(flow.edges, node.id) : null;
      await this.walk(flow, conversationId, nextId, text, vars);
    } catch (e) {
      await this.stopped(flow, conversationId, vars, e);
    }
  }

  private async stopped(flow: FlowRow, conversationId: string, vars: Vars, e: unknown): Promise<void> {
    const reason = (e as Error).message;
    this.logger.warn(`Flujo "${flow.name}" se detuvo en ${conversationId}: ${reason}`);
    await this.persist(conversationId, null, vars, "stopped").catch(() => undefined);
    await this.addNote(flow, conversationId, `se detuvo: ${reason}`).catch(() => undefined);
  }

  /** ¿La respuesta pasa la validación del bloque? Devuelve el valor normalizado. */
  private validateAnswer(node: FlowNode, text: string): { ok: boolean; value: string } {
    const kind = node.data.validate ?? "any";
    const t = text.trim();
    if (kind === "any") return { ok: true, value: t };
    if (!t) return { ok: false, value: t };
    if (kind === "phone") {
      const digits = t.replace(/[^\d+]/g, "");
      return { ok: digits.replace(/\D/g, "").length >= 7, value: digits };
    }
    if (kind === "email") {
      const m = t.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
      return { ok: !!m, value: m ? m[0].toLowerCase() : t };
    }
    if (kind === "number") {
      const m = t.replace(/\s/g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
      return { ok: !!m, value: m ? m[0] : t };
    }
    if (kind === "regex") {
      try {
        return { ok: new RegExp(node.data.pattern ?? "", "i").test(t), value: t };
      } catch {
        return { ok: true, value: t };
      }
    }
    return { ok: true, value: t };
  }

  /** Qué botón pulsó: por id (webhook), por título o por número de opción. */
  private matchButton(node: FlowNode, inbound: Inbound): string {
    const buttons = node.data.buttons ?? [];
    if (inbound.payload) {
      const byId = buttons.find((b) => b.id === inbound.payload);
      if (byId) return byId.id;
    }
    const t = inbound.text.trim().toLowerCase();
    const byTitle = buttons.find((b) => b.title.trim().toLowerCase() === t);
    if (byTitle) return byTitle.id;
    const n = Number.parseInt(t, 10);
    if (n >= 1 && buttons[n - 1]) return buttons[n - 1]!.id;
    return "else";
  }

  private matchCard(node: FlowNode, inbound: Inbound): string {
    const cards = node.data.cards ?? [];
    if (inbound.payload) {
      const byId = cards.find((c) => c.id === inbound.payload);
      if (byId) return byId.id;
    }
    const t = inbound.text.trim().toLowerCase();
    const byTitle = cards.find((c) => (c.buttonTitle ?? "").trim().toLowerCase() === t || (c.text ?? "").trim().toLowerCase() === t);
    if (byTitle) return byTitle.id;
    const n = Number.parseInt(t, 10);
    if (n >= 1 && cards[n - 1]) return cards[n - 1]!.id;
    return "else";
  }

  // ── Recorrido del grafo ─────────────────────────────────────
  private async walk(
    flow: FlowRow,
    conversationId: string,
    startId: string | null,
    lastText: string,
    vars: Vars,
  ): Promise<void> {
    // Lo que cambie en las oportunidades queda firmado con este flujo.
    return runAsActor(`flow:${flow.id}`, () => this.walkGraph(flow, conversationId, startId, lastText, vars));
  }

  private async walkGraph(
    flow: FlowRow,
    conversationId: string,
    startId: string | null,
    lastText: string,
    vars: Vars,
  ): Promise<void> {
    let current = startId;
    let steps = 0;

    while (current && steps < MAX_STEPS) {
      steps++;
      const node = flow.nodes.find((n) => n.id === current);
      if (!node) break;

      if (node.type === "start") {
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "sendMessage") {
        await this.sendMessageNode(conversationId, node, vars);
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "buttons") {
        await this.sendButtons(conversationId, node, vars);
        // Esperar a que pulse (o escriba): persistir el nodo actual y parar.
        await this.persist(conversationId, node.id, vars, "running");
        return;
      }

      if (node.type === "list") {
        await this.sendList(conversationId, node, vars);
        await this.persist(conversationId, node.id, vars, "running");
        return;
      }

      if (node.type === "carousel") {
        await this.sendCarousel(conversationId, node, vars);
        // Con enlaces no hay nada que esperar: sigue. Con respuestas, espera la elección.
        if ((node.data.cardMode ?? "reply") === "url") {
          current = this.nextNodeId(flow.edges, node.id);
          continue;
        }
        await this.persist(conversationId, node.id, vars, "running");
        return;
      }

      if (node.type === "setField") {
        await this.setField(conversationId, node, vars);
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "addNote") {
        await this.addNote(flow, conversationId, this.interpolate(node.data.text, vars));
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "setStatus") {
        if (node.data.status) {
          await this.messaging
            .setStatus(conversationId, node.data.status as ConversationStatus)
            .catch(() => undefined);
        }
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "split") {
        current = this.nextNodeId(flow.edges, node.id, this.pickSplit(node));
        continue;
      }

      if (node.type === "schedule") {
        const inside = node.data.hours ? isWithinHours(node.data.hours) : true;
        current = this.nextNodeId(flow.edges, node.id, inside ? "in" : "out");
        continue;
      }

      if (node.type === "sendTemplate") {
        await this.sendTemplate(flow, conversationId, node, vars);
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "askQuestion") {
        await this.send(conversationId, this.interpolate(node.data.text, vars));
        // Esperar la respuesta: persistir el nodo actual y parar.
        await this.persist(conversationId, node.id, vars, "running");
        return;
      }

      if (node.type === "condition") {
        const ctx = await this.condCtx(conversationId, lastText, vars);
        const handle = this.evalCondition(node, ctx);
        current = this.nextNodeId(flow.edges, node.id, handle);
        continue;
      }

      if (node.type === "action") {
        const stop = await this.execAction(node, conversationId, vars);
        if (stop) {
          await this.persist(conversationId, null, vars, "stopped");
          return;
        }
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "delay") {
        // Pausar: persistir el siguiente nodo y programar la reanudación.
        const nextId = this.nextNodeId(flow.edges, node.id);
        const ms = this.delayMs(node);
        if (!nextId || ms <= 0) {
          current = nextId;
          continue;
        }
        await this.persist(conversationId, nextId, vars, "waiting_timer");
        await this.flowQueue.add(
          "resume",
          // La empresa viaja en el trabajo: el worker no tiene otra forma de
          // saberla sin consultar la conversación.
          { conversationId, orgId: currentOrgId() ?? undefined },
          { delay: ms },
        );
        return;
      }

      if (node.type === "http") {
        await this.execHttp(node, vars);
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "assign") {
        if (node.data.agentId) {
          await this.messaging
            .assignConversation(conversationId, node.data.agentId)
            .catch(() => undefined);
        }
        current = this.nextNodeId(flow.edges, node.id);
        continue;
      }

      if (node.type === "jumpToFlow") {
        const target = node.data.flowId
          ? await this.loadFlow(node.data.flowId)
          : null;
        if (!target) break;
        await this.prisma.flowSession.update({
          where: { conversationId },
          data: { flowId: target.id },
        });
        const start = target.nodes.find((n) => n.type === "start");
        const firstId = start
          ? this.nextNodeId(target.edges, start.id)
          : (target.nodes[0]?.id ?? null);
        await this.walk(target, conversationId, firstId, lastText, vars);
        return;
      }

      break;
    }

    // Fin del flujo (sin más nodos): completado.
    await this.persist(conversationId, null, vars, "completed");
  }

  // Reanuda un flujo tras vencer un bloque "Esperar".
  async resumeTimer(conversationId: string): Promise<void> {
    const session = await this.prisma.flowSession.findUnique({
      where: { conversationId },
    });
    if (!session || session.status !== "waiting_timer" || !session.currentNodeId) {
      return;
    }
    const flow = await this.loadFlow(session.flowId);
    if (!flow) return;
    const text = await this.lastInboundText(conversationId);
    await this.persist(
      conversationId,
      session.currentNodeId,
      { ...((session.variables as Vars | null) ?? {}) },
      "running",
    );
    await this.walk(
      flow,
      conversationId,
      session.currentNodeId,
      text,
      { ...((session.variables as Vars | null) ?? {}) },
    );
  }

  private delayMs(node: FlowNode): number {
    const v = node.data.delayValue ?? 0;
    const unit = node.data.delayUnit ?? "minutes";
    return unit === "hours" ? v * 3600_000 : v * 60_000;
  }

  // Petición HTTP a una API/webhook externa (p. ej. n8n).
  private async execHttp(node: FlowNode, vars: Vars): Promise<void> {
    const url = this.interpolate(node.data.url, vars);
    if (!url) return;
    try {
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      if (node.data.headers?.trim()) {
        headers = { ...headers, ...JSON.parse(node.data.headers) };
      }
      const method = node.data.method ?? "POST";
      const body =
        method === "GET" || method === "DELETE"
          ? undefined
          : this.interpolate(node.data.httpBody, vars) || JSON.stringify(vars);
      const res = await fetch(url, { method, headers, body });
      const responseText = (await res.text()).slice(0, 2000);
      if (node.data.saveAs) vars[node.data.saveAs] = responseText;
    } catch (e) {
      this.logger.warn(`HTTP del flujo falló: ${(e as Error).message}`);
      if (node.data.saveAs) vars[node.data.saveAs] = "";
    }
  }

  // ── Acciones del nodo "action" ──────────────────────────────
  // Devuelve true si el flujo debe detenerse tras la acción.
  private async execAction(
    node: FlowNode,
    conversationId: string,
    vars: Vars,
  ): Promise<boolean> {
    const action = node.data.action;
    if (action === "ai") {
      await this.messaging.setAiMode(conversationId, AiMode.AUTOPILOT);
      // Persistir antes de delegar para no pisar el estado.
      await this.persist(conversationId, null, vars, "stopped");
      await this.autopilot.run(conversationId);
      return true;
    }
    if (action === "handoff") {
      await this.messaging.setStatus(conversationId, ConversationStatus.PENDING);
      return true;
    }
    if (action === "tag" && node.data.tag?.trim()) {
      await this.applyTag(conversationId, node.data.tag.trim());
      return false;
    }
    if (action === "move_deal" && node.data.stageId) {
      await this.moveDeal(conversationId, node.data.stageId);
      return false;
    }
    if (action === "untag" && node.data.tag?.trim()) {
      await this.removeTag(conversationId, node.data.tag.trim());
      return false;
    }
    if (action === "create_deal" && node.data.stageId) {
      await this.createDeal(conversationId, node, vars);
      return false;
    }
    return false;
  }

  private async removeTag(conversationId: string, name: string): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true, orgId: true },
    });
    if (!convo) return;
    const tag = await this.prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!tag) return;
    const r = await this.prisma.contactTag.deleteMany({ where: { contactId: convo.contactId, tagId: tag.id } });
    if (r.count) this.events.emit("contact.untagged", { orgId: convo.orgId, contactId: convo.contactId, tag: tag.name });
  }

  /** Oportunidad nueva en la etapa indicada; si ya tiene una abierta en ese embudo, no duplica. */
  private async createDeal(conversationId: string, node: FlowNode, vars: Vars): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: { select: { id: true, name: true, phone: true, currency: true } } },
    });
    const stage = await this.prisma.pipelineStage.findUnique({
      where: { id: node.data.stageId! },
      select: { id: true, pipelineId: true },
    });
    if (!convo || !stage) return;
    const open = await this.prisma.deal.findFirst({
      where: { contactId: convo.contactId, discardedAt: null, stage: { pipelineId: stage.pipelineId } },
      select: { id: true },
    });
    if (open) return;
    const deal = await this.prisma.deal.create({
      data: {
        orgId: convo.orgId,
        contactId: convo.contactId,
        stageId: stage.id,
        title:
          this.interpolate(node.data.dealTitle, vars).trim() ||
          `Oportunidad: ${convo.contact.name ?? convo.contact.phone}`,
        currency: contactCurrency(convo.contact) ?? "USD",
      },
    });
    this.events.emit("pipeline.changed", { orgId: convo.orgId, dealId: deal.id });
    this.events.emit("deal.stage_changed", {
      orgId: convo.orgId,
      dealId: deal.id,
      contactId: convo.contactId,
      stageId: stage.id,
    });
  }

  /** Guarda un valor en la ficha del contacto: su nombre o un campo personalizado. */
  private async setField(conversationId: string, node: FlowNode, vars: Vars): Promise<void> {
    const key = node.data.fieldKey?.trim();
    if (!key) return;
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true },
    });
    if (!convo) return;
    const value = this.interpolate(node.data.value, vars).trim();
    if (key === "name") {
      await this.prisma.contact.update({ where: { id: convo.contactId }, data: { name: value || null } });
      return;
    }
    const contact = await this.prisma.contact.findUnique({
      where: { id: convo.contactId },
      select: { metadata: true },
    });
    const metadata = {
      ...((contact?.metadata as Record<string, unknown> | null) ?? {}),
      [key]: value,
    };
    await this.prisma.contact.update({
      where: { id: convo.contactId },
      data: { metadata: metadata as Prisma.InputJsonObject },
    });
  }

  /**
   * Nota interna firmada por el flujo. La nota necesita un autor del equipo:
   * va a nombre del primer administrador de la empresa, con el flujo delante.
   */
  private async addNote(flow: FlowRow, conversationId: string, text: string): Promise<void> {
    if (!text.trim()) return;
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { orgId: true },
    });
    if (!convo) return;
    const author =
      (await this.prisma.user.findFirst({ where: { orgId: convo.orgId, role: "ADMIN" }, orderBy: { createdAt: "asc" } })) ??
      (await this.prisma.user.findFirst({ where: { orgId: convo.orgId }, orderBy: { createdAt: "asc" } }));
    if (!author) return;
    await this.messaging.addNote(conversationId, author.id, `🤖 Flujo «${flow.name}»: ${text.trim()}`);
  }

  /** Salida al azar del bloque «Dividir», ponderada por los pesos. */
  private pickSplit(node: FlowNode): string {
    const splits = (node.data.splits ?? []).filter((s) => s.weight > 0);
    if (!splits.length) return node.data.splits?.[0]?.id ?? "else";
    const total = splits.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    for (const s of splits) {
      r -= s.weight;
      if (r <= 0) return s.id;
    }
    return splits[splits.length - 1]!.id;
  }

  /** Mensaje con botones de respuesta; fuera de la ventana de 24 h, como texto numerado. */
  private async sendButtons(conversationId: string, node: FlowNode, vars: Vars): Promise<void> {
    const text = this.interpolate(node.data.text, vars).trim();
    const buttons = (node.data.buttons ?? [])
      .filter((b) => b.title.trim())
      .slice(0, 3)
      .map((b) => ({ id: b.id, title: b.title.trim().slice(0, 20) }));
    if (!buttons.length) {
      await this.send(conversationId, text);
      return;
    }
    try {
      const media = node.data.mediaUrl && node.data.mediaKind && node.data.mediaKind !== "AUDIO" ? node.data.mediaKind : null;
      await this.messaging.queueInteractive(
        {
          conversationId,
          body: text || "Elige una opción:",
          buttons,
          ...(media ? { headerMedia: { kind: media, mediaUrl: node.data.mediaUrl!, ...(node.data.mediaName ? { fileName: node.data.mediaName } : {}) } } : {}),
          ...(node.data.footer?.trim() ? { footer: node.data.footer.trim() } : {}),
        },
        MessageAuthor.AI,
      );
    } catch (e) {
      this.logger.warn(`Botones no enviados en ${conversationId} (${(e as Error).message}); van como texto`);
      await this.send(conversationId, `${text}\n\n${buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n")}`);
    }
  }

  /** Mensaje de texto o, si el bloque lleva adjunto, la imagen/documento con el texto de pie. */
  private async sendMessageNode(conversationId: string, node: FlowNode, vars: Vars): Promise<void> {
    const text = this.interpolate(node.data.text, vars);
    if (node.data.mediaUrl) {
      const kind = node.data.mediaKind ?? "IMAGE";
      // El audio no lleva pie: el texto, si hay, va después en su propio mensaje.
      const caption = kind !== "AUDIO" && text.trim() ? text.trim().slice(0, 1024) : undefined;
      await this.messaging.queueOutbound(
        {
          conversationId,
          type: MessageType[kind],
          mediaUrl: node.data.mediaUrl,
          ...(caption ? { caption } : {}),
        },
        MessageAuthor.AI,
      );
      if (kind === "AUDIO" && text.trim()) await this.send(conversationId, text);
      return;
    }
    await this.send(conversationId, text);
  }

  /** Lista de opciones de WhatsApp (hasta 10); fuera de la ventana de 24 h, como texto numerado. */
  private async sendList(conversationId: string, node: FlowNode, vars: Vars): Promise<void> {
    const text = this.interpolate(node.data.text, vars).trim() || "Elige una opción:";
    const rows = (node.data.buttons ?? [])
      .filter((b) => b.title.trim())
      .slice(0, 10)
      .map((b) => ({ id: b.id, title: b.title.trim().slice(0, 24), ...(b.description?.trim() ? { description: b.description.trim().slice(0, 72) } : {}) }));
    if (!rows.length) {
      await this.send(conversationId, text);
      return;
    }
    try {
      await this.messaging.queueInteractive(
        {
          conversationId,
          body: text,
          buttons: [],
          list: { button: node.data.listButton?.trim() || "Ver opciones", rows },
          ...(node.data.footer?.trim() ? { footer: node.data.footer.trim() } : {}),
        },
        MessageAuthor.AI,
      );
    } catch (e) {
      this.logger.warn(`Lista no enviada en ${conversationId} (${(e as Error).message}); va como texto`);
      await this.send(conversationId, `${text}\n\n${rows.map((r, i) => `${i + 1}. ${r.title}`).join("\n")}`);
    }
  }

  /**
   * Carrusel de 2 a 10 tarjetas con imagen o video. Cada tarjeta lleva un
   * botón: una respuesta (y entonces es una salida del bloque) o un enlace.
   * Fuera de la ventana de 24 h, como texto con las opciones o los enlaces.
   */
  private async sendCarousel(conversationId: string, node: FlowNode, vars: Vars): Promise<void> {
    const text = this.interpolate(node.data.text, vars).trim() || "Mira estas opciones:";
    const urlMode = (node.data.cardMode ?? "reply") === "url";
    const cards = (node.data.cards ?? [])
      .filter((c) => c.mediaUrl)
      .slice(0, 10)
      .map((c, i) => ({
        id: c.id,
        kind: c.mediaKind === "VIDEO" ? ("VIDEO" as const) : ("IMAGE" as const),
        mediaUrl: c.mediaUrl!,
        ...(c.text?.trim() ? { body: this.interpolate(c.text, vars).trim().slice(0, 160) } : {}),
        button: {
          title: (c.buttonTitle?.trim() || (urlMode ? "Ver más" : `Elegir ${i + 1}`)).slice(0, 20),
          ...(urlMode && c.url?.trim() ? { url: c.url.trim() } : {}),
        },
      }));
    const asText = () =>
      `${text}\n\n${cards
        .map((c, i) => `${i + 1}. ${c.body ?? c.button.title}${urlMode && c.button.url ? ` ${c.button.url}` : ""}`)
        .join("\n")}`;
    if (cards.length < 2) {
      await this.send(conversationId, asText());
      return;
    }
    try {
      await this.messaging.queueInteractive({ conversationId, body: text, buttons: [], carousel: { cards } }, MessageAuthor.AI);
    } catch (e) {
      this.logger.warn(`Carrusel no enviado en ${conversationId} (${(e as Error).message}); va como texto`);
      await this.send(conversationId, asText());
    }
  }

  private async applyTag(conversationId: string, name: string): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { orgId: true, contactId: true },
    });
    if (!convo) return;
    const tag = await this.prisma.tag.upsert({
      where: { orgId_name: { orgId: convo.orgId, name } },
      create: { orgId: convo.orgId, name },
      update: {},
    });
    const added = await this.prisma.contactTag
      .create({ data: { contactId: convo.contactId, tagId: tag.id } })
      .then(() => true)
      .catch(() => false); // ya existía
    if (added) {
      this.events.emit("contact.tagged", { orgId: convo.orgId, contactId: convo.contactId, tag: name });
    }
  }

  private async moveDeal(conversationId: string, stageId: string): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true },
    });
    if (!convo) return;
    const deal = await this.prisma.deal.findFirst({
      where: { contactId: convo.contactId, discardedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    if (deal) {
      await this.prisma.deal.update({
        where: { id: deal.id },
        data: { stageId },
      });
      this.events.emit("deal.stage_changed", {
        orgId: deal.orgId,
        dealId: deal.id,
        contactId: convo.contactId,
        stageId,
      });
    }
  }

  // ── Utilidades del grafo ────────────────────────────────────
  private nextNodeId(
    edges: FlowEdge[],
    nodeId: string,
    handle?: string,
  ): string | null {
    const outgoing = edges.filter((e) => e.source === nodeId);
    if (handle) {
      const byHandle = outgoing.find((e) => e.sourceHandle === handle);
      if (byHandle) return byHandle.target;
      // "else": acepta la rama explícita o la arista sin handle.
      const fallback = outgoing.find(
        (e) => e.sourceHandle === "else" || !e.sourceHandle,
      );
      return fallback?.target ?? null;
    }
    return outgoing[0]?.target ?? null;
  }

  private evalCondition(node: FlowNode, ctx: CondCtx): string {
    const hit = (node.data.branches ?? []).find((b) => this.branchMatches(b, ctx));
    return hit?.id ?? "else";
  }

  /**
   * ¿Se cumplen estas condiciones en la conversación? Lo usan las versiones de
   * una respuesta por palabra clave del agente (mismas reglas que «Condición»).
   */
  async rulesMatch(conversationId: string, rules: FlowRule[], match: "all" | "any", text: string): Promise<boolean> {
    if (!rules.length) return false;
    const ctx = await this.condCtx(conversationId, text, {});
    const results = rules.map((r) => this.ruleMatches(r, ctx));
    return match === "any" ? results.some(Boolean) : results.every(Boolean);
  }

  /**
   * ¿Cumple el contacto estas condiciones? Para los filtros de las
   * automatizaciones de etapa: mira su conversación más reciente (o solo su
   * ficha si aún no tiene). Sin reglas, sí.
   */
  async contactRulesMatch(contactId: string, rules: FlowRule[], match: "all" | "any"): Promise<boolean> {
    if (!rules.length) return true;
    const convo = await this.prisma.conversation.findFirst({
      where: { contactId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    const ctx = convo ? await this.condCtx(convo.id, "", {}) : await this.contactOnlyCtx(contactId);
    const results = rules.map((r) => this.ruleMatches(r, ctx));
    return match === "any" ? results.some(Boolean) : results.every(Boolean);
  }

  private async contactOnlyCtx(contactId: string): Promise<CondCtx> {
    const [contact, deal] = await Promise.all([
      this.prisma.contact.findUnique({
        where: { id: contactId },
        include: { tags: { include: { tag: { select: { name: true } } } } },
      }),
      this.prisma.deal.findFirst({
        where: { contactId, discardedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { stageId: true, value: true, ownerId: true },
      }),
    ]);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries((contact?.metadata as Record<string, unknown> | null) ?? {})) {
      if (v != null) fields[k] = String(v);
    }
    return {
      text: "",
      vars: {},
      contact: {
        name: contact?.name ?? null,
        phone: contact?.phone ?? "",
        tags: contact?.tags.map((t) => t.tag.name) ?? [],
        sourceId: contact?.sourceId ?? null,
        fields,
      },
      convo: { status: "", assignedAgentId: null, channelId: null, aiMode: "" },
      stageId: deal?.stageId ?? null,
      dealValue: deal?.value != null ? Number(deal.value) : null,
      dealOwnerId: deal?.ownerId ?? null,
      inboundCount: 0,
      country: contact ? (countryFromPhone(contact.phone)?.code ?? null) : null,
    };
  }

  private async condCtx(conversationId: string, text: string, vars: Vars): Promise<CondCtx> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: { include: { tags: { include: { tag: { select: { name: true } } } } } } },
    });
    const empty: CondCtx = {
      text,
      vars,
      contact: { name: null, phone: "", tags: [], sourceId: null, fields: {} },
      convo: { status: "", assignedAgentId: null, channelId: null, aiMode: "" },
      stageId: null,
      dealValue: null,
      dealOwnerId: null,
      inboundCount: 0,
      country: null,
    };
    if (!convo) return empty;
    const [deal, inboundCount] = await Promise.all([
      this.prisma.deal.findFirst({
        where: { contactId: convo.contactId, discardedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { stageId: true, value: true, ownerId: true },
      }),
      this.prisma.message.count({ where: { conversationId, direction: "INBOUND" } }),
    ]);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries((convo.contact.metadata as Record<string, unknown> | null) ?? {})) {
      if (v != null) fields[k] = String(v);
    }
    return {
      text,
      vars,
      contact: {
        name: convo.contact.name,
        phone: convo.contact.phone,
        tags: convo.contact.tags.map((t) => t.tag.name),
        sourceId: convo.contact.sourceId,
        fields,
      },
      convo: {
        status: convo.status,
        assignedAgentId: convo.assignedAgentId,
        channelId: convo.channelId,
        aiMode: convo.aiMode,
      },
      stageId: deal?.stageId ?? null,
      dealValue: deal?.value != null ? Number(deal.value) : null,
      dealOwnerId: deal?.ownerId ?? null,
      inboundCount,
      country: countryFromPhone(convo.contact.phone)?.code ?? null,
    };
  }

  /** Reglas efectivas de una rama: las nuevas, o las palabras clave antiguas como "mensaje contiene". */
  private rulesOf(b: FlowBranch): FlowRule[] {
    if (b.rules?.length) return b.rules;
    if (b.keywords?.length) return [{ id: "legacy", field: "message", op: "contains", value: b.keywords.join(",") }];
    return [];
  }

  private branchMatches(b: FlowBranch, ctx: CondCtx): boolean {
    const rules = this.rulesOf(b);
    if (!rules.length) return false;
    const results = rules.map((r) => this.ruleMatches(r, ctx));
    return (b.match ?? "all") === "any" ? results.some(Boolean) : results.every(Boolean);
  }

  private ruleMatches(r: FlowRule, ctx: CondCtx): boolean {
    const expectedRaw = this.interpolate(r.value ?? "", ctx.vars).trim();
    const expected = expectedRaw.toLowerCase();
    // La etiqueta se pregunta como "¿la tiene?", no como un valor.
    if (r.field === "tag") {
      const has = ctx.contact.tags.some((t) => t.toLowerCase() === expected);
      return r.op === "is_not" || r.op === "not_contains" || r.op === "not_equals" ? !has : has;
    }
    const actualRaw = this.fieldValue(r, ctx);
    const actual = actualRaw.trim().toLowerCase();
    const options = expected.split(",").map((x) => x.trim()).filter(Boolean);
    const num = (s: string) => Number(s.replace(",", "."));
    switch (r.op) {
      case "contains":
        return options.some((k) => actual.includes(k));
      case "not_contains":
        return !options.some((k) => actual.includes(k));
      case "equals":
      case "is":
        return options.length > 1 ? options.includes(actual) : actual === expected;
      case "not_equals":
      case "is_not":
        return options.length > 1 ? !options.includes(actual) : actual !== expected;
      case "starts_with":
        return options.some((k) => actual.startsWith(k));
      case "regex":
        try {
          return new RegExp(expectedRaw, "i").test(actualRaw);
        } catch {
          return false;
        }
      case "empty":
        return !actual;
      case "not_empty":
        return !!actual;
      case "gt":
        return num(actual) > num(expected);
      case "lt":
        return num(actual) < num(expected);
      default:
        return false;
    }
  }

  private fieldValue(r: FlowRule, ctx: CondCtx): string {
    switch (r.field) {
      case "message":
        return ctx.text;
      case "variable":
        return ctx.vars[r.key ?? ""] ?? "";
      case "contact_name":
        return ctx.contact.name ?? "";
      case "contact_phone":
        return ctx.contact.phone;
      case "contact_field":
        return ctx.contact.fields[r.key ?? ""] ?? "";
      case "utm":
        // Se guardan en la ficha con su nombre: utm_source, utm_campaign…
        return ctx.contact.fields[r.key ?? ""] ?? "";
      case "source":
        return ctx.contact.sourceId ?? "";
      case "channel":
        return ctx.convo.channelId ?? "";
      case "status":
        return ctx.convo.status;
      case "ai_mode":
        return ctx.convo.aiMode;
      case "assigned":
        // En el inspector "nadie" se guarda como "none".
        return ctx.convo.assignedAgentId ?? "none";
      case "stage":
        return ctx.stageId ?? "";
      case "deal_value":
        return ctx.dealValue != null ? String(ctx.dealValue) : "";
      case "deal_owner":
        return ctx.dealOwnerId ?? "none";
      case "country":
        return ctx.country ?? "";
      case "is_new":
        return ctx.inboundCount <= 1 ? "yes" : "no";
      case "messages_count":
        return String(ctx.inboundCount);
      default:
        return "";
    }
  }

  private interpolate(text: string | undefined, vars: Vars): string {
    if (!text) return "";
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
  }

  /**
   * Plantilla aprobada por Meta: la única forma de escribirle a quien no nos
   * ha escrito (leads de formularios) o lleva más de 24 h callado. Si lleva
   * {{1}}, va el nombre del contacto; el resto de variables quedan vacías.
   */
  private async sendTemplate(flow: FlowRow, conversationId: string, node: FlowNode, vars: Vars): Promise<void> {
    const templateId = node.data.templateId;
    if (!templateId) return;
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
      select: { name: true, body: true },
    });
    if (!template) {
      await this.addNote(flow, conversationId, "no envió la plantilla: ya no existe en el CRM");
      return;
    }
    // Los valores elegidos en el bloque (un texto fijo admite {{variables}}
    // del flujo). Sin elegir, la primera variable es el nombre del contacto,
    // como antes; las demás sin valor hacen que el envío se rechace con aviso.
    const chosen = node.data.templateVars ?? [];
    const body = Array.from({ length: templateVarCount(template.body) }, (_, i) => {
      const v = chosen.find((x) => x.index === i + 1);
      if (v) return v.source === "static" ? { ...v, value: this.interpolate(v.value ?? "", vars) } : v;
      return i === 0 ? { index: 1, source: "contact_name" as const } : null;
    }).filter((v): v is NonNullable<typeof v> => !!v);
    try {
      await this.messaging.sendTemplateMessage(
        { conversationId, templateId, fill: { body, urlButtons: [] } },
        MessageAuthor.AI,
      );
    } catch (e) {
      const reason = (e as Error).message;
      this.logger.warn(`No se pudo enviar la plantilla en ${conversationId}: ${reason}`);
      await this.addNote(flow, conversationId, `no pudo enviar la plantilla «${template.name}»: ${reason}`).catch(() => undefined);
    }
  }

  private async send(conversationId: string, text: string): Promise<void> {
    if (!text.trim()) return;
    await this.messaging.queueOutbound(
      { conversationId, type: MessageType.TEXT, text },
      MessageAuthor.AI,
    );
  }

  private async persist(
    conversationId: string,
    currentNodeId: string | null,
    vars: Vars,
    status: string,
  ): Promise<void> {
    await this.prisma.flowSession.update({
      where: { conversationId },
      data: {
        currentNodeId,
        variables: vars as unknown as Prisma.InputJsonValue,
        status,
      },
    });
  }

  private async lastInboundText(conversationId: string): Promise<string> {
    return (await this.lastInbound(conversationId)).text;
  }

  private async lastInbound(conversationId: string): Promise<Inbound> {
    const m = await this.prisma.message.findFirst({
      where: { conversationId, direction: "INBOUND" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { type: true, content: true, transcript: true, buttonPayload: true, referral: true, createdAt: true },
    });
    return m
      ? { text: MediaUnderstandingService.textOf(m), payload: m.buttonPayload ?? null, fromAd: m.referral !== null, at: m.createdAt }
      : { text: "", payload: null };
  }

  // ── Selección de flujo ──────────────────────────────────────
  /**
   * Los disparadores de ese tipo, en flujos activos, que encajan con el evento
   * (`pick`: palabras, etiquetas, etapas, formularios). Primero los del número
   * concreto. Un flujo puede tener varios disparadores: cada uno cuenta.
   */
  private async candidates(
    channelId: string | null,
    triggerType: FlowTriggerType,
    pick?: (t: FlowTrigger) => boolean,
  ): Promise<Hit[]> {
    const rows = await this.prisma.flow.findMany({
      where: {
        isActive: true,
        OR: [{ channelId }, { channelId: null }],
        // jsonb @>: la lista contiene un disparador de ese tipo.
        triggers: { array_contains: [{ type: triggerType }] },
      },
      // Primero el del número concreto (en Postgres, DESC pone los nulos delante).
      orderBy: [{ channelId: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    });
    const out: Hit[] = [];
    for (const r of rows) {
      const flow = this.toRow(r);
      for (const trigger of flow.triggers) {
        if (trigger.type === triggerType && (!pick || pick(trigger))) out.push({ flow, trigger });
      }
    }
    return out;
  }

  private async loadFlow(flowId: string): Promise<FlowRow | null> {
    const f = await this.prisma.flow.findUnique({ where: { id: flowId } });
    return f && f.isActive ? this.toRow(f) : null;
  }

  private toRow(f: {
    id: string;
    name: string;
    triggers: unknown;
    nodes: unknown;
    edges: unknown;
  }): FlowRow {
    return {
      id: f.id,
      name: f.name,
      triggers: parseTriggers(f.triggers),
      nodes: (f.nodes as FlowNode[] | null) ?? [],
      edges: (f.edges as FlowEdge[] | null) ?? [],
    };
  }
}

type Hit = { flow: FlowRow; trigger: FlowTrigger };

/** Lo que pasó, para comprobar al vencer la espera que sigue valiendo. */
interface TriggerEvent {
  stageId?: string;
  tag?: string;
  ownerId?: string | null;
}

export interface DelayedTriggerJob {
  orgId: string;
  flowId: string;
  triggerId: string;
  contactId: string;
  conversationId: string | null;
  event: TriggerEvent;
}

/** Etiqueta del evento contra el filtro del disparador (vacío = cualquiera). */
function tagMatches(t: FlowTrigger, tag: string): boolean {
  return t.config.tags.length === 0 || t.config.tags.some((x) => x.toLowerCase() === tag.toLowerCase());
}

interface FlowRow {
  id: string;
  name: string;
  triggers: FlowTrigger[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}
