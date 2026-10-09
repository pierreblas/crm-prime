import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Inject } from "@nestjs/common";
import type { Request } from "express";
import twilio from "twilio";
import {
  ConversationStatus,
  normalizePhone,
  isValidPhone,
  type CallDto,
  type CallStatus,
  type CallToken,
  type CallsConfig,
  type CreateManualCallInput,
  type TwilioProvisionResult,
  type UpdateCallInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";
import { STORAGE_PROVIDER, toStorageRef, type StorageProvider } from "../../infra/storage/storage.provider";
import { IntegrationSettingsService, type TwilioCreds } from "../integrations/integration-settings.service";
import { MediaUnderstandingService } from "../ai/media-understanding.service";

/** Lo que Twilio manda en cada webhook (form-urlencoded). */
type TwilioParams = Record<string, string | undefined>;

const { VoiceResponse } = twilio.twiml;
const AccessToken = twilio.jwt.AccessToken;
const TOKEN_TTL = 3600;
const RING_SECONDS = 25;
const MAX_AGENTS = 10; // Twilio no suena a más de 10 clientes a la vez

/** Identidad del softphone de cada usuario: así Twilio sabe a qué navegador sonar. */
export function identityOf(userId: string): string {
  return `agent_${userId}`;
}
function userOfIdentity(identity: string | undefined): string | null {
  if (!identity) return null;
  const m = identity.replace(/^client:/, "").match(/^agent_(.+)$/);
  return m ? m[1]! : null;
}

const STATUS_MAP: Record<string, CallStatus> = {
  queued: "queued",
  initiated: "queued",
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  failed: "failed",
  canceled: "canceled",
};

/**
 * Llamadas telefónicas con Twilio: el vendedor llama y contesta desde el
 * navegador (Voice SDK), Twilio avisa por webhook de cada cambio, y cada
 * llamada queda en el hilo del contacto con su grabación y transcripción.
 *
 * Las credenciales son de cada empresa (Ajustes › Integraciones). Los
 * webhooks llegan por la ruta de la empresa (`/calls/twilio/<slug>/…`) y se
 * autentican con la firma de Twilio calculada con su auth token.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger("Calls");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly settings: IntegrationSettingsService,
    private readonly media: MediaUnderstandingService,
    private readonly events: EventEmitter2,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  // ── Para el navegador ───────────────────────────────────────
  async config(): Promise<CallsConfig> {
    const c = await this.settings.twilio();
    // "Configurado" para el navegador = credenciales completas y webhooks activados.
    return { configured: this.ready(c) && !!c.appSid, number: c.number, recording: c.record };
  }

  /** Token del softphone: identifica al usuario y le deja llamar y recibir. */
  async token(userId: string): Promise<CallToken> {
    const c = await this.settings.twilio();
    if (!this.ready(c)) throw new BadRequestException("Las llamadas no están configuradas (Ajustes › Integraciones › Twilio)");
    if (!c.appSid) throw new BadRequestException("Falta activar los webhooks de Twilio (botón «Activar llamadas»)");
    const identity = identityOf(userId);
    const token = new AccessToken(c.accountSid!, c.apiKeySid!, c.apiKeySecret!, { identity, ttl: TOKEN_TTL });
    token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: c.appSid, incomingAllow: true }));
    return { token: token.toJwt(), identity, ttl: TOKEN_TTL, number: c.number };
  }

  /**
   * Deja Twilio apuntando a nuestros webhooks: una TwiML App para las
   * llamadas salientes del softphone y la URL de voz del número para las
   * entrantes. Se puede repetir sin miedo: actualiza lo que ya existe.
   */
  async provision(): Promise<TwilioProvisionResult> {
    const c = await this.settings.twilio();
    if (!c.accountSid || !c.authToken || !c.number) {
      return { ok: false, message: "Faltan Account SID, Auth Token o el número de Twilio", appSid: null, voiceUrl: null };
    }
    if (!c.apiKeySid || !c.apiKeySecret) {
      return { ok: false, message: "Faltan la API Key y su secreto (Twilio Console › Account › API keys)", appSid: null, voiceUrl: null };
    }
    const base = await this.settings.publicApiBase();
    if (!base) {
      return {
        ok: false,
        message: "Driony necesita una URL pública para recibir los webhooks: define API_PUBLIC_URL (o SAAS_BASE_DOMAIN) en el servidor",
        appSid: null,
        voiceUrl: null,
      };
    }
    const slug = await this.slug();
    const url = (path: string) => `${base}/api/v1/calls/twilio/${slug}/${path}`;
    const client = twilio(c.accountSid, c.authToken);
    try {
      let appSid = c.appSid;
      const appData = { friendlyName: `Driony · ${slug}`, voiceUrl: url("outbound"), voiceMethod: "POST" as const };
      if (appSid) {
        await client.applications(appSid).update(appData).catch(async () => {
          appSid = (await client.applications.create(appData)).sid;
        });
      } else {
        appSid = (await client.applications.create(appData)).sid;
      }
      await this.settings.setTwilioAppSid(appSid!);

      const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: c.number, limit: 1 });
      const num = numbers[0];
      if (!num) {
        return { ok: false, message: `El número ${c.number} no está en esta cuenta de Twilio`, appSid: appSid!, voiceUrl: url("outbound") };
      }
      await client.incomingPhoneNumbers(num.sid).update({
        voiceUrl: url("inbound"),
        voiceMethod: "POST",
        statusCallback: url("status"),
        statusCallbackMethod: "POST",
      });
      return { ok: true, message: "Twilio apunta a Driony: ya puedes llamar y recibir llamadas", appSid: appSid!, voiceUrl: url("outbound") };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`Twilio provision falló: ${msg}`);
      return { ok: false, message: `Twilio respondió: ${msg}`, appSid: c.appSid, voiceUrl: null };
    }
  }

  // ── Webhooks de Twilio ──────────────────────────────────────
  /** La empresa de una ruta /calls/twilio/<slug>/… */
  async orgBySlug(slug: string): Promise<{ id: string; slug: string }> {
    const org = await runUnscoped("webhook de Twilio: empresa por slug", () =>
      this.prisma.organization.findUnique({ where: { slug: slug.trim().toLowerCase() }, select: { id: true, slug: true } }),
    );
    if (!org) throw new NotFoundException("Empresa no encontrada");
    return org;
  }

  /**
   * Firma X-Twilio-Signature: HMAC-SHA1 de la URL completa más los parámetros
   * del POST, con el auth token de la empresa. Sin token guardado no entra nada.
   */
  async verify(req: Request, orgId: string): Promise<TwilioCreds> {
    const c = await this.settings.twilio(orgId);
    if (!c.authToken) throw new UnauthorizedException("Esta empresa no tiene configurado Twilio");
    const base = await this.settings.publicApiBase();
    const signature = req.headers["x-twilio-signature"];
    if (typeof signature !== "string" || !base) throw new UnauthorizedException("Firma ausente");
    const url = `${base}${req.originalUrl}`;
    const params = (req.body ?? {}) as Record<string, string>;
    if (!twilio.validateRequest(c.authToken, signature, url, params)) {
      throw new UnauthorizedException("Firma de Twilio inválida");
    }
    return c;
  }

  /** El softphone marcó: Twilio pide qué hacer con la llamada. */
  async outboundTwiml(creds: TwilioCreds, slug: string, p: TwilioParams): Promise<string> {
    const r = new VoiceResponse();
    const to = p.To ? normalizePhone(p.To) : "";
    if (!to || !isValidPhone(to)) {
      r.say({ language: "es-MX" }, "Número no válido.");
      return r.toString();
    }
    const agentId = userOfIdentity(p.From);
    const contact =
      (p.contactId ? await this.prisma.contact.findUnique({ where: { id: p.contactId }, select: { id: true } }) : null) ??
      (await this.prisma.contact.findFirst({ where: { phone: to }, select: { id: true } }));
    const conversationId = p.conversationId || (contact ? await this.openConversation(contact.id) : null);
    const call = await this.prisma.call.create({
      data: {
        orgId: this.tenant.orgId(),
        contactId: contact?.id ?? null,
        conversationId,
        agentId,
        direction: "OUTBOUND",
        status: "queued",
        provider: "twilio",
        providerSid: p.CallSid ?? null,
        fromNumber: creds.number ?? "",
        toNumber: to,
        startedAt: new Date(),
      },
    });
    this.changed(call.id, call.conversationId);

    const base = await this.settings.publicApiBase();
    const url = (path: string) => `${base}/api/v1/calls/twilio/${slug}/${path}`;
    const dial = r.dial({
      callerId: creds.number ?? undefined,
      ...(creds.record
        ? { record: "record-from-answer-dual" as const, recordingStatusCallback: url("recording"), recordingStatusCallbackEvent: ["completed"] }
        : {}),
    });
    dial.number(
      { statusCallback: url("status"), statusCallbackEvent: ["initiated", "ringing", "answered", "completed"], statusCallbackMethod: "POST" },
      to,
    );
    return r.toString();
  }

  /** Llaman al número de la empresa: suena en los navegadores del equipo. */
  async inboundTwiml(creds: TwilioCreds, slug: string, p: TwilioParams): Promise<string> {
    const r = new VoiceResponse();
    const orgId = this.tenant.orgId();
    const from = p.From ? normalizePhone(p.From) : "";
    const contact = from && isValidPhone(from) ? await this.findOrCreateContact(orgId, from) : null;
    const conversationId = contact ? await this.openConversation(contact.id) : null;
    const call = await this.prisma.call.create({
      data: {
        orgId,
        contactId: contact?.id ?? null,
        conversationId,
        direction: "INBOUND",
        status: "ringing",
        provider: "twilio",
        providerSid: p.CallSid ?? null,
        fromNumber: from || (p.From ?? ""),
        toNumber: creds.number ?? (p.To ?? ""),
        startedAt: new Date(),
      },
    });
    this.changed(call.id, conversationId);

    const agents = await this.prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: MAX_AGENTS,
    });
    if (!agents.length) {
      r.say({ language: "es-MX" }, "En este momento no podemos atender la llamada. Escríbenos por WhatsApp.");
      await this.prisma.call.update({ where: { id: call.id }, data: { status: "missed", endedAt: new Date() } });
      this.missed(call.id, orgId, contact?.id ?? null, conversationId);
      return r.toString();
    }
    const base = await this.settings.publicApiBase();
    const url = (path: string) => `${base}/api/v1/calls/twilio/${slug}/${path}`;
    const dial = r.dial({
      timeout: RING_SECONDS,
      action: url("dial-result"),
      method: "POST",
      ...(creds.record
        ? { record: "record-from-answer-dual" as const, recordingStatusCallback: url("recording"), recordingStatusCallbackEvent: ["completed"] }
        : {}),
    });
    const name = contact ? (await this.prisma.contact.findUnique({ where: { id: contact.id }, select: { name: true } }))?.name : null;
    for (const a of agents) {
      const client = dial.client({});
      client.identity(identityOf(a.id));
      // Lo que ve el agente al sonar: quién llama y a qué chat pertenece.
      client.parameter({ name: "callId", value: call.id });
      client.parameter({ name: "contactName", value: name ?? "" });
      if (contact) client.parameter({ name: "contactId", value: contact.id });
      if (conversationId) client.parameter({ name: "conversationId", value: conversationId });
    }
    return r.toString();
  }

  /** Terminó el intento de sonar al equipo: contestaron o no. */
  async dialResult(p: TwilioParams): Promise<string> {
    const r = new VoiceResponse();
    const call = p.CallSid ? await this.prisma.call.findFirst({ where: { providerSid: p.CallSid } }) : null;
    const dialStatus = p.DialCallStatus ?? "";
    if (call && dialStatus !== "completed" && call.status !== "completed") {
      await this.prisma.call.update({ where: { id: call.id }, data: { status: "missed", endedAt: new Date() } });
      this.missed(call.id, call.orgId, call.contactId, call.conversationId);
      r.say({ language: "es-MX" }, "No pudimos atender tu llamada. Te escribiremos en cuanto estemos disponibles.");
    }
    return r.toString();
  }

  /** Cambios de estado de cualquiera de las dos patas de la llamada. */
  async status(p: TwilioParams): Promise<void> {
    const sid = p.ParentCallSid || p.CallSid;
    if (!sid) return;
    const call = await this.prisma.call.findFirst({ where: { providerSid: sid } });
    if (!call) return;
    const mapped = STATUS_MAP[p.CallStatus ?? ""];
    if (!mapped) return;
    // Una llamada ya cerrada no vuelve atrás por un callback tardío.
    if (["completed", "missed", "no_answer", "busy", "failed", "canceled"].includes(call.status) && !["completed"].includes(mapped)) return;
    const data: Record<string, unknown> = {};
    if (call.direction === "INBOUND" && (mapped === "no_answer" || mapped === "canceled" || mapped === "failed" || mapped === "busy")) {
      data.status = call.answeredAt ? "completed" : "missed";
    } else {
      data.status = mapped;
    }
    if (mapped === "in_progress" && !call.answeredAt) data.answeredAt = new Date();
    if (["completed", "no_answer", "busy", "failed", "canceled"].includes(mapped)) {
      data.endedAt = new Date();
      if (p.CallDuration) data.durationSec = Number(p.CallDuration) || 0;
    }
    await this.prisma.call.update({ where: { id: call.id }, data });
    this.changed(call.id, call.conversationId);
    if (data.status === "missed") this.missed(call.id, call.orgId, call.contactId, call.conversationId);
  }

  /** La grabación está lista: se guarda en nuestro almacenamiento y se transcribe. */
  async recording(creds: TwilioCreds, p: TwilioParams): Promise<void> {
    if (p.RecordingStatus && p.RecordingStatus !== "completed") return;
    const sid = p.CallSid;
    if (!sid || !p.RecordingUrl) return;
    const call = await this.prisma.call.findFirst({ where: { providerSid: sid } });
    if (!call) return;
    await this.prisma.call.update({ where: { id: call.id }, data: { recordingSid: p.RecordingSid ?? null } });
    try {
      const res = await fetch(`${p.RecordingUrl}.mp3`, {
        headers: { Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}` },
      });
      if (!res.ok) throw new Error(`descarga ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const stored = await this.storage.save(buffer, "audio/mpeg", `llamada-${call.id}.mp3`);
      const recordingUrl = toStorageRef(stored.id);
      await this.prisma.call.update({ where: { id: call.id }, data: { recordingUrl } });
      this.changed(call.id, call.conversationId);
      const transcript = await this.media.transcribeAudio(
        { buffer, mimeType: "audio/mpeg", size: buffer.length, fileName: `llamada-${call.id}.mp3` },
        call.conversationId ?? "",
      );
      if (transcript) {
        await this.prisma.call.update({ where: { id: call.id }, data: { transcript } });
        this.changed(call.id, call.conversationId);
      }
    } catch (e) {
      this.logger.warn(`Grabación de ${call.id} no procesada: ${(e as Error).message}`);
    }
  }

  // ── Para la app ─────────────────────────────────────────────
  async list(filter: { conversationId?: string; contactId?: string }): Promise<CallDto[]> {
    if (!filter.conversationId && !filter.contactId) throw new BadRequestException("Falta conversationId o contactId");
    const rows = await this.prisma.call.findMany({
      where: {
        ...(filter.conversationId ? { conversationId: filter.conversationId } : {}),
        ...(filter.contactId ? { contactId: filter.contactId } : {}),
      },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return rows.map((r) => this.toDto(r));
  }

  /** Llamada hecha o recibida fuera del CRM (desde el celular): queda en el hilo. */
  async logManual(userId: string, input: CreateManualCallInput): Promise<CallDto> {
    const contact = await this.prisma.contact.findUnique({ where: { id: input.contactId } });
    if (!contact) throw new NotFoundException("Contacto no encontrado");
    const conversationId = input.conversationId ?? (await this.openConversation(contact.id));
    const at = input.at ? new Date(input.at) : new Date();
    const own = (await this.settings.twilio()).number ?? "";
    const call = await this.prisma.call.create({
      data: {
        orgId: this.tenant.orgId(),
        contactId: contact.id,
        conversationId,
        agentId: userId,
        direction: input.direction,
        status: input.outcome === "answered" || input.outcome === "callback" ? "completed" : input.direction === "INBOUND" ? "missed" : "no_answer",
        provider: "manual",
        fromNumber: input.direction === "OUTBOUND" ? own : contact.phone,
        toNumber: input.direction === "OUTBOUND" ? contact.phone : own,
        startedAt: at,
        answeredAt: input.outcome === "answered" ? at : null,
        endedAt: at,
        durationSec: input.durationSec ?? null,
        outcome: input.outcome,
        note: input.note?.trim() || null,
        createdAt: at,
      },
      include: { agent: { select: { id: true, name: true } } },
    });
    this.changed(call.id, conversationId);
    return this.toDto(call);
  }

  /** Resultado y nota de una llamada; `id` puede ser el nuestro o el CallSid de Twilio. */
  async update(id: string, input: UpdateCallInput): Promise<CallDto> {
    const call = await this.prisma.call.findFirst({ where: { OR: [{ id }, { providerSid: id }] } });
    if (!call) throw new NotFoundException("Llamada no encontrada");
    const updated = await this.prisma.call.update({
      where: { id: call.id },
      data: {
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      },
      include: { agent: { select: { id: true, name: true } } },
    });
    this.changed(updated.id, updated.conversationId);
    return this.toDto(updated);
  }

  // ── Internos ────────────────────────────────────────────────
  private ready(c: TwilioCreds): boolean {
    return !!(c.accountSid && c.authToken && c.apiKeySid && c.apiKeySecret && c.number);
  }

  private async slug(): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: this.tenant.orgId() }, select: { slug: true } });
    return org?.slug ?? "default";
  }

  private async findOrCreateContact(orgId: string, phone: string): Promise<{ id: string }> {
    const existing = await this.prisma.contact.findFirst({ where: { phone }, select: { id: true } });
    if (existing) return existing;
    return this.prisma.contact.create({ data: { orgId, phone, origin: "call" }, select: { id: true } });
  }

  /** La conversación abierta más reciente del contacto; si no tiene, se abre una. */
  private async openConversation(contactId: string): Promise<string> {
    const open = await this.prisma.conversation.findFirst({
      where: { contactId, status: { not: ConversationStatus.CLOSED } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (open) return open.id;
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId }, select: { orgId: true } });
    const created = await this.prisma.conversation.create({
      data: { orgId: contact?.orgId ?? this.tenant.orgId(), contactId, status: ConversationStatus.OPEN },
      select: { id: true },
    });
    return created.id;
  }

  private changed(callId: string, conversationId: string | null): void {
    this.events.emit("call.changed", { orgId: this.tenant.orgId(), callId, conversationId });
  }

  private missed(callId: string, orgId: string, contactId: string | null, conversationId: string | null): void {
    this.events.emit("call.changed", { orgId, callId, conversationId, missed: true });
    if (contactId) this.events.emit("call.missed", { orgId, contactId, callId, conversationId });
  }

  private toDto(r: {
    id: string;
    contactId: string | null;
    conversationId: string | null;
    agent: { id: string; name: string | null } | null;
    direction: string;
    status: string;
    provider: string;
    fromNumber: string;
    toNumber: string;
    startedAt: Date | null;
    answeredAt: Date | null;
    endedAt: Date | null;
    durationSec: number | null;
    recordingUrl: string | null;
    transcript: string | null;
    outcome: string | null;
    note: string | null;
    createdAt: Date;
  }): CallDto {
    return {
      id: r.id,
      contactId: r.contactId,
      conversationId: r.conversationId,
      agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
      direction: r.direction as CallDto["direction"],
      status: r.status as CallDto["status"],
      provider: r.provider,
      fromNumber: r.fromNumber,
      toNumber: r.toNumber,
      startedAt: r.startedAt?.toISOString() ?? null,
      answeredAt: r.answeredAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      durationSec: r.durationSec,
      recordingUrl: r.recordingUrl,
      transcript: r.transcript,
      outcome: r.outcome as CallDto["outcome"],
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
