import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { Queue } from "bullmq";
import type { Prisma } from "@prisma/client";
import {
  EMPTY_AUDIENCE,
  campaignAudienceSchema,
  countryFromPhone,
  type AudienceCount,
  type AudienceTag,
  type CampaignAudience,
  type CampaignDto,
  type CampaignMeta,
  type CampaignRecipient,
  type CampaignStatusValue,
  type CampaignTestInput,
  type CreateCampaignInput,
  type RecipientStatus,
  type TemplateButton,
  type TemplateHeader,
  type UpdateCampaignInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { currentOrgId } from "../../infra/tenant/tenant.context";
import { QUEUE_CAMPAIGN } from "../../infra/queue/queue.constants";
import { TemplateFillService, normalizeFill } from "./template-fill.service";
import { TemplateService } from "./template.service";
import { PlansService } from "../plans/plans.service";
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from "../whatsapp/whatsapp-provider.interface";

/** Ventana para contar una respuesta como respuesta a la difusión. */
const REPLY_WINDOW_DAYS = 7;
const INCLUDE = { template: true, channel: true, tags: true } as const;

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

@Injectable()
export class CampaignService {
  private readonly logger = new Logger("Difusiones");

  constructor(
    private readonly plans: PlansService,
    private readonly prisma: PrismaService,
    private readonly templates: TemplateService,
    private readonly fills: TemplateFillService,
    private readonly events: EventEmitter2,
    @Inject(WHATSAPP_PROVIDER) private readonly wa: WhatsAppProvider,
    @InjectQueue(QUEUE_CAMPAIGN) private readonly queue: Queue,
  ) {}

  /**
   * Las difusiones no llevan `orgId`: son de la empresa dueña de su plantilla.
   * La capa 1 (filtro automático) no alcanza a las relaciones, así que se
   * filtra aquí; RLS (política por la plantilla) es la red de abajo.
   */
  private scope(): Prisma.CampaignWhereInput {
    const orgId = currentOrgId();
    return orgId ? { template: { orgId } } : {};
  }

  // ── Lectura ──────────────────────────────────────────────────
  async list(): Promise<CampaignDto[]> {
    const rows = await this.prisma.campaign.findMany({ where: this.scope(), orderBy: { createdAt: "desc" }, include: INCLUDE });
    return rows.map((c) => this.toDto(c));
  }

  async getById(id: string): Promise<CampaignDto> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id }, include: INCLUDE });
    if (!c) throw new NotFoundException("Difusión no encontrada");
    return this.toDto(c);
  }

  // Datos para el asistente: plantillas + etiquetas (con conteo) + canales.
  async meta(): Promise<CampaignMeta> {
    const [templates, tags, channels] = await Promise.all([
      this.templates.list(),
      this.prisma.tag.findMany({ orderBy: { name: "asc" } }),
      this.prisma.whatsappConnection.findMany({ where: { isActive: true }, orderBy: { connectedAt: "desc" } }),
    ]);
    const audienceTags: AudienceTag[] = await Promise.all(
      tags.map(async (t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        contactCount: await this.prisma.contact.count({ where: { optIn: true, tags: { some: { tagId: t.id } } } }),
      })),
    );
    return {
      templates,
      tags: audienceTags,
      channels: channels.map((c) => ({ id: c.id, label: c.label, displayPhoneNumber: c.displayPhoneNumber })),
    };
  }

  // ── Audiencia ────────────────────────────────────────────────
  /** Compatibilidad: el formato antiguo solo tenía etiquetas («alguna de»). */
  private audienceOf(c: { audience: unknown; tags: { tagId: string }[] }): CampaignAudience {
    const parsed = c.audience ? campaignAudienceSchema.safeParse(c.audience) : null;
    if (parsed?.success) return parsed.data;
    return { ...EMPTY_AUDIENCE, tags: c.tags.map((t) => t.tagId) };
  }

  private audienceWhere(a: CampaignAudience, opts: { skipRecent: boolean }): Prisma.ContactWhereInput {
    const and: Prisma.ContactWhereInput[] = [];
    if (a.tags.length) {
      if (a.tagsMode === "all") for (const tagId of a.tags) and.push({ tags: { some: { tagId } } });
      else and.push({ tags: { some: { tagId: { in: a.tags } } } });
    }
    if (a.excludeTags.length) and.push({ NOT: { tags: { some: { tagId: { in: a.excludeTags } } } } });
    if (a.contactIds.length) and.push({ id: { in: a.contactIds } });
    if (a.stageIds.length) and.push({ deals: { some: { stageId: { in: a.stageIds }, discardedAt: null } } });
    if (a.sourceIds.length) {
      const ids = a.sourceIds.filter((s) => s !== "none");
      const or: Prisma.ContactWhereInput[] = [];
      if (ids.length) or.push({ sourceId: { in: ids } });
      if (a.sourceIds.includes("none")) or.push({ sourceId: null });
      and.push({ OR: or });
    }
    const since = new Date(Date.now() - a.activityDays * 86_400_000);
    if (a.activity === "within") and.push({ lastMessageAt: { gte: since } });
    if (a.activity === "older") and.push({ OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: since } }] });
    if (opts.skipRecent && a.skipRecentDays) {
      const recent = new Date(Date.now() - a.skipRecentDays * 86_400_000);
      and.push({ NOT: { conversations: { some: { messages: { some: { campaignId: { not: null }, createdAt: { gte: recent } } } } } } });
    }
    return { optIn: true, AND: and };
  }

  /** Ids de contactos de la audiencia (el país se mira por el prefijo, aquí). */
  private async audienceIds(a: CampaignAudience, opts: { skipRecent: boolean } = { skipRecent: true }): Promise<string[]> {
    const rows = await this.prisma.contact.findMany({ where: this.audienceWhere(a, opts), select: { id: true, phone: true } });
    if (!a.countries.length) return rows.map((r) => r.id);
    const wanted = new Set(a.countries);
    return rows.filter((r) => wanted.has(countryFromPhone(r.phone)?.code ?? "")).map((r) => r.id);
  }

  async audienceCount(a: CampaignAudience): Promise<AudienceCount> {
    const [ids, withoutSkip, optedIn] = await Promise.all([
      this.audienceIds(a),
      a.skipRecentDays ? this.audienceIds(a, { skipRecent: false }) : Promise.resolve(null),
      this.prisma.contact.count({ where: { optIn: true } }),
    ]);
    return { count: ids.length, optedIn, skippedRecent: withoutSkip ? withoutSkip.length - ids.length : 0 };
  }

  /** Formato antiguo (solo etiquetas), para quien aún lo llame. */
  async audiencePreview(tagIds: string[]): Promise<{ count: number }> {
    return { count: (await this.audienceIds({ ...EMPTY_AUDIENCE, tags: tagIds })).length };
  }

  // ── Escritura ────────────────────────────────────────────────
  async create(input: CreateCampaignInput): Promise<CampaignDto> {
    await this.plans.assertFeature("broadcasts");
    const template = await this.prisma.template.findUnique({ where: { id: input.templateId } });
    if (!template) throw new BadRequestException("Plantilla no encontrada");
    const audience = input.audience ?? { ...EMPTY_AUDIENCE, tags: input.tagIds };
    const c = await this.prisma.campaign.create({
      data: {
        name: input.name,
        templateId: input.templateId,
        channelId: input.channelId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        variableValues: input.fill as unknown as Prisma.InputJsonValue,
        audience: audience as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
        tags: { create: audience.tags.map((tagId) => ({ tagId })) },
      },
      include: INCLUDE,
    });
    return this.toDto(c);
  }

  async update(id: string, input: UpdateCampaignInput): Promise<CampaignDto> {
    const existing = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id } });
    if (!existing) throw new NotFoundException("Difusión no encontrada");
    if (existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
      throw new BadRequestException("Solo se pueden editar difusiones en borrador o programadas.");
    }
    const audience = input.audience ?? (input.tagIds !== undefined ? { ...EMPTY_AUDIENCE, tags: input.tagIds } : undefined);
    const c = await this.prisma.campaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
        ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
        ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null } : {}),
        ...(input.fill !== undefined ? { variableValues: input.fill as unknown as Prisma.InputJsonValue } : {}),
        ...(audience
          ? {
              audience: audience as unknown as Prisma.InputJsonValue,
              tags: { deleteMany: {}, create: audience.tags.map((tagId) => ({ tagId })) },
            }
          : {}),
      },
      include: INCLUDE,
    });
    return this.toDto(c);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id } });
    if (!c) throw new NotFoundException("Difusión no encontrada");
    if (c.status === "RUNNING") throw new BadRequestException("No puedes eliminar una difusión en curso.");
    await this.prisma.campaign.delete({ where: { id } });
    return { ok: true };
  }

  /** Una copia en borrador: misma plantilla, número, variables y audiencia. */
  async duplicate(id: string): Promise<CampaignDto> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id }, include: INCLUDE });
    if (!c) throw new NotFoundException("Difusión no encontrada");
    const audience = this.audienceOf(c);
    const copy = await this.prisma.campaign.create({
      data: {
        name: `${c.name} (copia)`.slice(0, 120),
        templateId: c.templateId,
        channelId: c.channelId,
        variableValues: (c.variableValues ?? undefined) as Prisma.InputJsonValue | undefined,
        audience: audience as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
        tags: { create: audience.tags.map((tagId) => ({ tagId })) },
      },
      include: INCLUDE,
    });
    return this.toDto(copy);
  }

  // ── Envío de prueba ──────────────────────────────────────────
  /** La plantilla tal cual le llegará a un contacto, a un número cualquiera (el tuyo). */
  async sendTest(input: CampaignTestInput): Promise<{ ok: true }> {
    const [template, channel] = await Promise.all([
      this.prisma.template.findUnique({ where: { id: input.templateId } }),
      input.channelId ? this.prisma.whatsappConnection.findUnique({ where: { id: input.channelId } }) : Promise.resolve(null),
    ]);
    if (!template) throw new BadRequestException("Plantilla no encontrada");
    if (template.status !== "APPROVED") throw new BadRequestException("La plantilla aún no está aprobada por Meta.");
    const digits = input.phone.replace(/[^\d]/g, "");
    const phone = `+${digits}`;
    // Las variables que vienen del contacto se rellenan como si fuera uno llamado «Prueba».
    const spec = await this.fills.build(
      {
        name: template.name,
        language: template.language,
        header: (template.header as TemplateHeader | null) ?? null,
        buttons: (template.buttons as TemplateButton[] | null) ?? [],
        body: template.body,
      },
      normalizeFill(input.fill),
      { name: "Prueba", phone },
      channel?.phoneNumberId,
    );
    try {
      await this.wa.sendTemplate(phone, spec, channel?.phoneNumberId);
    } catch (e) {
      throw new BadRequestException(`WhatsApp no aceptó la prueba: ${(e as Error).message}`);
    }
    return { ok: true };
  }

  // ── Lanzamiento ──────────────────────────────────────────────
  async launch(id: string): Promise<CampaignDto> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id } });
    if (!c) throw new NotFoundException("Difusión no encontrada");
    if (c.status === "RUNNING") throw new BadRequestException("La difusión ya está en curso.");

    // Programada a futuro: encolar un job retrasado que dispara el fan-out.
    if (c.scheduledAt && c.scheduledAt.getTime() > Date.now()) {
      await this.prisma.campaign.update({ where: { id }, data: { status: "SCHEDULED" } });
      await this.queue.add(
        "launch",
        { kind: "launch", campaignId: id, orgId: currentOrgId() ?? undefined },
        { delay: c.scheduledAt.getTime() - Date.now() },
      );
      return this.getById(id);
    }
    await this.fanOut(id);
    return this.getById(id);
  }

  // Calcula la audiencia y encola un job de envío por destinatario.
  async fanOut(campaignId: string): Promise<void> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id: campaignId }, include: { tags: true } });
    if (!c) return;
    const contacts = await this.audienceIds(this.audienceOf(c));
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: contacts.length ? "RUNNING" : "COMPLETED",
        startedAt: new Date(),
        completedAt: contacts.length ? null : new Date(),
        totalRecipients: contacts.length,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        failedCount: 0,
        repliedCount: 0,
      },
    });
    if (!contacts.length) return;
    const orgId = currentOrgId() ?? undefined;
    await this.queue.addBulk(contacts.map((contactId) => ({ name: "send", data: { kind: "send", campaignId, contactId, orgId } })));
  }

  async cancel(id: string): Promise<CampaignDto> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id } });
    if (!c) throw new NotFoundException("Difusión no encontrada");
    await this.prisma.campaign.update({ where: { id }, data: { status: "CANCELLED" } });
    return this.getById(id);
  }

  // ── Métricas ─────────────────────────────────────────────────
  /**
   * Recalcula las cifras desde los mensajes: por destinatario cuenta su
   * último envío (un reintento sustituye al fallo). Respondió = escribió en
   * los 7 días siguientes. Se llama tras cada envío y cada aviso de estado.
   */
  async refreshStats(campaignId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT x.status::text AS status, count(*) AS n, count(*) FILTER (WHERE x.replied) AS r
      FROM (
        SELECT DISTINCT ON (m."conversationId") m.status,
          EXISTS (
            SELECT 1 FROM messages i
            WHERE i."conversationId" = m."conversationId" AND i.direction = 'INBOUND'
              AND i."createdAt" > m."createdAt" AND i."createdAt" < m."createdAt" + make_interval(days => ${REPLY_WINDOW_DAYS}::int)
          ) AS replied
        FROM messages m
        WHERE m."campaignId" = ${campaignId}
        ORDER BY m."conversationId", m."createdAt" DESC
      ) x
      GROUP BY 1`;
    const by = new Map(rows.map((r) => [String(r.status), n(r.n)]));
    const replied = rows.reduce((a, r) => a + n(r.r), 0);
    const read = by.get("READ") ?? 0;
    const delivered = (by.get("DELIVERED") ?? 0) + read;
    const sent = (by.get("SENT") ?? 0) + delivered;
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { sentCount: sent, deliveredCount: delivered, readCount: read, failedCount: by.get("FAILED") ?? 0, repliedCount: replied },
    });
  }

  @OnEvent("campaign.stats_stale", { async: true })
  async onStatsStale(e: { campaignId: string }): Promise<void> {
    try {
      await this.refreshStats(e.campaignId);
    } catch (err) {
      this.logger.warn(`Métricas de ${e.campaignId}: ${(err as Error).message}`);
    }
  }

  /** El cliente escribió: si fue tras una difusión reciente, cuenta como respuesta. */
  @OnEvent("conversation.inbound", { async: true })
  async onInbound(e: { conversationId: string }): Promise<void> {
    try {
      const since = new Date(Date.now() - REPLY_WINDOW_DAYS * 86_400_000);
      const m = await this.prisma.message.findFirst({
        where: { conversationId: e.conversationId, campaignId: { not: null }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { campaignId: true },
      });
      if (m?.campaignId) await this.refreshStats(m.campaignId);
    } catch (err) {
      this.logger.warn(`Respuesta a difusión en ${e.conversationId}: ${(err as Error).message}`);
    }
  }

  // Marca COMPLETED cuando ya se procesaron todos los destinatarios.
  async checkCompletion(campaignId: string): Promise<void> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id: campaignId } });
    if (!c || c.status !== "RUNNING") return;
    const processed = c.sentCount + c.failedCount;
    if (processed >= c.totalRecipients) {
      await this.prisma.campaign.update({ where: { id: campaignId }, data: { status: "COMPLETED", completedAt: new Date() } });
    }
  }

  // ── Destinatarios ────────────────────────────────────────────
  private async lastPerRecipient(campaignId: string): Promise<CampaignRecipient[]> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT DISTINCT ON (m."conversationId")
        m."conversationId" AS "conversationId", m.status::text AS status, m."errorReason" AS error, m."createdAt" AS "sentAt",
        c.id AS "contactId", c.name, c.phone,
        EXISTS (
          SELECT 1 FROM messages i
          WHERE i."conversationId" = m."conversationId" AND i.direction = 'INBOUND'
            AND i."createdAt" > m."createdAt" AND i."createdAt" < m."createdAt" + make_interval(days => ${REPLY_WINDOW_DAYS}::int)
        ) AS replied
      FROM messages m
      JOIN conversations cv ON cv.id = m."conversationId"
      JOIN contacts c ON c.id = cv."contactId"
      WHERE m."campaignId" = ${campaignId}
      ORDER BY m."conversationId", m."createdAt" DESC`;
    return rows.map((r) => ({
      contactId: String(r.contactId),
      name: (r.name as string | null) ?? null,
      phone: String(r.phone),
      status: String(r.status).toLowerCase() as RecipientStatus,
      replied: !!r.replied,
      error: (r.error as string | null) ?? null,
      sentAt: (r.sentAt as Date).toISOString(),
      conversationId: String(r.conversationId),
    }));
  }

  async recipients(id: string): Promise<CampaignRecipient[]> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id }, select: { id: true } });
    if (!c) throw new NotFoundException("Difusión no encontrada");
    // Al abrir la ficha se recalculan las métricas: repara también las
    // difusiones antiguas, de cuando los contadores se sumaban a ciegas.
    await this.refreshStats(id);
    const rows = await this.lastPerRecipient(id);
    // Primero lo que pide atención: fallidos, luego quien respondió.
    const rank = (r: CampaignRecipient) => (r.status === "failed" ? 0 : r.replied ? 1 : 2);
    return rows.sort((a, b) => rank(a) - rank(b) || b.sentAt.localeCompare(a.sentAt)).slice(0, 2000);
  }

  /** Vuelve a enviar a quien falló (y sigue con permiso). */
  async retryFailed(id: string): Promise<{ queued: number }> {
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id } });
    if (!c) throw new NotFoundException("Difusión no encontrada");
    if (c.status === "RUNNING") throw new BadRequestException("Espera a que termine el envío en curso.");
    const failed = (await this.lastPerRecipient(id)).filter((r) => r.status === "failed");
    const allowed = await this.prisma.contact.findMany({ where: { id: { in: failed.map((f) => f.contactId) }, optIn: true }, select: { id: true } });
    if (!allowed.length) return { queued: 0 };
    await this.prisma.campaign.update({ where: { id }, data: { status: "RUNNING", completedAt: null } });
    const orgId = currentOrgId() ?? undefined;
    await this.queue.addBulk(allowed.map((ct) => ({ name: "send", data: { kind: "send", campaignId: id, contactId: ct.id, orgId } })));
    return { queued: allowed.length };
  }

  /** Etiqueta a quienes respondieron: para hacerles seguimiento o un flujo. */
  async tagResponders(id: string, tagName: string): Promise<{ tagged: number }> {
    const orgId = currentOrgId();
    if (!orgId) throw new BadRequestException("Sin empresa");
    const c = await this.prisma.campaign.findFirst({ where: { ...this.scope(), id }, select: { id: true } });
    if (!c) throw new NotFoundException("Difusión no encontrada");
    const responders = [...new Set((await this.lastPerRecipient(id)).filter((r) => r.replied).map((r) => r.contactId))];
    if (!responders.length) return { tagged: 0 };
    const tag = await this.prisma.tag.upsert({ where: { orgId_name: { orgId, name: tagName } }, create: { orgId, name: tagName }, update: {} });
    const had = new Set(
      (await this.prisma.contactTag.findMany({ where: { tagId: tag.id, contactId: { in: responders } }, select: { contactId: true } })).map((x) => x.contactId),
    );
    const fresh = responders.filter((r) => !had.has(r));
    if (fresh.length) {
      await this.prisma.contactTag.createMany({ data: fresh.map((contactId) => ({ contactId, tagId: tag.id })), skipDuplicates: true });
      for (const contactId of fresh) this.events.emit("contact.tagged", { orgId, contactId, tag: tagName });
    }
    return { tagged: fresh.length };
  }

  private toDto(c: {
    id: string;
    name: string;
    status: string;
    scheduledAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    variableValues: unknown;
    audience: unknown;
    totalRecipients: number;
    sentCount: number;
    deliveredCount: number;
    readCount: number;
    failedCount: number;
    repliedCount: number;
    createdAt: Date;
    template: { id: string; name: string };
    channel?: { id: string; label: string | null; displayPhoneNumber: string | null } | null;
    tags: { tagId: string }[];
  }): CampaignDto {
    return {
      id: c.id,
      name: c.name,
      status: c.status as CampaignStatusValue,
      template: { id: c.template.id, name: c.template.name },
      channel: c.channel ? { id: c.channel.id, label: c.channel.label, displayPhoneNumber: c.channel.displayPhoneNumber } : null,
      tagIds: c.tags.map((t) => t.tagId),
      audience: this.audienceOf(c),
      fill: normalizeFill(c.variableValues),
      scheduledAt: c.scheduledAt?.toISOString() ?? null,
      startedAt: c.startedAt?.toISOString() ?? null,
      completedAt: c.completedAt?.toISOString() ?? null,
      totalRecipients: c.totalRecipients,
      sentCount: c.sentCount,
      deliveredCount: c.deliveredCount,
      readCount: c.readCount,
      failedCount: c.failedCount,
      repliedCount: c.repliedCount,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
