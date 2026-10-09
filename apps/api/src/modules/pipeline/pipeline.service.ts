import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { contactCurrency } from "@crm/shared";
import type {
  CreateDealInput,
  CreatePipelineInput,
  CreateStageAutomationInput,
  CreateStageInput,
  DealDto,
  DiscardDealInput,
  MoveDealInput,
  PipelineDto,
  PipelineSummaryDto,
  PipelineView,
  ReorderStagesInput,
  StageAutomationDto,
  StageDto,
  StageRef,
  UpdateDealInput,
  UpdatePipelineInput,
  UpdateStageAutomationInput,
  UpdateStageInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { env } from "../../common/utils/env";
import { publicApiBase } from "../../common/utils/public-api-base";
import { decideIntake, pickLeastLoaded } from "./intake";

/** Etapas con las que arranca un embudo nuevo (y cualquier empresa nueva). */
export const DEFAULT_STAGES = [
  { name: "Entrantes", order: 0 },
  { name: "Contactado", order: 1 },
  { name: "Calificado", order: 2, isQualified: true },
  { name: "Propuesta", order: 3 },
  { name: "Ganado", order: 4, isWon: true },
  { name: "Perdido", order: 5, isLost: true },
];

const DEAL_INCLUDE = {
  contact: {
    include: {
      source: true,
      tags: { include: { tag: { select: { name: true, color: true } } } },
      // Solo la conversación más reciente: es la que se abre desde la tarjeta.
      conversations: {
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        take: 1,
        select: { id: true, awaitingReply: true, lastMessageAt: true, unreadCount: true },
      },
    },
  },
  owner: true,
  stage: { select: { pipelineId: true } },
} as const;

const PIPELINE_INCLUDE = {
  channels: { select: { id: true } },
  bot: { select: { id: true, name: true } },
  _count: { select: { stages: true } },
} as const;

/** Token secreto de un webhook de etapa (apto para URL). */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

const STAGE_INCLUDE = {
  automations: {
    orderBy: { order: "asc" as const },
    include: { flow: { select: { name: true, isActive: true } } },
  },
} as const;

type AutomationRow = {
  id: string;
  stageId: string;
  trigger: string;
  flowId: string;
  delayMinutes: number | null;
  token: string | null;
  enabled: boolean;
  order: number;
  flow: { name: string; isActive: boolean };
};

// Barrido del descarte automático: cada hora, y una primera pasada al minuto
// de arrancar.
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const SWEEP_FIRST_MS = 60 * 1000;

@Injectable()
export class PipelineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Pipeline");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    if (env("PIPELINE_SWEEP") === "off") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    setTimeout(() => void this.sweep(), SWEEP_FIRST_MS).unref();
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Tablero ─────────────────────────────────────────────────
  async getPipeline(pipelineId?: string, view: PipelineView = "open"): Promise<PipelineDto> {
    let pipelines = await this.listPipelines();
    if (!pipelines.length) {
      // Empresa sin embudo (instalación anterior a esta versión, sin migrar):
      // se crea el predeterminado y se sigue.
      await this.createPipeline({ name: "Ventas", makeDefault: true });
      pipelines = await this.listPipelines();
    }
    const current =
      pipelines.find((p) => p.id === pipelineId) ??
      pipelines.find((p) => p.isDefault) ??
      pipelines[0]!;

    const [stagesAll, deals, discardedCount] = await Promise.all([
      this.prisma.pipelineStage.findMany({
        orderBy: [{ pipeline: { order: "asc" } }, { order: "asc" }],
        include: { pipeline: { select: { name: true } }, ...STAGE_INCLUDE },
      }),
      this.prisma.deal.findMany({
        where: {
          stage: { pipelineId: current.id },
          discardedAt: view === "discarded" ? { not: null } : null,
        },
        orderBy: view === "discarded" ? { discardedAt: "desc" } : { createdAt: "desc" },
        include: DEAL_INCLUDE,
      }),
      this.prisma.deal.count({
        where: { stage: { pipelineId: current.id }, discardedAt: { not: null } },
      }),
    ]);

    return {
      pipelineId: current.id,
      pipelines,
      stages: stagesAll.filter((s) => s.pipelineId === current.id).map((s) => this.toStageDto(s)),
      stagesAll: stagesAll.map((s) => ({ ...this.toStageDto(s), pipelineName: s.pipeline.name })),
      deals: deals.map((d) => this.toDealDto(d)),
      view,
      discardedCount,
    };
  }

  // ── Embudos ─────────────────────────────────────────────────
  async listPipelines(): Promise<PipelineSummaryDto[]> {
    const rows = await this.prisma.pipeline.findMany({
      orderBy: { order: "asc" },
      include: PIPELINE_INCLUDE,
    });
    if (!rows.length) return [];
    const [stages, open] = await Promise.all([
      this.prisma.pipelineStage.findMany({ select: { id: true, pipelineId: true } }),
      this.prisma.deal.groupBy({
        by: ["stageId"],
        where: { discardedAt: null },
        _count: { _all: true },
      }),
    ]);
    const stageToPipeline = new Map(stages.map((s) => [s.id, s.pipelineId]));
    const openByPipeline = new Map<string, number>();
    for (const g of open) {
      const p = stageToPipeline.get(g.stageId);
      if (p) openByPipeline.set(p, (openByPipeline.get(p) ?? 0) + g._count._all);
    }
    return rows.map((p) => this.toPipelineDto(p, openByPipeline.get(p.id) ?? 0));
  }

  /** El embudo predeterminado de la empresa (se crea si no hay ninguno). */
  async defaultPipeline(): Promise<{ id: string }> {
    const p =
      (await this.prisma.pipeline.findFirst({ where: { isDefault: true }, select: { id: true } })) ??
      (await this.prisma.pipeline.findFirst({ orderBy: { order: "asc" }, select: { id: true } }));
    if (p) return p;
    return this.createPipeline({ name: "Ventas", makeDefault: true });
  }

  async createPipeline(input: CreatePipelineInput): Promise<PipelineSummaryDto> {
    const orgId = this.tenant.orgId();
    const [last, count] = await Promise.all([
      this.prisma.pipeline.findFirst({ orderBy: { order: "desc" }, select: { order: true } }),
      this.prisma.pipeline.count(),
    ]);
    const makeDefault = count === 0 || !!input.makeDefault;

    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.pipeline.create({
        data: {
          orgId,
          name: input.name.trim(),
          order: (last?.order ?? -1) + 1,
          isDefault: makeDefault,
        },
      });
      if (makeDefault && count > 0) {
        await tx.pipeline.updateMany({
          where: { orgId, id: { not: p.id } },
          data: { isDefault: false },
        });
      }
      await tx.pipelineStage.createMany({
        data: DEFAULT_STAGES.map((s) => ({ ...s, orgId, pipelineId: p.id })),
      });
      const entrada = await tx.pipelineStage.findFirst({
        where: { pipelineId: p.id },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      return tx.pipeline.update({
        where: { id: p.id },
        data: { inboundStageId: entrada?.id ?? null },
        include: PIPELINE_INCLUDE,
      });
    });
    this.changed();
    return this.toPipelineDto(created, 0);
  }

  async updatePipeline(id: string, input: UpdatePipelineInput): Promise<PipelineSummaryDto> {
    const existing = await this.prisma.pipeline.findUnique({
      where: { id },
      include: { stages: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException("Embudo no encontrado");
    if (input.inboundStageId && !existing.stages.some((s) => s.id === input.inboundStageId)) {
      throw new BadRequestException("La etapa de entrada no es de este embudo");
    }
    const orgId = this.tenant.orgId();

    const updated = await this.prisma.$transaction(async (tx) => {
      // Solo puede haber un predeterminado; se cambia eligiendo otro, nunca
      // quitándoselo al actual.
      if (input.isDefault === true) {
        await tx.pipeline.updateMany({ where: { orgId, id: { not: id } }, data: { isDefault: false } });
      }
      // Números que entran a este embudo: los que no estén en la lista vuelven
      // al predeterminado (pipelineId null).
      if (input.channelIds) {
        await tx.whatsappConnection.updateMany({
          where: { pipelineId: id, id: { notIn: input.channelIds } },
          data: { pipelineId: null },
        });
        if (input.channelIds.length) {
          await tx.whatsappConnection.updateMany({
            where: { id: { in: input.channelIds } },
            data: { pipelineId: id },
          });
        }
      }
      return tx.pipeline.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.isDefault === true ? { isDefault: true } : {}),
          ...(input.inboundEnabled !== undefined ? { inboundEnabled: input.inboundEnabled } : {}),
          ...(input.inboundStageId !== undefined ? { inboundStageId: input.inboundStageId } : {}),
          ...(input.inboundDiscardDays !== undefined
            ? { inboundDiscardDays: input.inboundDiscardDays }
            : {}),
          ...(input.botId !== undefined ? { botId: input.botId } : {}),
        },
        include: PIPELINE_INCLUDE,
      });
    });
    this.changed();
    return this.toPipelineDto(updated, await this.openCount(id));
  }

  async deletePipeline(id: string): Promise<{ ok: true }> {
    const p = await this.prisma.pipeline.findUnique({ where: { id } });
    if (!p) throw new NotFoundException("Embudo no encontrado");
    if (p.isDefault) {
      throw new BadRequestException(
        "No se puede eliminar el embudo predeterminado: marca otro como predeterminado primero",
      );
    }
    const deals = await this.prisma.deal.count({ where: { stage: { pipelineId: id } } });
    if (deals > 0) {
      throw new BadRequestException(
        "El embudo tiene oportunidades. Muévelas o elimínalas antes de borrarlo.",
      );
    }
    await this.prisma.pipeline.delete({ where: { id } }); // las etapas caen en cascada
    this.changed();
    return { ok: true };
  }

  async reorderPipelines(ids: string[]): Promise<{ ok: true }> {
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.pipeline.update({ where: { id }, data: { order: i } })),
    );
    this.changed();
    return { ok: true };
  }

  /**
   * Todas las etapas de la empresa, en orden de embudo y de etapa. El embudo
   * predeterminado va primero: su primera etapa es la que se ofrece por defecto.
   */
  async listStagesAll(): Promise<StageRef[]> {
    const rows = await this.prisma.pipelineStage.findMany({
      orderBy: [{ pipeline: { isDefault: "desc" } }, { pipeline: { order: "asc" } }, { order: "asc" }],
      include: { pipeline: { select: { name: true } }, ...STAGE_INCLUDE },
    });
    return rows.map((s) => ({ ...this.toStageDto(s), pipelineName: s.pipeline.name }));
  }

  // ── Oportunidades ───────────────────────────────────────────
  /** Oportunidades abiertas de un contacto, la más reciente primero. */
  async dealsForContact(contactId: string): Promise<DealDto[]> {
    if (!contactId) throw new BadRequestException("Falta contactId");
    const rows = await this.prisma.deal.findMany({
      where: { contactId, discardedAt: null },
      orderBy: { createdAt: "desc" },
      include: DEAL_INCLUDE,
    });
    return rows.map((d) => this.toDealDto(d));
  }

  async createDeal(input: CreateDealInput): Promise<DealDto> {
    const contact = await this.prisma.contact.findUnique({ where: { id: input.contactId } });
    if (!contact) throw new NotFoundException("Contacto no encontrado");

    let stageId = input.stageId;
    if (!stageId) {
      const pipelineId = input.pipelineId ?? (await this.defaultPipeline()).id;
      stageId = (
        await this.prisma.pipelineStage.findFirst({
          where: { pipelineId },
          orderBy: { order: "asc" },
          select: { id: true },
        })
      )?.id;
    }
    if (!stageId) throw new BadRequestException("No hay etapas configuradas");

    const deal = await this.prisma.deal.create({
      data: {
        orgId: this.tenant.orgId(),
        contactId: input.contactId,
        stageId,
        title: input.title,
        value: input.value,
        // Sin moneda explícita: la del contacto (fijada o la de su país).
        currency: input.currency ?? contactCurrency(contact) ?? "USD",
      },
      include: DEAL_INCLUDE,
    });
    this.changed(deal.id);
    this.enteredStage(deal.id, deal.contactId, stageId);
    return this.toDealDto(deal);
  }

  /** Mover a otra etapa (también a la de otro embudo). Si estaba descartada, vuelve. */
  async moveDeal(id: string, input: MoveDealInput): Promise<DealDto> {
    const stage = await this.prisma.pipelineStage.findUnique({ where: { id: input.stageId } });
    if (!stage) throw new BadRequestException("Etapa inválida");

    const deal = await this.prisma.deal
      .update({
        where: { id },
        data: { stageId: input.stageId, discardedAt: null, discardReason: null },
        include: DEAL_INCLUDE,
      })
      .catch(() => {
        throw new NotFoundException("Deal no encontrado");
      });
    this.changed(deal.id);
    this.enteredStage(deal.id, deal.contactId, input.stageId);
    return this.toDealDto(deal);
  }

  async updateDeal(id: string, input: UpdateDealInput): Promise<DealDto> {
    const deal = await this.prisma.deal
      .update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        },
        include: DEAL_INCLUDE,
      })
      .catch(() => {
        throw new NotFoundException("Deal no encontrado");
      });
    this.changed(deal.id);
    return this.toDealDto(deal);
  }

  async discardDeal(id: string, input: DiscardDealInput): Promise<DealDto> {
    const deal = await this.prisma.deal
      .update({
        where: { id },
        data: { discardedAt: new Date(), discardReason: input.reason?.trim() || "manual" },
        include: DEAL_INCLUDE,
      })
      .catch(() => {
        throw new NotFoundException("Deal no encontrado");
      });
    this.changed(deal.id);
    return this.toDealDto(deal);
  }

  async restoreDeal(id: string): Promise<DealDto> {
    const deal = await this.prisma.deal
      .update({
        where: { id },
        data: { discardedAt: null, discardReason: null },
        include: DEAL_INCLUDE,
      })
      .catch(() => {
        throw new NotFoundException("Deal no encontrado");
      });
    this.changed(deal.id);
    return this.toDealDto(deal);
  }

  async deleteDeal(id: string): Promise<{ ok: true }> {
    const deal = await this.prisma.deal.findUnique({ where: { id } });
    if (!deal) throw new NotFoundException("Deal no encontrado");
    await this.prisma.deal.delete({ where: { id } });
    this.changed(id);
    return { ok: true };
  }

  // ── Entrada automática desde WhatsApp ───────────────────────
  /**
   * Se llama con cada mensaje entrante. Si la empresa activó la entrada
   * automática en el embudo del número (o en el predeterminado) y el contacto
   * no tiene una oportunidad en curso, se crea una en la etapa de entrada,
   * asignada al vendedor de su fuente con menos carga. Si tenía una
   * descartada por inactividad, vuelve: acaba de responder.
   */
  async intakeFromWhatsapp(
    contactId: string,
    channelId: string | null,
    conversationId: string | null = null,
  ): Promise<void> {
    const channel = channelId
      ? await this.prisma.whatsappConnection.findUnique({
          where: { id: channelId },
          select: { pipelineId: true },
        })
      : null;
    const withStages = { include: { stages: { orderBy: { order: "asc" as const } } } };
    const pipeline = channel?.pipelineId
      ? await this.prisma.pipeline.findUnique({ where: { id: channel.pipelineId }, ...withStages })
      : await this.prisma.pipeline.findFirst({ where: { isDefault: true }, ...withStages });
    if (!pipeline || !pipeline.inboundEnabled) return;
    const entry = pipeline.stages.find((s) => s.id === pipeline.inboundStageId) ?? pipeline.stages[0];
    if (!entry) return;

    const last = await this.prisma.deal.findFirst({
      where: { contactId },
      orderBy: { createdAt: "desc" },
      include: { stage: { select: { isWon: true, isLost: true, pipelineId: true } } },
    });
    const decision = decideIntake(last, pipeline.id);
    if (decision === "skip") return;

    if (decision === "restore" && last) {
      await this.prisma.deal.update({
        where: { id: last.id },
        data: { discardedAt: null, discardReason: null, stageId: entry.id },
      });
      this.changed(last.id);
      this.enteredStage(last.id, contactId, entry.id);
      return;
    }

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { orgId: true, name: true, phone: true, sourceId: true },
    });
    if (!contact) return;
    const ownerId = await this.pickOwner(contact.sourceId, pipeline.id);
    const deal = await this.prisma.deal.create({
      data: {
        orgId: contact.orgId,
        contactId,
        stageId: entry.id,
        ownerId,
        title: contact.name ?? contact.phone,
        currency: contactCurrency(contact) ?? "USD",
      },
    });
    // La conversación sigue al mismo vendedor: le aparece en "Mías" sin que
    // nadie la reparta a mano. Solo si nadie la había asignado ya.
    if (ownerId && conversationId) {
      await this.prisma.conversation.updateMany({
        where: { id: conversationId, assignedAgentId: null },
        data: { assignedAgentId: ownerId },
      });
    }
    this.changed(deal.id);
    this.enteredStage(deal.id, contactId, entry.id);
  }

  /**
   * La oportunidad llegó a una etapa (movida o creada ahí): lo escuchan los
   * flujos «cambia de etapa» y las automatizaciones de la etapa.
   */
  private enteredStage(dealId: string, contactId: string, stageId: string): void {
    this.events.emit("deal.stage_changed", { orgId: this.tenant.orgId(), dealId, contactId, stageId });
  }

  // ── Automatizaciones de etapa ───────────────────────────────
  async createStageAutomation(stageId: string, input: CreateStageAutomationInput): Promise<StageAutomationDto> {
    const stage = await this.prisma.pipelineStage.findUnique({ where: { id: stageId }, select: { id: true } });
    if (!stage) throw new NotFoundException("Etapa no encontrada");
    await this.assertFlow(input.flowId);
    const last = await this.prisma.stageAutomation.findFirst({ where: { stageId }, orderBy: { order: "desc" }, select: { order: true } });
    const a = await this.prisma.stageAutomation.create({
      data: {
        orgId: this.tenant.orgId(),
        stageId,
        trigger: input.trigger,
        flowId: input.flowId,
        delayMinutes: input.trigger === "no_reply" ? (input.delayMinutes ?? 1440) : (input.delayMinutes ?? null),
        token: input.trigger === "webhook" ? newToken() : null,
        enabled: input.enabled,
        order: (last?.order ?? -1) + 1,
      },
      include: STAGE_INCLUDE.automations.include,
    });
    this.changed();
    return this.toAutomationDto(a);
  }

  async updateStageAutomation(id: string, input: UpdateStageAutomationInput): Promise<StageAutomationDto> {
    const current = await this.prisma.stageAutomation.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("Automatización no encontrada");
    if (input.flowId !== undefined) await this.assertFlow(input.flowId);
    const trigger = input.trigger ?? current.trigger;
    const a = await this.prisma.stageAutomation.update({
      where: { id },
      data: {
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
        ...(input.flowId !== undefined ? { flowId: input.flowId } : {}),
        ...(input.delayMinutes !== undefined ? { delayMinutes: input.delayMinutes } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        // «Sin respuesta» necesita un plazo; «webhook» necesita su token (que se conserva si ya lo tenía).
        ...(trigger === "no_reply" && !(input.delayMinutes ?? current.delayMinutes) ? { delayMinutes: 1440 } : {}),
        ...(trigger === "webhook" && !current.token ? { token: newToken() } : {}),
      },
      include: STAGE_INCLUDE.automations.include,
    });
    this.changed();
    return this.toAutomationDto(a);
  }

  async deleteStageAutomation(id: string): Promise<{ ok: true }> {
    await this.prisma.stageAutomation.delete({ where: { id } }).catch(() => {
      throw new NotFoundException("Automatización no encontrada");
    });
    this.changed();
    return { ok: true };
  }

  private async assertFlow(flowId: string): Promise<void> {
    const flow = await this.prisma.flow.findUnique({ where: { id: flowId }, select: { id: true } });
    if (!flow) throw new BadRequestException("Ese flujo no existe");
  }

  /** El vendedor de la fuente con menos oportunidades abiertas en el embudo. */
  private async pickOwner(sourceId: string | null, pipelineId: string): Promise<string | null> {
    if (!sourceId) return null;
    const sellers = await this.prisma.userSource.findMany({
      where: { sourceId, user: { isActive: true } },
      select: { userId: true },
    });
    if (!sellers.length) return null;
    const ids = sellers.map((s) => s.userId);
    const counts = await this.prisma.deal.groupBy({
      by: ["ownerId"],
      where: { ownerId: { in: ids }, discardedAt: null, stage: { pipelineId } },
      _count: { _all: true },
    });
    return pickLeastLoaded(
      ids,
      new Map(counts.map((c) => [c.ownerId as string, c._count._all])),
    );
  }

  /**
   * Descarte automático: las oportunidades que siguen en la etapa de entrada
   * y cuyo contacto no ha escrito en `inboundDiscardDays` días. Corre para
   * todas las empresas, así que abre el contexto de cada una.
   */
  async sweep(): Promise<void> {
    let pipelines: {
      id: string;
      orgId: string;
      inboundStageId: string | null;
      inboundDiscardDays: number;
      stages: { id: string }[];
    }[];
    try {
      pipelines = await runUnscoped("barrido de entrantes", () =>
        this.prisma.pipeline.findMany({
          where: { inboundEnabled: true, inboundDiscardDays: { gt: 0 } },
          select: {
            id: true,
            orgId: true,
            inboundStageId: true,
            inboundDiscardDays: true,
            stages: { orderBy: { order: "asc" }, take: 1, select: { id: true } },
          },
        }),
      );
    } catch (e) {
      this.logger.warn(`Barrido de entrantes: no se pudieron leer los embudos (${(e as Error).message})`);
      return;
    }

    for (const p of pipelines) {
      const entryId = p.inboundStageId ?? p.stages[0]?.id;
      if (!entryId) continue;
      const cutoff = new Date(Date.now() - p.inboundDiscardDays * 86_400_000);
      try {
        const r = await runInOrg(p.orgId, () =>
          this.prisma.deal.updateMany({
            where: {
              stageId: entryId,
              discardedAt: null,
              createdAt: { lt: cutoff },
              OR: [
                { contact: { lastMessageAt: null } },
                { contact: { lastMessageAt: { lt: cutoff } } },
              ],
            },
            data: { discardedAt: new Date(), discardReason: "auto" },
          }),
        );
        if (r.count) {
          this.logger.log(`Descartadas ${r.count} entrantes sin respuesta (embudo ${p.id})`);
          this.events.emit("pipeline.changed", { orgId: p.orgId, dealId: "" });
        }
      } catch (e) {
        this.logger.warn(`Barrido de entrantes en ${p.orgId}: ${(e as Error).message}`);
      }
    }
  }

  // ── Etapas (columnas) ───────────────────────────────────────
  async createStage(input: CreateStageInput): Promise<StageDto> {
    const pipelineId = input.pipelineId ?? (await this.defaultPipeline()).id;
    const pipeline = await this.prisma.pipeline.findUnique({ where: { id: pipelineId } });
    if (!pipeline) throw new NotFoundException("Embudo no encontrado");
    const last = await this.prisma.pipelineStage.findFirst({
      where: { pipelineId },
      orderBy: { order: "desc" },
    });
    const s = await this.prisma.pipelineStage.create({
      data: {
        orgId: this.tenant.orgId(),
        pipelineId,
        name: input.name,
        isWon: input.isWon,
        isLost: input.isLost,
        isQualified: input.isQualified,
        order: (last?.order ?? -1) + 1,
      },
      include: STAGE_INCLUDE,
    });
    this.changed();
    return this.toStageDto(s);
  }

  async updateStage(id: string, input: UpdateStageInput): Promise<StageDto> {
    const s = await this.prisma.pipelineStage
      .update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isWon !== undefined ? { isWon: input.isWon } : {}),
          ...(input.isLost !== undefined ? { isLost: input.isLost } : {}),
          ...(input.isQualified !== undefined ? { isQualified: input.isQualified } : {}),
          // Un rol por etapa: marcar uno desmarca los otros.
          ...(input.isWon ? { isLost: false, isQualified: false } : {}),
          ...(input.isLost ? { isWon: false, isQualified: false } : {}),
          ...(input.isQualified ? { isWon: false, isLost: false } : {}),
        },
        include: STAGE_INCLUDE,
      })
      .catch(() => {
        throw new NotFoundException("Etapa no encontrada");
      });
    this.changed();
    return this.toStageDto(s);
  }

  async deleteStage(id: string): Promise<{ ok: true }> {
    const count = await this.prisma.deal.count({ where: { stageId: id } });
    if (count > 0) {
      throw new BadRequestException(
        "La etapa tiene deals. Muévelos a otra etapa antes de borrarla.",
      );
    }
    const stage = await this.prisma.pipelineStage.findUnique({ where: { id } });
    if (!stage) throw new NotFoundException("Etapa no encontrada");
    await this.prisma.$transaction([
      // Si era la etapa de entrada, el embudo vuelve a usar la primera.
      this.prisma.pipeline.updateMany({
        where: { id: stage.pipelineId, inboundStageId: id },
        data: { inboundStageId: null },
      }),
      this.prisma.pipelineStage.delete({ where: { id } }),
    ]);
    this.changed();
    return { ok: true };
  }

  // Reordena dentro de un embudo: órdenes negativos temporales para no chocar
  // con el índice único.
  async reorderStages(input: ReorderStagesInput): Promise<{ ok: true }> {
    const stages = await this.prisma.pipelineStage.findMany({
      where: { id: { in: input.ids } },
      select: { pipelineId: true },
    });
    if (stages.length !== input.ids.length || new Set(stages.map((s) => s.pipelineId)).size !== 1) {
      throw new BadRequestException("Las etapas a reordenar deben ser del mismo embudo");
    }
    await this.prisma.$transaction([
      ...input.ids.map((id, i) =>
        this.prisma.pipelineStage.update({ where: { id }, data: { order: -(i + 1) } }),
      ),
      ...input.ids.map((id, i) =>
        this.prisma.pipelineStage.update({ where: { id }, data: { order: i } }),
      ),
    ]);
    this.changed();
    return { ok: true };
  }

  // ── Internos ────────────────────────────────────────────────
  private changed(dealId = ""): void {
    this.events.emit("pipeline.changed", { orgId: this.tenant.orgId(), dealId });
  }

  private async openCount(pipelineId: string): Promise<number> {
    return this.prisma.deal.count({ where: { stage: { pipelineId }, discardedAt: null } });
  }

  private toPipelineDto(
    p: {
      id: string;
      name: string;
      order: number;
      isDefault: boolean;
      inboundEnabled: boolean;
      inboundStageId: string | null;
      inboundDiscardDays: number;
      channels: { id: string }[];
      botId?: string | null;
      bot?: { id: string; name: string } | null;
      _count: { stages: number };
    },
    openDeals: number,
  ): PipelineSummaryDto {
    return {
      id: p.id,
      name: p.name,
      order: p.order,
      isDefault: p.isDefault,
      inboundEnabled: p.inboundEnabled,
      inboundStageId: p.inboundStageId,
      inboundDiscardDays: p.inboundDiscardDays,
      channelIds: p.channels.map((c) => c.id),
      botId: p.bot?.id ?? p.botId ?? null,
      botName: p.bot?.name ?? null,
      stageCount: p._count.stages,
      openDeals,
    };
  }

  private toStageDto(s: {
    id: string;
    pipelineId: string;
    name: string;
    order: number;
    isWon: boolean;
    isLost: boolean;
    isQualified?: boolean;
    automations?: AutomationRow[];
  }): StageDto {
    return {
      id: s.id,
      pipelineId: s.pipelineId,
      name: s.name,
      order: s.order,
      isWon: s.isWon,
      isLost: s.isLost,
      isQualified: s.isQualified ?? false,
      automations: (s.automations ?? []).map((a) => this.toAutomationDto(a)),
    };
  }

  private toAutomationDto(a: AutomationRow): StageAutomationDto {
    const base = publicApiBase();
    return {
      id: a.id,
      stageId: a.stageId,
      trigger: a.trigger as StageAutomationDto["trigger"],
      flowId: a.flowId,
      flowName: a.flow.name,
      flowActive: a.flow.isActive,
      delayMinutes: a.delayMinutes,
      webhookUrl: a.trigger === "webhook" && a.token && base ? `${base}/api/v1/hooks/stage/${a.token}` : null,
      enabled: a.enabled,
      order: a.order,
    };
  }

  private toDealDto(d: {
    id: string;
    title: string;
    value: unknown;
    currency: string;
    stageId: string;
    discardedAt: Date | null;
    discardReason: string | null;
    createdAt: Date;
    stage: { pipelineId: string };
    contact: {
      id: string;
      name: string | null;
      phone: string;
      metadata?: unknown;
      source?: { id: string; name: string; color: string | null } | null;
      tags?: { tag: { name: string; color: string | null } }[];
      conversations?: {
        id: string;
        awaitingReply: boolean;
        lastMessageAt: Date | null;
        unreadCount: number;
      }[];
    };
    owner?: { id: string; name: string | null } | null;
  }): DealDto {
    const convo = d.contact.conversations?.[0] ?? null;
    return {
      id: d.id,
      title: d.title,
      value: d.value === null ? null : Number(d.value),
      currency: d.currency,
      stageId: d.stageId,
      pipelineId: d.stage.pipelineId,
      contact: {
        id: d.contact.id,
        name: d.contact.name,
        phone: d.contact.phone,
        fields: this.fieldsFrom(d.contact.metadata),
      },
      source: d.contact.source
        ? { id: d.contact.source.id, name: d.contact.source.name, color: d.contact.source.color }
        : null,
      owner: d.owner ? { id: d.owner.id, name: d.owner.name } : null,
      tags: (d.contact.tags ?? []).map((ct) => ({ name: ct.tag.name, color: ct.tag.color })),
      conversation: convo
        ? {
            id: convo.id,
            awaitingReply: convo.awaitingReply,
            lastMessageAt: convo.lastMessageAt ? convo.lastMessageAt.toISOString() : null,
            unreadCount: convo.unreadCount,
          }
        : null,
      discardedAt: d.discardedAt ? d.discardedAt.toISOString() : null,
      discardReason: d.discardReason,
      createdAt: d.createdAt.toISOString(),
    };
  }

  private fieldsFrom(metadata: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (metadata && typeof metadata === "object") {
      for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
        if (v != null) out[k] = String(v);
      }
    }
    return out;
  }
}
