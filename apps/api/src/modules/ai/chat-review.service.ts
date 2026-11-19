import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  CHAT_REVIEW_DAILY_MAX,
  CHAT_REVIEW_MANUAL_DAYS,
  CHAT_REVIEW_MANUAL_MAX,
  type ChatReviewOverview,
  type ConversationReviewDto,
  type SimulationFinding,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { env } from "../../common/utils/env";
import { AgentService } from "./agent.service";
import { AiSettingsService } from "./ai-settings.service";
import { CHAT_REVIEW_MESSAGES, chatReviewLines, type ReviewRun } from "./chat-review.lines";

/** Cada cuánto se mira si a alguna empresa le toca su revisión diaria. */
const SWEEP_EVERY_MS = 30 * 60_000;
/** Una pasada diaria: un poco menos de 24 h, para que no se vaya corriendo cada día. */
const DAILY_MS = 23.5 * 3600_000;
const CHANNEL_NAME: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", tiktok: "TikTok" };

/**
 * Revisión de las conversaciones reales que atendió la IA: el mismo revisor del
 * simulador (AgentService.reviewTranscript), con lo que consultó el agente en
 * cada respuesta y sus instrucciones. Marca las que hay que mirar («Mal» si se
 * inventó un dato, «Revisar» si algo se puede mejorar) con la frase exacta.
 *
 * Una vez al día si la empresa la activa (gasta tokens: viene apagada), o a
 * mano con «Revisar ahora». Una conversación no se vuelve a revisar si la IA no
 * escribió nada nuevo desde la última vez.
 */
@Injectable()
export class ChatReviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Revisión de chats");
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** Pasadas en marcha por empresa (para enseñar el avance y no lanzar dos a la vez). */
  private readonly running = new Map<string, { done: number; total: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly agent: AgentService,
    private readonly aiSettings: AiSettingsService,
  ) {}

  onModuleInit(): void {
    if (env("CHAT_REVIEW_SWEEP") === "off") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Lo que ve el panel ──────────────────────────────────────
  async overview(status: "open" | "all" = "open"): Promise<ChatReviewOverview> {
    const orgId = this.tenant.orgId();
    const attention = { status: "open", verdict: { in: ["review", "bad"] } };
    const [settings, open, rows] = await Promise.all([
      this.prisma.aiSetting.findUnique({ where: { orgId }, select: { chatReview: true, chatReviewAt: true } }),
      this.prisma.conversationReview.count({ where: attention }),
      this.prisma.conversationReview.findMany({
        where: status === "open" ? attention : {},
        orderBy: { createdAt: "desc" },
        take: 60,
        include: { conversation: { select: { channelKind: true, contact: { select: { name: true, phone: true } } } } },
      }),
    ]);
    return {
      enabled: !!settings?.chatReview,
      lastRunAt: settings?.chatReviewAt?.toISOString() ?? null,
      running: this.running.get(orgId) ?? null,
      open,
      reviews: rows.map((r): ConversationReviewDto => ({
        id: r.id,
        conversationId: r.conversationId,
        contactName: r.conversation.contact.name?.trim() || r.conversation.contact.phone,
        channel: CHANNEL_NAME[r.conversation.channelKind] ?? r.conversation.channelKind,
        agentName: r.agentName,
        verdict: r.verdict as ConversationReviewDto["verdict"],
        summary: r.summary,
        findings: (Array.isArray(r.findings) ? r.findings : []) as SimulationFinding[],
        aiMessages: r.aiMessages,
        tokens: r.tokens,
        status: r.status === "done" ? "done" : "open",
        createdAt: r.createdAt.toISOString(),
        lastMessageAt: r.lastMessageAt.toISOString(),
      })),
    };
  }

  async setEnabled(enabled: boolean): Promise<{ ok: true }> {
    const orgId = this.tenant.orgId();
    await this.prisma.aiSetting.upsert({ where: { orgId }, create: { orgId, chatReview: enabled }, update: { chatReview: enabled } });
    return { ok: true };
  }

  async setStatus(id: string, status: "open" | "done"): Promise<{ ok: true }> {
    const row = await this.prisma.conversationReview.findFirst({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException("Revisión no encontrada");
    await this.prisma.conversationReview.update({ where: { id }, data: { status, doneAt: status === "done" ? new Date() : null } });
    return { ok: true };
  }

  /**
   * «Revisar ahora»: los últimos días, en segundo plano (cada revisión tarda
   * unos segundos). El panel enseña el avance hasta que termina.
   */
  start(days: number = CHAT_REVIEW_MANUAL_DAYS): { started: boolean } {
    const orgId = this.tenant.orgId();
    if (this.running.has(orgId)) return { started: false };
    this.running.set(orgId, { done: 0, total: 0 });
    void runInOrg(orgId, () => this.run(orgId, days, CHAT_REVIEW_MANUAL_MAX))
      .catch((e: Error) => this.logger.error(`Revisión manual en ${orgId}: ${e.message}`))
      .finally(() => this.running.delete(orgId));
    return { started: true };
  }

  // ── Revisar ─────────────────────────────────────────────────
  /**
   * Una pasada: las conversaciones con respuestas del agente (mensajes de la IA
   * enlazados a su ejecución; los flujos y avisos no cuentan) de los últimos
   * `days` días que tengan algo nuevo desde su última revisión, de la más
   * reciente a la más antigua, hasta `limit`. Devuelve cuántas revisó.
   */
  async run(orgId: string, days: number, limit: number): Promise<number> {
    const since = new Date(Date.now() - days * 86_400_000);
    const latest = await this.prisma.message.groupBy({
      by: ["conversationId"],
      where: { orgId, author: "AI", direction: "OUTBOUND", aiRunId: { not: null }, createdAt: { gte: since } },
      _max: { createdAt: true },
      _count: { _all: true },
    });
    const ids = latest.map((l) => l.conversationId);
    const done = ids.length
      ? await this.prisma.conversationReview.groupBy({ by: ["conversationId"], where: { conversationId: { in: ids } }, _max: { lastMessageAt: true } })
      : [];
    const reviewedUpTo = new Map(done.map((d) => [d.conversationId, d._max.lastMessageAt?.getTime() ?? 0]));
    const due = latest
      .filter((l) => (l._max.createdAt?.getTime() ?? 0) > (reviewedUpTo.get(l.conversationId) ?? 0))
      .sort((a, b) => (b._max.createdAt?.getTime() ?? 0) - (a._max.createdAt?.getTime() ?? 0))
      .slice(0, limit);

    const progress = this.running.get(orgId);
    if (progress) progress.total = due.length;
    let reviewed = 0;
    for (const c of due) {
      try {
        if (await this.reviewConversation(orgId, c.conversationId, c._max.createdAt!, c._count._all)) reviewed++;
      } catch (e) {
        // Sin IA disponible no tiene sentido seguir: el resto fallaría igual.
        this.logger.warn(`No se pudo revisar ${c.conversationId}: ${(e as Error).message}`);
        if (/clave|api key|cupo|quota|AI_NOT_CONFIGURED/i.test((e as Error).message)) break;
      }
      if (progress) progress.done++;
    }
    await this.prisma.aiSetting.upsert({ where: { orgId }, create: { orgId, chatReviewAt: new Date() }, update: { chatReviewAt: new Date() } });
    if (due.length) this.logger.log(`Revisadas ${reviewed} de ${due.length} conversaciones en ${orgId}`);
    return reviewed;
  }

  /** Revisa una conversación y guarda el resultado. false si no había nada de la IA que revisar. */
  async reviewConversation(orgId: string, conversationId: string, lastMessageAt: Date, aiMessages: number): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { channelKind: true } });
    if (!conversation) return false;
    const recent = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CHAT_REVIEW_MESSAGES,
      select: { direction: true, author: true, type: true, content: true, transcript: true, note: true, aiRunId: true, interactive: true },
    });
    const messages = recent.reverse();
    const runIds = [...new Set(messages.map((m) => m.aiRunId).filter((x): x is string => !!x))];
    const runRows = runIds.length
      ? await this.prisma.aiRun.findMany({
          where: { id: { in: runIds }, conversationId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            escalationReason: true,
            agentConfigId: true,
            toolCalls: { orderBy: { createdAt: "asc" }, select: { toolName: true, input: true, output: true } },
          },
        })
      : [];
    const runs = new Map<string, ReviewRun>(runRows.map((r) => [r.id, r]));
    const lines = chatReviewLines(messages, runs);
    if (!lines.some((l) => l.who === "agent")) return false;

    // Las instrucciones del agente que respondió (el de la última respuesta con agente).
    const agentConfigId = [...runRows].reverse().find((r) => r.agentConfigId)?.agentConfigId ?? null;
    const config = agentConfigId
      ? await this.prisma.agentConfig.findUnique({ where: { id: agentConfigId }, select: { name: true, systemPrompt: true, model: true } })
      : null;
    const channel = CHANNEL_NAME[conversation.channelKind] ?? conversation.channelKind;
    const review = await this.agent.reviewTranscript(
      {
        scenario: { title: "Conversación real", brief: `Cliente real por ${channel}: no se sabe de antemano qué buscaba; júzgalo por lo que pasó en la conversación.` },
        lines,
        ended: null,
      },
      { instructions: config?.systemPrompt ?? "", model: config?.model ?? undefined, feature: "review", conversationId },
    );
    await this.prisma.conversationReview.create({
      data: {
        orgId,
        conversationId,
        agentConfigId,
        agentName: config?.name ?? null,
        verdict: review.verdict,
        summary: review.summary,
        findings: review.findings as unknown as Prisma.InputJsonValue,
        lastMessageAt,
        aiMessages,
        tokens: review.tokens,
      },
    });
    return true;
  }

  /** La pasada diaria de las empresas que la activaron y a las que les toca. */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const due = await runUnscoped("revisión diaria de chats: empresas a las que les toca", () =>
        this.prisma.aiSetting.findMany({
          where: { chatReview: true, OR: [{ chatReviewAt: null }, { chatReviewAt: { lt: new Date(Date.now() - DAILY_MS) } }] },
          select: { orgId: true },
          take: 50,
        }),
      );
      let total = 0;
      for (const { orgId } of due) {
        if (this.running.has(orgId)) continue;
        this.running.set(orgId, { done: 0, total: 0 });
        try {
          total += await runInOrg(orgId, async () => {
            // Sin IA disponible (sin clave, cupo lleno) se deja para otro día, sin gastar.
            const status = await this.aiSettings.status();
            if (!status.ready) return 0;
            return this.run(orgId, 1, CHAT_REVIEW_DAILY_MAX);
          });
        } catch (e) {
          this.logger.error(`Revisión diaria en ${orgId}: ${(e as Error).message}`);
        } finally {
          this.running.delete(orgId);
        }
      }
      return total;
    } finally {
      this.sweeping = false;
    }
  }
}
