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
  type FlowBranch,
  type FlowEdge,
  type FlowNode,
  type FlowRule,
  type FlowTriggerConfig,
  type FlowTriggerType,
} from "@crm/shared";
import { isWithinHours } from "../../common/utils/business-hours";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { currentOrgId } from "../../infra/tenant/tenant.context";
import { TenantService } from "../../infra/tenant/tenant.service";
import { QUEUE_FLOW } from "../../infra/queue/queue.constants";
import { MessagingService } from "../messaging/messaging.service";
import { AutopilotService } from "./autopilot.service";
import { parseTriggerConfig } from "./flow.service";
import { MediaUnderstandingService } from "./media-understanding.service";

const MAX_STEPS = 50; // cortafuegos anti-bucle

type Vars = Record<string, string>;

/** Lo último que escribió el contacto: texto y, si pulsó un botón, su id. */
interface Inbound {
  text: string;
  payload: string | null;
}

/** Todo lo que puede mirar una condición, cargado una vez por bloque. */
interface CondCtx {
  text: string;
  vars: Vars;
  contact: { name: string | null; phone: string; tags: string[]; sourceId: string | null; fields: Record<string, string> };
  convo: { status: string; assignedAgentId: string | null; channelId: string | null; aiMode: string };
  stageId: string | null;
  inboundCount: number;
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

    // Nace desde un anuncio Click-to-WhatsApp: ese disparador va primero.
    if (convo.referral) {
      const ad = await this.findFlow(convo.channelId, "ad_click");
      if (ad) {
        await this.startFlow(ad, conversationId, "");
        return true;
      }
    }

    const flow = await this.findFlow(convo.channelId, "conversation_start");
    if (!flow) return false;
    await this.startFlow(flow, conversationId, "");
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
    await this.onContactEvent(contactId, type, (f) => {
      if (type !== "meta_lead" || f.triggerConfig.forms.length === 0) return true;
      const wanted = f.triggerConfig.forms.map((x) => x.toLowerCase());
      return [form.formName, form.formId].some((v) => !!v && wanted.includes(v.toLowerCase()));
    });
  }

  async onTagAdded(contactId: string, tag: string): Promise<void> {
    await this.onContactEvent(
      contactId,
      "tag_added",
      (f) => f.triggerConfig.tags.length === 0 || f.triggerConfig.tags.some((t) => t.toLowerCase() === tag.toLowerCase()),
    );
  }

  async onDealStage(contactId: string, stageId: string): Promise<void> {
    await this.onContactEvent(
      contactId,
      "deal_stage",
      (f) => f.triggerConfig.stageIds.length === 0 || f.triggerConfig.stageIds.includes(stageId),
    );
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
    const flow = await this.findFlow(convo.channelId, "conversation_closed");
    if (flow) await this.startIfIdle(flow, conversationId);
  }

  /**
   * Le escribimos (una persona, la IA o un flujo): si hay un flujo «sin
   * respuesta», se programa la comprobación para dentro de sus horas.
   */
  async onOutbound(conversationId: string, messageId: string, _author: string): Promise<void> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channelId: true, orgId: true },
    });
    if (!convo) return;
    const flow = await this.findFlow(convo.channelId, "no_reply");
    if (!flow) return;
    await this.flowQueue.add(
      "no_reply",
      { conversationId, orgId: convo.orgId, messageId },
      { delay: flow.triggerConfig.hours * 3600_000, jobId: `no-reply-${messageId}` },
    );
  }

  /** Venció el plazo: ¿sigue sin contestar y sigue siendo nuestro último mensaje? */
  async checkNoReply(conversationId: string, messageId: string): Promise<void> {
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
    const flow = await this.findFlow(convo.channelId, "no_reply");
    if (!flow) return;
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
   * Un evento del contacto (lead, etiqueta, etapa) se atiende en su
   * conversación abierta más reciente; si no tiene, se abre una. Así el flujo
   * puede etiquetar, mover el embudo, avisar por HTTP o mandarle una plantilla.
   */
  private async onContactEvent(
    contactId: string,
    type: FlowTriggerType,
    pick: (f: FlowRow) => boolean,
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
    const flow = await this.findFlow(open?.channelId ?? null, type, undefined, pick);
    if (!flow) return;
    const conversationId =
      open?.id ??
      (
        await this.prisma.conversation.create({
          data: { orgId: contact.orgId, contactId, status: ConversationStatus.OPEN },
        })
      ).id;
    await this.startIfIdle(flow, conversationId);
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

    // Sesión esperando respuesta (pregunta o botones) → reanudar.
    if (session && session.status === "running" && session.currentNodeId) {
      const flow = await this.loadFlow(session.flowId);
      if (!flow) return false;
      await this.resume(flow, conversationId, session.currentNodeId, inbound, {
        ...((session.variables as Vars | null) ?? {}),
      });
      return true;
    }

    // Sin sesión activa → ¿algún flujo por palabra clave coincide?
    const flow = await this.findFlow(convo.channelId, "keyword", text);
    if (flow) {
      await this.startFlow(flow, conversationId, text);
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
      },
      update: {
        flowId: flow.id,
        variables: vars,
        status: "running",
        currentNodeId: null,
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
      // no deja la sesión colgada en "running": queda parada y en el log.
      this.logger.warn(`Flujo "${flow.name}" se detuvo en ${conversationId}: ${(e as Error).message}`);
      await this.persist(conversationId, null, {}, "stopped").catch(() => undefined);
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
      if (node?.type === "buttons") {
        const handle = this.matchButton(node, inbound);
        if (node.data.variable) vars[node.data.variable] = text;
        await this.walk(flow, conversationId, this.nextNodeId(flow.edges, node.id, handle), text, vars);
        return;
      }
      const nextId = node ? this.nextNodeId(flow.edges, node.id) : null;
      await this.walk(flow, conversationId, nextId, text, vars);
    } catch (e) {
      this.logger.warn(`Flujo "${flow.name}" se detuvo en ${conversationId}: ${(e as Error).message}`);
      await this.persist(conversationId, null, vars, "stopped").catch(() => undefined);
    }
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

  // ── Recorrido del grafo ─────────────────────────────────────
  private async walk(
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
        await this.sendTemplate(conversationId, node.data.templateId);
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
      select: { contactId: true },
    });
    if (!convo) return;
    const tag = await this.prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!tag) return;
    await this.prisma.contactTag.deleteMany({ where: { contactId: convo.contactId, tagId: tag.id } });
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
      await this.messaging.queueInteractive(
        {
          conversationId,
          body: text || "Elige una opción:",
          buttons,
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
      await this.messaging.queueOutbound(
        {
          conversationId,
          type: node.data.mediaKind === "DOCUMENT" ? MessageType.DOCUMENT : MessageType.IMAGE,
          mediaUrl: node.data.mediaUrl,
          ...(text.trim() ? { caption: text.trim().slice(0, 1024) } : {}),
        },
        MessageAuthor.AI,
      );
      return;
    }
    await this.send(conversationId, text);
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
      inboundCount: 0,
    };
    if (!convo) return empty;
    const [deal, inboundCount] = await Promise.all([
      this.prisma.deal.findFirst({
        where: { contactId: convo.contactId, discardedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { stageId: true },
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
      inboundCount,
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
  private async sendTemplate(conversationId: string, templateId?: string): Promise<void> {
    if (!templateId) return;
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
      select: { body: true },
    });
    if (!template) {
      this.logger.warn(`Plantilla ${templateId} no existe: el flujo sigue sin enviarla`);
      return;
    }
    const body = /\{\{\s*1\s*\}\}/.test(template.body) ? [{ index: 1, source: "contact_name" as const }] : [];
    try {
      await this.messaging.sendTemplateMessage(
        { conversationId, templateId, fill: { body, urlButtons: [] } },
        MessageAuthor.AI,
      );
    } catch (e) {
      this.logger.warn(`No se pudo enviar la plantilla en ${conversationId}: ${(e as Error).message}`);
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
      select: { type: true, content: true, transcript: true, buttonPayload: true },
    });
    return m ? { text: MediaUnderstandingService.textOf(m), payload: m.buttonPayload ?? null } : { text: "", payload: null };
  }

  // ── Selección de flujo ──────────────────────────────────────
  private async findFlow(
    channelId: string | null,
    triggerType: FlowTriggerType,
    text?: string,
    pick?: (f: FlowRow) => boolean,
  ): Promise<FlowRow | null> {
    const rows = await this.prisma.flow.findMany({
      where: {
        isActive: true,
        triggerType,
        OR: [{ channelId }, { channelId: null }],
      },
      orderBy: { channelId: "desc" }, // prioriza el específico del canal
    });
    const flows = rows.map((r) => this.toRow(r));
    if (triggerType === "keyword") {
      const t = (text ?? "").toLowerCase();
      if (!t) return null;
      return (
        flows.find((f) =>
          f.triggerKeywords.some((k) => t.includes(k.toLowerCase())),
        ) ?? null
      );
    }
    if (pick) return flows.find(pick) ?? null;
    return flows[0] ?? null;
  }

  private async loadFlow(flowId: string): Promise<FlowRow | null> {
    const f = await this.prisma.flow.findUnique({ where: { id: flowId } });
    return f && f.isActive ? this.toRow(f) : null;
  }

  private toRow(f: {
    id: string;
    name: string;
    triggerType: string;
    triggerKeywords: string[];
    triggerConfig?: unknown;
    nodes: unknown;
    edges: unknown;
  }): FlowRow {
    return {
      id: f.id,
      name: f.name,
      triggerType: f.triggerType as FlowTriggerType,
      triggerKeywords: f.triggerKeywords,
      triggerConfig: parseTriggerConfig(f.triggerConfig),
      nodes: (f.nodes as FlowNode[] | null) ?? [],
      edges: (f.edges as FlowEdge[] | null) ?? [],
    };
  }
}

interface FlowRow {
  id: string;
  name: string;
  triggerType: FlowTriggerType;
  triggerKeywords: string[];
  triggerConfig: FlowTriggerConfig;
  nodes: FlowNode[];
  edges: FlowEdge[];
}
