import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  contactCurrency,
  MessageAuthor,
  MessageType,
  utmKeys,
  type CreatePublicContactInput,
  type CreatePublicDealInput,
  type FunnelStage,
  type ListContactsQuery,
  type PublicContact,
  type PublicDeal,
  type SellerStats,
  type SendPublicMessageInput,
  type SendPublicMessageResult,
  type StatsSummary,
  type UpdatePublicContactInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { PlansService } from "../plans/plans.service";
import { MessagingService } from "../messaging/messaging.service";
import { WebhookOutService } from "../webhooks-out/webhook-out.service";

interface Page<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Lógica de la API pública. Trabaja con los identificadores que un sistema
 * externo conoce —el teléfono, el nombre de la etapa, el de la etiqueta— en
 * vez de con ids internos, que nadie de fuera puede saber.
 */
@Injectable()
export class PublicApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly messaging: MessagingService,
    private readonly webhooks: WebhookOutService,
    private readonly plans: PlansService,
  ) {}

  // ── Contactos ───────────────────────────────────────────────
  async listContacts(q: ListContactsQuery): Promise<Page<PublicContact>> {
    const where: Prisma.ContactWhereInput = {};
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { phone: { contains: q.search } },
      ];
    }
    if (q.tag) where.tags = { some: { tag: { name: q.tag } } };
    if (q.createdSince) where.createdAt = { gte: new Date(q.createdSince) };

    // Se pide uno de más para saber si hay página siguiente sin un count().
    const rows = await this.prisma.contact.findMany({
      where,
      orderBy: { id: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { tags: { include: { tag: true } }, source: true },
    });

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      data: page.map((c) => this.toPublicContact(c)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async getContact(id: string): Promise<PublicContact> {
    const c = await this.prisma.contact.findUnique({
      where: { id },
      include: { tags: { include: { tag: true } }, source: true },
    });
    if (!c) throw new NotFoundException("Contacto no encontrado");
    return this.toPublicContact(c);
  }

  async createContact(
    input: CreatePublicContactInput,
    viaApiKey: string | null,
  ): Promise<PublicContact> {
    const orgId = this.tenant.orgId();
    const existing = await this.prisma.contact.findFirst({
      where: { phone: input.phone },
    });
    if (existing) {
      throw new BadRequestException(
        `Ya existe un contacto con el teléfono ${input.phone}`,
      );
    }

    const sourceId = input.source
      ? (
          await this.prisma.source.upsert({
            where: { orgId_name: { orgId, name: input.source } },
            create: { orgId, name: input.source },
            update: {},
          })
        ).id
      : undefined;

    await this.plans.assertCanAdd("contacts");
    const c = await this.prisma.contact.create({
      data: {
        orgId,
        phone: input.phone,
        name: input.name ?? null,
        optIn: input.optIn ?? true,
        ...(sourceId ? { sourceId } : {}),
        metadata: (input.fields ?? {}) as Prisma.InputJsonObject,
        origin: "webhook",
        originDetail: viaApiKey,
      },
      include: { tags: { include: { tag: true } }, source: true },
    });
    if (input.tags?.length) await this.setTags(c.id, input.tags);
    const created = await this.getContact(c.id);
    void this.webhooks.emit("contact.created", { contact: created });
    return created;
  }

  async updateContact(
    id: string,
    input: UpdatePublicContactInput,
  ): Promise<PublicContact> {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Contacto no encontrado");

    // Los campos se fusionan; borrar uno se hace enviándolo vacío.
    const metadata = input.fields
      ? {
          ...((existing.metadata as Record<string, unknown> | null) ?? {}),
          ...input.fields,
        }
      : undefined;

    await this.prisma.contact.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.optIn !== undefined ? { optIn: input.optIn } : {}),
        ...(metadata ? { metadata: metadata as Prisma.InputJsonObject } : {}),
      },
    });
    if (input.tags) await this.setTags(id, input.tags);
    return this.getContact(id);
  }

  // Reemplaza el juego de etiquetas, creando las que no existan.
  private async setTags(contactId: string, names: string[]): Promise<void> {
    const orgId = this.tenant.orgId();
    const clean = [...new Set(names.map((t) => t.trim()).filter(Boolean))];
    const tags = await Promise.all(
      clean.map((name) =>
        this.prisma.tag.upsert({
          where: { orgId_name: { orgId, name } },
          create: { orgId, name },
          update: {},
        }),
      ),
    );
    await this.prisma.contactTag.deleteMany({ where: { contactId } });
    if (tags.length) {
      await this.prisma.contactTag.createMany({
        data: tags.map((t) => ({ contactId, tagId: t.id })),
        skipDuplicates: true,
      });
    }
  }

  // ── Oportunidades ───────────────────────────────────────────
  async createDeal(input: CreatePublicDealInput): Promise<PublicDeal> {
    const orgId = this.tenant.orgId();
    await this.plans.assertCanAdd("deals");
    const contact = await this.prisma.contact.upsert({
      where: { orgId_phone: { orgId, phone: input.phone } },
      create: { orgId, phone: input.phone, origin: "webhook" },
      update: {},
    });

    const stage = input.stage
      ? await this.findStage(input.stage)
      : await this.prisma.pipelineStage.findFirst({
          where: { pipeline: { isDefault: true } },
          orderBy: { order: "asc" },
        });
    if (!stage) {
      throw new BadRequestException(
        "No hay etapas de pipeline configuradas en el CRM",
      );
    }

    const deal = await this.prisma.deal.create({
      data: {
        orgId,
        contactId: contact.id,
        stageId: stage.id,
        title: input.title,
        ...(input.value !== undefined ? { value: input.value } : {}),
        currency: input.currency?.toUpperCase() ?? contactCurrency(contact) ?? "USD",
      },
      include: { stage: true, contact: true, owner: true },
    });
    const dto = this.toPublicDeal(deal);
    void this.webhooks.emit("deal.created", { deal: dto });
    return dto;
  }

  async moveDeal(id: string, stageName: string): Promise<PublicDeal> {
    const existing = await this.prisma.deal.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Oportunidad no encontrada");
    const stage = await this.findStage(stageName);

    const deal = await this.prisma.deal.update({
      where: { id },
      data: { stageId: stage.id },
      include: { stage: true, contact: true, owner: true },
    });
    const dto = this.toPublicDeal(deal);
    void this.webhooks.emit("deal.stage_changed", {
      deal: dto,
      from: existing.stageId,
    });
    return dto;
  }

  // Por nombre, no por id: un sistema externo no conoce los cuids.
  private async findStage(name: string) {
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
      orderBy: { pipeline: { isDefault: "desc" } },
    });
    if (!stage) {
      const all = await this.prisma.pipelineStage.findMany({
        select: { name: true },
        orderBy: { order: "asc" },
      });
      throw new BadRequestException(
        `La etapa "${name}" no existe. Disponibles: ${all.map((s) => s.name).join(", ")}`,
      );
    }
    return stage;
  }

  // ── Mensajes ────────────────────────────────────────────────
  async sendMessage(
    input: SendPublicMessageInput,
  ): Promise<SendPublicMessageResult> {
    const contact = await this.prisma.contact.findFirst({
      where: { phone: input.phone },
    });
    if (!contact) {
      throw new NotFoundException(
        `No hay ningún contacto con el teléfono ${input.phone}`,
      );
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: { contactId: contact.id, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" },
    });
    if (!conversation) {
      throw new BadRequestException(
        "El contacto no tiene ninguna conversación abierta. WhatsApp solo permite escribir a quien te escribió en las últimas 24 h.",
      );
    }

    const msg = await this.messaging.queueOutbound(
      {
        conversationId: conversation.id,
        type: MessageType.TEXT,
        text: input.text,
      },
      MessageAuthor.HUMAN,
    );
    return {
      id: msg.id,
      conversationId: conversation.id,
      status: msg.status,
    };
  }

  // ── Métricas ────────────────────────────────────────────────
  async summary(days: number): Promise<StatsSummary> {
    const from = new Date(Date.now() - days * 86_400_000);
    const since = { gte: from };

    const [
      contactsTotal,
      contactsNew,
      convTotal,
      convOpen,
      convPending,
      msgIn,
      msgOut,
      runs,
      escalated,
      totals,
    ] = await Promise.all([
      this.prisma.contact.count(),
      this.prisma.contact.count({ where: { createdAt: since } }),
      this.prisma.conversation.count(),
      this.prisma.conversation.count({ where: { status: "OPEN" } }),
      this.prisma.conversation.count({ where: { status: "PENDING" } }),
      this.prisma.message.count({
        where: { direction: "INBOUND", createdAt: since },
      }),
      this.prisma.message.count({
        where: { direction: "OUTBOUND", createdAt: since },
      }),
      this.prisma.aiRun.count({ where: { createdAt: since } }),
      this.prisma.aiRun.count({
        where: { createdAt: since, status: "ESCALATED" },
      }),
      this.prisma.aiRun.aggregate({
        where: { createdAt: since },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      }),
    ]);

    return {
      from: from.toISOString(),
      to: new Date().toISOString(),
      contacts: { total: contactsTotal, nuevos: contactsNew },
      conversations: {
        total: convTotal,
        abiertas: convOpen,
        pendientes: convPending,
      },
      messages: { entrantes: msgIn, salientes: msgOut },
      ai: {
        runs,
        escalados: escalated,
        tokens:
          (totals._sum.inputTokens ?? 0) + (totals._sum.outputTokens ?? 0),
        costeUsd: Number(totals._sum.costUsd ?? 0),
      },
    };
  }

  async funnel(): Promise<FunnelStage[]> {
    // Embudo predeterminado, solo oportunidades abiertas.
    const stages = await this.prisma.pipelineStage.findMany({
      where: { pipeline: { isDefault: true } },
      orderBy: { order: "asc" },
      include: { deals: { where: { discardedAt: null }, select: { value: true } } },
    });
    return stages.map((s) => ({
      stage: s.name,
      order: s.order,
      deals: s.deals.length,
      value: s.deals.reduce((acc, d) => acc + Number(d.value ?? 0), 0),
    }));
  }

  async sellers(): Promise<SellerStats[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: {
        name: true,
        email: true,
        ownedDeals: { include: { stage: { select: { isWon: true } } } },
      },
    });
    return users
      .map((u) => ({
        seller: u.name ?? u.email,
        deals: u.ownedDeals.length,
        value: u.ownedDeals.reduce((a, d) => a + Number(d.value ?? 0), 0),
        ganados: u.ownedDeals.filter((d) => d.stage.isWon).length,
      }))
      .sort((a, b) => b.value - a.value);
  }

  // ── Mapeadores ──────────────────────────────────────────────
  private toPublicContact(c: {
    id: string;
    phone: string;
    name: string | null;
    optIn: boolean;
    origin: string;
    metadata: unknown;
    createdAt: Date;
    lastMessageAt: Date | null;
    tags: { tag: { name: string } }[];
    source: { name: string } | null;
  }): PublicContact {
    const meta =
      (c.metadata as Record<string, unknown> | null) ?? ({} as Record<string, unknown>);
    const fields: Record<string, string> = {};
    const utm: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (v == null) continue;
      // Los utm_* se devuelven aparte: son atribución, no datos del negocio.
      if ((utmKeys as readonly string[]).includes(k)) utm[k] = String(v);
      else fields[k] = String(v);
    }

    return {
      id: c.id,
      phone: c.phone,
      name: c.name,
      optIn: c.optIn,
      tags: c.tags.map((t) => t.tag.name),
      source: c.source?.name ?? null,
      origin: c.origin ?? "manual",
      fields,
      utm,
      createdAt: c.createdAt.toISOString(),
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    };
  }

  private toPublicDeal(d: {
    id: string;
    title: string;
    value: Prisma.Decimal | null;
    currency: string;
    contactId: string;
    createdAt: Date;
    updatedAt: Date;
    stage: { name: string };
    contact: { phone: string };
    owner: { name: string | null; email: string } | null;
  }): PublicDeal {
    return {
      id: d.id,
      title: d.title,
      stage: d.stage.name,
      value: d.value === null ? null : Number(d.value),
      currency: d.currency,
      contactId: d.contactId,
      contactPhone: d.contact.phone,
      owner: d.owner?.name ?? d.owner?.email ?? null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }
}
