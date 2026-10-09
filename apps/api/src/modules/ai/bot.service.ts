import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  BotChannelRef,
  BotDto,
  BusinessHours,
  CreateBotInput,
  EscalationRules,
  KeywordTrigger,
  UpdateBotInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { AgentActionsService } from "./agent-actions.service";
import { availableTools } from "./tools.registry";
import { i18n } from "../../i18n/i18n";

@Injectable()
export class BotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly actions: AgentActionsService,
  ) {}

  // ── Lectura ──────────────────────────────────────────────────
  async list(): Promise<{
    bots: BotDto[];
    availableTools: ReturnType<typeof availableTools>;
    channels: BotChannelRef[];
  }> {
    // El contexto real (etiquetas, etapas, vendedores) decide qué acciones
    // se pueden ofrecer y cuáles hay que marcar como no disponibles.
    const [rows, channels, toolContext] = await Promise.all([
      this.prisma.agentConfig.findMany({
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        include: { channel: true },
      }),
      this.prisma.whatsappConnection.findMany({
        where: { isActive: true },
        orderBy: { connectedAt: "desc" },
      }),
      this.actions.loadContext(),
    ]);
    // Un solo groupBy para todos los bots, en vez de una consulta por bot.
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    const usage = await this.prisma.aiRun.groupBy({
      by: ["agentConfigId"],
      where: { createdAt: { gte: since }, agentConfigId: { not: null } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const spent = new Map(
      usage.map((u) => [
        u.agentConfigId,
        (u._sum.inputTokens ?? 0) + (u._sum.outputTokens ?? 0),
      ]),
    );

    return {
      bots: rows.map((r) => this.toDto(r, spent.get(r.id) ?? 0)),
      availableTools: availableTools(toolContext),
      channels: channels.map((c) => ({
        id: c.id,
        label: c.label,
        displayPhoneNumber: c.displayPhoneNumber,
      })),
    };
  }

  async getById(id: string): Promise<BotDto> {
    const bot = await this.prisma.agentConfig.findUnique({
      where: { id },
      include: { channel: true },
    });
    if (!bot) throw new NotFoundException("Bot no encontrado");
    return this.toDto(bot);
  }

  /**
   * Bot que atiende un canal: el asignado a ese channelId (activo) o, si no,
   * el bot por defecto (global). Devuelve la fila cruda para uso interno
   * (agente y automatización). null si no hay ninguno activo.
   */
  /**
   * Quién atiende una conversación: el agente del embudo donde está su
   * oportunidad abierta; si no tiene, el del número; si no, el predeterminado.
   */
  async resolveForConversation(convo: { channelId: string | null; contactId: string }) {
    const deal = await this.prisma.deal.findFirst({
      where: { contactId: convo.contactId, discardedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { stage: { select: { pipeline: { select: { bot: true } } } } },
    });
    const own = deal?.stage.pipeline.bot;
    if (own?.isActive) return own;
    return this.resolveForChannel(convo.channelId);
  }

  async resolveForChannel(channelId: string | null) {
    if (channelId) {
      const own = await this.prisma.agentConfig.findFirst({
        where: { channelId, isActive: true },
      });
      if (own) return own;
    }
    return this.prisma.agentConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });
  }

  // ── Escritura ────────────────────────────────────────────────
  async create(input: CreateBotInput): Promise<BotDto> {
    await this.assertChannelFree(input.channelId ?? null, null);
    const bot = await this.prisma.agentConfig.create({
      data: {
        orgId: this.tenant.orgId(),
        name: input.name,
        model: input.model,
        effort: input.effort,
        systemPrompt: input.systemPrompt,
        enabledTools: input.enabledTools,
        maxIterations: input.maxIterations,
        escalationRules: input.escalationRules as unknown as Prisma.InputJsonObject,
        monthlyTokenBudget: input.monthlyTokenBudget,
        isActive: input.isActive,
        channelId: input.channelId,
        autopilotByDefault: input.autopilotByDefault,
        replyDelaySec: input.replyDelaySec,
        welcomeEnabled: input.welcomeEnabled,
        welcomeMessage: input.welcomeMessage,
        businessHoursEnabled: input.businessHoursEnabled,
        businessHours: (input.businessHours ?? undefined) as Prisma.InputJsonValue,
        keywordTriggers: input.keywordTriggers as unknown as Prisma.InputJsonValue,
      },
      include: { channel: true },
    });
    return this.toDto(bot);
  }

  async update(id: string, input: UpdateBotInput): Promise<BotDto> {
    const existing = await this.prisma.agentConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Bot no encontrado");
    if (input.channelId !== undefined) {
      await this.assertChannelFree(input.channelId, id);
    }

    const bot = await this.prisma.agentConfig.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
        ...(input.systemPrompt !== undefined
          ? { systemPrompt: input.systemPrompt }
          : {}),
        ...(input.enabledTools !== undefined
          ? { enabledTools: input.enabledTools }
          : {}),
        ...(input.maxIterations !== undefined
          ? { maxIterations: input.maxIterations }
          : {}),
        ...(input.escalationRules !== undefined
          ? {
              escalationRules:
                input.escalationRules as unknown as Prisma.InputJsonObject,
            }
          : {}),
        ...(input.monthlyTokenBudget !== undefined
          ? { monthlyTokenBudget: input.monthlyTokenBudget }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
        ...(input.autopilotByDefault !== undefined
          ? { autopilotByDefault: input.autopilotByDefault }
          : {}),
        ...(input.replyDelaySec !== undefined ? { replyDelaySec: input.replyDelaySec } : {}),
        ...(input.welcomeEnabled !== undefined
          ? { welcomeEnabled: input.welcomeEnabled }
          : {}),
        ...(input.welcomeMessage !== undefined
          ? { welcomeMessage: input.welcomeMessage }
          : {}),
        ...(input.businessHoursEnabled !== undefined
          ? { businessHoursEnabled: input.businessHoursEnabled }
          : {}),
        ...(input.businessHours !== undefined
          ? {
              businessHours: (input.businessHours ??
                undefined) as Prisma.InputJsonValue,
            }
          : {}),
        ...(input.keywordTriggers !== undefined
          ? {
              keywordTriggers:
                input.keywordTriggers as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
      include: { channel: true },
    });
    return this.toDto(bot);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const bot = await this.prisma.agentConfig.findUnique({ where: { id } });
    if (!bot) throw new NotFoundException("Bot no encontrado");
    if (bot.isDefault) {
      throw new BadRequestException(
        "No puedes eliminar el bot por defecto. Crea otro y reasigna primero.",
      );
    }
    await this.prisma.agentConfig.delete({ where: { id } });
    return { ok: true };
  }

  // Un canal solo puede tener un bot. Evita el choque de la constraint única.
  private async assertChannelFree(
    channelId: string | null,
    selfId: string | null,
  ): Promise<void> {
    if (!channelId) return;
    const other = await this.prisma.agentConfig.findFirst({
      where: { channelId, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { id: true, name: true },
    });
    if (other) {
      throw new BadRequestException(
        i18n("bot.channelTaken", { name: other.name }),
      );
    }
  }

  private toDto(c: {
    id: string;
    name: string;
    model: string;
    effort: string;
    systemPrompt: string;
    enabledTools: string[];
    maxIterations: number;
    escalationRules: unknown;
    monthlyTokenBudget: number;
    isDefault: boolean;
    isActive: boolean;
    channelId: string | null;
    autopilotByDefault: boolean;
    replyDelaySec: number;
    welcomeEnabled: boolean;
    welcomeMessage: string | null;
    businessHoursEnabled: boolean;
    businessHours: unknown;
    keywordTriggers: unknown;
    createdAt: Date;
    channel?: {
      id: string;
      label: string | null;
      displayPhoneNumber: string | null;
    } | null;
  },
    // Tokens gastados por este bot en el mes en curso.
    tokensThisMonth = 0,
  ): BotDto {
    return {
      id: c.id,
      name: c.name,
      model: c.model,
      effort: c.effort,
      systemPrompt: c.systemPrompt,
      enabledTools: c.enabledTools,
      maxIterations: c.maxIterations,
      escalationRules: (c.escalationRules as EscalationRules | null) ?? {},
      monthlyTokenBudget: c.monthlyTokenBudget,
      tokensThisMonth,
      isDefault: c.isDefault,
      isActive: c.isActive,
      channelId: c.channelId,
      channel: c.channel
        ? {
            id: c.channel.id,
            label: c.channel.label,
            displayPhoneNumber: c.channel.displayPhoneNumber,
          }
        : null,
      autopilotByDefault: c.autopilotByDefault,
      replyDelaySec: c.replyDelaySec,
      welcomeEnabled: c.welcomeEnabled,
      welcomeMessage: c.welcomeMessage,
      businessHoursEnabled: c.businessHoursEnabled,
      businessHours: (c.businessHours as BusinessHours | null) ?? null,
      keywordTriggers: (c.keywordTriggers as KeywordTrigger[] | null) ?? [],
      createdAt: c.createdAt.toISOString(),
    };
  }
}
