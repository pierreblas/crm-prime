import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { JwtService } from "@nestjs/jwt";
import type { Queue } from "bullmq";
import {
  AI_INCLUDED_COUNTED,
  AI_INCLUDED_MODEL,
  estimateAiCost,
  includedAiCapUsd,
  PLANS,
  effectivePlan,
  inTrial,
  type FeedbackKind,
  type FeedbackStatus,
  type PlatformAuditEntry,
  type PlatformFeedback,
  type PlatformFeedbackList,
  type PlatformHealth,
  type PlatformOrg,
  type PlatformOrgDetail,
  type PlatformOverview,
  type UpdatePlatformOrgInput,
} from "@crm/shared";
import { env } from "../../common/utils/env";
import {
  QUEUE_AI_REPLY,
  QUEUE_CAMPAIGN,
  QUEUE_FLOW,
  QUEUE_INBOUND,
  QUEUE_META_LEADS,
  QUEUE_OUTBOUND,
  QUEUE_WEBHOOK,
} from "../../infra/queue/queue.constants";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";
import { AiSettingsService } from "../ai/ai-settings.service";

/**
 * Cifras de toda la plataforma para su operador.
 *
 * Es el único sitio de la aplicación que lee todas las empresas a la vez, y
 * por eso va con `runUnscoped` en cada consulta y detrás de PlatformAdminGuard.
 * Son consultas de agregación en SQL: contar por empresa con el cliente de
 * Prisma serían decenas de viajes por fila.
 *
 * Todo lo que el operador cambia (plan, suspensión, notas, entrar como) queda
 * en platform_audit_log con su correo.
 */
@Injectable()
export class PlatformService {
  private readonly log = new Logger("Plataforma");

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @InjectQueue(QUEUE_INBOUND) private readonly qInbound: Queue,
    @InjectQueue(QUEUE_OUTBOUND) private readonly qOutbound: Queue,
    @InjectQueue(QUEUE_CAMPAIGN) private readonly qCampaign: Queue,
    @InjectQueue(QUEUE_FLOW) private readonly qFlow: Queue,
    @InjectQueue(QUEUE_META_LEADS) private readonly qMetaLeads: Queue,
    @InjectQueue(QUEUE_AI_REPLY) private readonly qAiReply: Queue,
    @InjectQueue(QUEUE_WEBHOOK) private readonly qWebhook: Queue,
  ) {}

  private base(): { base: string; protocolo: string } {
    const base = env("SAAS_BASE_DOMAIN") ?? "localhost:3000";
    return { base, protocolo: base.startsWith("localhost") ? "http" : "https" };
  }

  private urlFor(slug: string): string {
    const { base, protocolo } = this.base();
    return `${protocolo}://${slug}.${base}`;
  }

  // ── Cifras globales ─────────────────────────────────────────
  async overview(): Promise<PlatformOverview> {
    return runUnscoped("consola de plataforma: cifras globales", async () => {
      const [totals] = await this.prisma.$queryRaw<
        Array<Record<string, bigint | number | string | null>>
      >`
        SELECT
          (SELECT count(*) FROM organizations)                                                   AS orgs,
          (SELECT count(*) FROM organizations WHERE "isActive")                                  AS active_orgs,
          (SELECT count(*) FROM organizations WHERE "createdAt" >= now() - interval '7 days')     AS new7,
          (SELECT count(*) FROM organizations WHERE "createdAt" >= now() - interval '30 days')    AS new30,
          (SELECT count(DISTINCT "orgId") FROM messages WHERE "createdAt" >= now() - interval '7 days') AS orgs_active7,
          (SELECT count(*) FROM users WHERE "isActive")                                          AS users,
          (SELECT count(*) FROM whatsapp_connections WHERE "isActive")                           AS numbers,
          (SELECT count(*) FROM whatsapp_connections WHERE "isActive" AND mode = 'coexistence')  AS coexistence,
          (SELECT count(*) FROM messages WHERE "createdAt" >= now() - interval '7 days')          AS messages7,
          (SELECT count(*) FROM organizations WHERE plan <> 'free' AND "isActive")               AS paying,
          (SELECT count(*) FROM organizations WHERE "planExpiresAt" IS NOT NULL AND "planExpiresAt" < now() + interval '7 days' AND "isActive") AS expiring7,
          (SELECT count(*) FROM organizations WHERE plan = 'free' AND "trialEndsAt" > now() AND "isActive") AS trialing,
          (SELECT count(*) FROM whatsapp_connections WHERE "isActive" AND status = 'error')      AS numbers_error
      `;
      const days = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', "createdAt")::date AS day, count(*) AS count
        FROM organizations
        WHERE "createdAt" >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1
      `;
      const msgDays = await this.prisma.$queryRaw<Array<{ day: Date; inbound: bigint; outbound: bigint }>>`
        SELECT date_trunc('day', "createdAt")::date AS day,
          count(*) FILTER (WHERE direction = 'INBOUND')  AS inbound,
          count(*) FILTER (WHERE direction = 'OUTBOUND') AS outbound
        FROM messages
        WHERE "createdAt" >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1
      `;
      const plans = await this.prisma.$queryRaw<Array<{ plan: string; count: bigint }>>`
        SELECT plan, count(*) AS count FROM organizations GROUP BY plan ORDER BY count DESC
      `;
      const n = (v: unknown) => Number(v ?? 0);
      // Precio de lista de los planes de pago: lo que facturaría la plataforma
      // al mes si todos pagaran (no hay cobro automático).
      const mrr = plans.reduce((acc, p) => {
        const def = PLANS[p.plan as keyof typeof PLANS];
        return acc + (def?.priceUsd ?? 0) * n(p.count);
      }, 0);
      return {
        orgs: n(totals?.orgs),
        activeOrgs: n(totals?.active_orgs),
        new7d: n(totals?.new7),
        new30d: n(totals?.new30),
        orgsActive7d: n(totals?.orgs_active7),
        users: n(totals?.users),
        numbers: n(totals?.numbers),
        coexistenceNumbers: n(totals?.coexistence),
        messages7d: n(totals?.messages7),
        ...(await this.aiOverview()),
        payingOrgs: n(totals?.paying),
        mrrUsd: mrr,
        expiring7d: n(totals?.expiring7),
        trialing: n(totals?.trialing),
        numbersWithError: n(totals?.numbers_error),
        signupsByDay: days.map((d) => ({ day: toDay(d.day), count: n(d.count) })),
        messagesByDay: msgDays.map((d) => ({ day: toDay(d.day), inbound: n(d.inbound), outbound: n(d.outbound) })),
        byPlan: plans.map((p) => ({ plan: p.plan, count: n(p.count) })),
      };
    });
  }

  // ── Empresas ────────────────────────────────────────────────
  async orgs(search = ""): Promise<PlatformOrg[]> {
    const q = search.trim();
    return runUnscoped("consola de plataforma: listado de empresas", async () => {
      const rows = await this.prisma.$queryRaw<Array<OrgRow>>`
        ${ORG_SELECT}
        WHERE ${q} = '' OR o.name ILIKE ${"%" + q + "%"} OR o.slug ILIKE ${"%" + q + "%"}
          OR EXISTS (SELECT 1 FROM users u WHERE u."orgId" = o.id AND u.email ILIKE ${"%" + q + "%"})
        ORDER BY o."createdAt" DESC
        LIMIT 500
      `;
      const ai = await this.monthAiByOrg();
      return rows.map((r) => this.toOrg(r, ai.get(r.id)));
    });
  }

  private async orgById(id: string): Promise<PlatformOrg> {
    return runUnscoped("consola de plataforma: una empresa", async () => {
      const [row] = await this.prisma.$queryRaw<Array<OrgRow>>`${ORG_SELECT} WHERE o.id = ${id}`;
      if (!row) throw new NotFoundException("Empresa no encontrada");
      const ai = await this.monthAiByOrg(id);
      return this.toOrg(row, ai.get(id));
    });
  }

  private toOrg(r: OrgRow, ai: OrgAi | undefined): PlatformOrg {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      url: this.urlFor(r.slug),
      plan: r.plan,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      adminEmail: r.admin_email,
      users: Number(r.users),
      numbers: Number(r.numbers),
      coexistenceNumbers: Number(r.coexistence),
      numbersWithError: Number(r.numbers_error),
      contacts: Number(r.contacts),
      activeContactsMonth: Number(r.active_month),
      messages30d: Number(r.messages30),
      failedMessages24h: Number(r.failed24),
      wonDeals30d: Number(r.won30),
      lastMessageAt: r.last_message_at?.toISOString() ?? null,
      aiCostMonthUsd: (ai?.ownUsd ?? 0) + (ai?.platformUsd ?? 0),
      aiPlatformCostMonthUsd: ai?.platformUsd ?? 0,
      aiIncludedConversations: ai?.conversations ?? 0,
      // Solo cuenta si el servidor tiene la IA incluida encendida.
      aiIncludedLimit: AiSettingsService.includedEnabled() ? effectivePlan(r.plan, r.trialEndsAt).aiConversations : null,
      aiOwnKey: r.ai_own_key,
      onboardingCompletedAt: r.onboarding_completed_at?.toISOString() ?? null,
      planExpiresAt: r.planExpiresAt?.toISOString() ?? null,
      trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
      inTrial: inTrial(r.plan, r.trialEndsAt),
      platformNotes: r.platformNotes,
    };
  }

  /** Ficha completa de una empresa: equipo, números, IA, actividad y su historial. */
  async detail(id: string): Promise<PlatformOrgDetail> {
    const org = await this.orgById(id);
    return runUnscoped("consola de plataforma: ficha de empresa", async () => {
      const users = await this.prisma.$queryRaw<
        Array<{ id: string; email: string; name: string | null; role: string; isActive: boolean; createdAt: Date; last_seen: Date | null }>
      >`
        SELECT u.id, u.email, u.name, u.role::text AS role, u."isActive", u."createdAt",
          (SELECT max(s."lastUsedAt") FROM sessions s WHERE s."userId" = u.id AND s."revokedAt" IS NULL) AS last_seen
        FROM users u WHERE u."orgId" = ${id}
        ORDER BY u.role = 'ADMIN' DESC, u."createdAt"
      `;
      const numbers = await this.prisma.whatsappConnection.findMany({
        where: { orgId: id },
        orderBy: { connectedAt: "asc" },
        select: {
          id: true,
          label: true,
          displayPhoneNumber: true,
          mode: true,
          status: true,
          statusReason: true,
          isActive: true,
          connectedAt: true,
          capiEnabled: true,
        },
      });
      const ai = await this.prisma.$queryRaw<Array<{ source: string; feature: string; model: string; input: bigint; output: bigint; calls: bigint }>>`
        SELECT source, feature, model, sum("inputTokens")::bigint AS input, sum("outputTokens")::bigint AS output, count(*) AS calls
        FROM ai_usage WHERE "orgId" = ${id} AND "createdAt" >= date_trunc('month', now())
        GROUP BY 1, 2, 3 ORDER BY 4 DESC
      `;
      const activity = await this.prisma.$queryRaw<Array<{ day: Date; inbound: bigint; outbound: bigint }>>`
        SELECT date_trunc('day', "createdAt")::date AS day,
          count(*) FILTER (WHERE direction = 'INBOUND')  AS inbound,
          count(*) FILTER (WHERE direction = 'OUTBOUND') AS outbound
        FROM messages WHERE "orgId" = ${id} AND "createdAt" >= now() - interval '14 days'
        GROUP BY 1 ORDER BY 1
      `;
      const [counts] = await this.prisma.$queryRaw<Array<Record<string, bigint | null>>>`
        SELECT
          (SELECT count(*) FROM agent_configs a WHERE a."orgId" = ${id})                                    AS agents,
          (SELECT count(*) FROM flows f WHERE f."orgId" = ${id})                                            AS flows,
          (SELECT count(*) FROM campaigns c JOIN templates t ON t.id = c."templateId" WHERE t."orgId" = ${id}) AS campaigns,
          (SELECT count(*) FROM api_keys k WHERE k."orgId" = ${id} AND k."revokedAt" IS NULL)                AS api_keys,
          (SELECT count(*) FROM webhook_subscriptions w WHERE w."orgId" = ${id} AND w."isActive")            AS webhooks,
          (SELECT count(*) FROM deals d WHERE d."orgId" = ${id})                                            AS deals,
          (SELECT count(*) FROM conversations c WHERE c."orgId" = ${id} AND c.status = 'OPEN')               AS open_conversations
      `;
      const won = await this.prisma.$queryRaw<Array<{ currency: string; total: number | null; count: bigint }>>`
        SELECT d.currency, sum(d.value)::float AS total, count(*) AS count
        FROM deals d JOIN pipeline_stages s ON s.id = d."stageId"
        WHERE d."orgId" = ${id} AND s."isWon" AND coalesce(d."closedAt", d."updatedAt") >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 2 DESC NULLS LAST
      `;
      const audit = await this.auditRows({ orgId: id, limit: 30 });
      const n = (v: unknown) => Number(v ?? 0);
      return {
        org,
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt.toISOString(),
          lastSeenAt: u.last_seen?.toISOString() ?? null,
        })),
        numbers: numbers.map((w) => ({
          id: w.id,
          label: w.label,
          displayPhoneNumber: w.displayPhoneNumber,
          mode: w.mode,
          status: w.status,
          statusReason: w.statusReason,
          isActive: w.isActive,
          connectedAt: w.connectedAt.toISOString(),
          capiEnabled: w.capiEnabled,
        })),
        ai: ai.map((r) => ({
          source: r.source === "platform" ? ("platform" as const) : ("own" as const),
          feature: r.feature,
          model: r.model,
          inputTokens: n(r.input),
          outputTokens: n(r.output),
          calls: n(r.calls),
          usd: estimateAiCost(r.model, n(r.input), n(r.output)) ?? 0,
        })),
        activity: activity.map((d) => ({ day: toDay(d.day), inbound: n(d.inbound), outbound: n(d.outbound) })),
        counts: {
          agents: n(counts?.agents),
          flows: n(counts?.flows),
          campaigns: n(counts?.campaigns),
          apiKeys: n(counts?.api_keys),
          webhooks: n(counts?.webhooks),
          deals: n(counts?.deals),
          openConversations: n(counts?.open_conversations),
        },
        won30d: won.map((w) => ({ currency: w.currency, total: Number(w.total ?? 0), count: n(w.count) })),
        audit,
      };
    });
  }

  /**
   * IA del mes por empresa: gasto estimado con su clave (lo pagan ellas), con
   * la IA incluida de Driony (lo paga la plataforma) y conversaciones del cupo.
   * Precio por modelo, calculado al leer; a precio de lista, sin la caché.
   */
  private async monthAiByOrg(orgId?: string): Promise<Map<string, OrgAi>> {
    const only = orgId ? Prisma.sql`AND "orgId" = ${orgId}` : Prisma.empty;
    const [costs, convs] = await runUnscoped("consola de plataforma: consumo de IA", () =>
      Promise.all([
        this.prisma.$queryRaw<Array<{ orgId: string; source: string; model: string; input: bigint; output: bigint }>>`
          SELECT "orgId", source, model, sum("inputTokens")::bigint AS input, sum("outputTokens")::bigint AS output
          FROM ai_usage WHERE "createdAt" >= date_trunc('month', now()) ${only}
          GROUP BY 1, 2, 3
        `,
        this.prisma.$queryRaw<Array<{ orgId: string; count: bigint }>>`
          SELECT "orgId", count(DISTINCT "conversationId") AS count
          FROM ai_usage
          WHERE source = 'platform' AND "conversationId" IS NOT NULL
            AND feature = ANY(${[...AI_INCLUDED_COUNTED]}::text[])
            AND "createdAt" >= date_trunc('month', now() AT TIME ZONE 'UTC') ${only}
          GROUP BY 1
        `,
      ]),
    );
    const out = new Map<string, OrgAi>();
    const get = (id: string) => out.get(id) ?? out.set(id, { ownUsd: 0, platformUsd: 0, conversations: 0 }).get(id)!;
    for (const r of costs) {
      const input = Number(r.input);
      const output = Number(r.output);
      const cost = estimateAiCost(r.model, input, output) ?? (r.source === "platform" ? estimateAiCost(AI_INCLUDED_MODEL, input, output) ?? 0 : 0);
      const acc = get(r.orgId);
      if (r.source === "platform") acc.platformUsd += cost;
      else acc.ownUsd += cost;
    }
    for (const r of convs) get(r.orgId).conversations = Number(r.count);
    return out;
  }

  /** Resumen de la IA del mes para las cifras globales. */
  private async aiOverview(): Promise<Pick<PlatformOverview, "aiCostMonthUsd" | "aiIncluded">> {
    const [byOrg, plans] = await Promise.all([
      this.monthAiByOrg(),
      runUnscoped("consola de plataforma: planes", () =>
        this.prisma.organization.findMany({ select: { id: true, plan: true, trialEndsAt: true } }),
      ),
    ]);
    const planOf = new Map(plans.map((o) => [o.id, effectivePlan(o.plan, o.trialEndsAt)]));
    let own = 0;
    let platform = 0;
    let conversations = 0;
    let orgsUsing = 0;
    let orgsFull = 0;
    let orgsCapped = 0;
    for (const [id, a] of byOrg) {
      own += a.ownUsd;
      platform += a.platformUsd;
      conversations += a.conversations;
      if (a.platformUsd > 0) orgsUsing++;
      const limit = (planOf.get(id) ?? PLANS.free).aiConversations;
      if (limit !== null && limit > 0) {
        if (a.conversations >= limit) orgsFull++;
        if (a.platformUsd >= includedAiCapUsd(limit)) orgsCapped++;
      }
    }
    return {
      aiCostMonthUsd: own + platform,
      aiIncluded: {
        enabled: AiSettingsService.includedEnabled(),
        model: env("AI_INCLUDED_MODEL") ?? AI_INCLUDED_MODEL,
        platformCostUsd: platform,
        ownCostUsd: own,
        conversations,
        orgsUsing,
        orgsFull,
        orgsCapped,
      },
    };
  }

  /** Cambiar de plan, vencimiento, notas, o suspender/reactivar. `organizations` no lleva RLS. */
  async update(id: string, input: UpdatePlatformOrgInput, actor: string): Promise<PlatformOrg> {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, plan: true, isActive: true, planExpiresAt: true, trialEndsAt: true },
    });
    if (!org) throw new NotFoundException("Empresa no encontrada");
    await this.prisma.organization.update({
      where: { id },
      data: {
        ...(input.plan !== undefined ? { plan: input.plan } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.planExpiresAt !== undefined ? { planExpiresAt: input.planExpiresAt ? new Date(input.planExpiresAt) : null } : {}),
        ...(input.trialEndsAt !== undefined ? { trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null } : {}),
        ...(input.platformNotes !== undefined ? { platformNotes: input.platformNotes?.trim() || null } : {}),
      },
    });
    if (input.plan !== undefined && input.plan !== org.plan) {
      await this.audit(actor, "plan_changed", id, { from: org.plan, to: input.plan });
    }
    if (input.isActive !== undefined && input.isActive !== org.isActive) {
      await this.audit(actor, input.isActive ? "reactivated" : "suspended", id, null);
    }
    if (input.planExpiresAt !== undefined) {
      const before = org.planExpiresAt?.toISOString() ?? null;
      if (before !== (input.planExpiresAt ?? null)) {
        await this.audit(actor, "expiry_changed", id, { from: before, to: input.planExpiresAt ?? null });
      }
    }
    if (input.trialEndsAt !== undefined) {
      const before = org.trialEndsAt?.toISOString() ?? null;
      if (before !== (input.trialEndsAt ?? null)) {
        await this.audit(actor, "trial_changed", id, { from: before, to: input.trialEndsAt ?? null });
      }
    }
    if (input.platformNotes !== undefined) await this.audit(actor, "notes_changed", id, null);
    return this.orgById(id);
  }

  /**
   * Pase para entrar en el panel de una empresa como su administrador: el
   * mismo pase de un solo uso y dos minutos que usa el alta. Queda en el
   * diario del operador, con su correo y el usuario usado.
   */
  async loginAs(id: string, actor: string): Promise<{ url: string; email: string }> {
    const org = await this.prisma.organization.findUnique({ where: { id }, select: { id: true, slug: true, isActive: true } });
    if (!org) throw new NotFoundException("Empresa no encontrada");
    if (!org.isActive) throw new BadRequestException("La empresa está suspendida: reactívala antes de entrar");
    const admin = await runUnscoped("consola de plataforma: entrar como", () =>
      this.prisma.user.findFirst({
        where: { orgId: id, role: "ADMIN", isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true },
      }),
    );
    if (!admin) throw new BadRequestException("La empresa no tiene ningún administrador activo");
    const token = await this.jwt.signAsync(
      { sub: admin.id, org: org.id, purpose: "handoff", jti: randomUUID() },
      { secret: process.env.JWT_ACCESS_SECRET ?? "dev-secret", expiresIn: "2m" },
    );
    await this.audit(actor, "login_as", id, { userId: admin.id, email: admin.email });
    this.log.warn(`${actor} entra en ${org.slug} como ${admin.email}`);
    return { url: `${this.urlFor(org.slug)}/handoff?token=${encodeURIComponent(token)}&to=%2F`, email: admin.email };
  }

  // ── Salud ───────────────────────────────────────────────────
  async health(): Promise<PlatformHealth> {
    const queues: Array<[string, Queue]> = [
      ["Entrantes", this.qInbound],
      ["Salientes", this.qOutbound],
      ["Respuestas IA", this.qAiReply],
      ["Flujos", this.qFlow],
      ["Difusiones", this.qCampaign],
      ["Leads de Meta", this.qMetaLeads],
      ["Webhooks salientes", this.qWebhook],
    ];
    const queueStats = await Promise.all(
      queues.map(async ([name, q]) => {
        try {
          const c = await q.getJobCounts("waiting", "active", "delayed", "failed");
          return { name, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, ok: true };
        } catch {
          return { name, waiting: 0, active: 0, delayed: 0, failed: 0, ok: false };
        }
      }),
    );
    return runUnscoped("consola de plataforma: salud", async () => {
      const numbers = await this.prisma.$queryRaw<
        Array<{ orgId: string; orgName: string; orgSlug: string; id: string; label: string | null; number: string | null; reason: string | null; since: Date }>
      >`
        SELECT w."orgId", o.name AS "orgName", o.slug AS "orgSlug", w.id, w.label, w."displayPhoneNumber" AS number, w."statusReason" AS reason, w."updatedAt" AS since
        FROM whatsapp_connections w JOIN organizations o ON o.id = w."orgId"
        WHERE w."isActive" AND w.status = 'error'
        ORDER BY w."updatedAt" DESC LIMIT 50
      `;
      const failed = await this.prisma.$queryRaw<Array<{ orgId: string; orgName: string; orgSlug: string; count: bigint; lastError: string | null }>>`
        SELECT m."orgId", o.name AS "orgName", o.slug AS "orgSlug", count(*) AS count,
          (SELECT m2."errorReason" FROM messages m2 WHERE m2."orgId" = m."orgId" AND m2.status = 'FAILED' AND m2."errorReason" IS NOT NULL ORDER BY m2."createdAt" DESC LIMIT 1) AS "lastError"
        FROM messages m JOIN organizations o ON o.id = m."orgId"
        WHERE m.status = 'FAILED' AND m.direction = 'OUTBOUND' AND m."createdAt" >= now() - interval '24 hours'
        GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 50
      `;
      const webhooks = await this.prisma.$queryRaw<
        Array<{ orgId: string; orgName: string; url: string; failedCount: number; lastError: string | null; lastStatus: number | null; lastDeliveryAt: Date | null }>
      >`
        SELECT w."orgId", o.name AS "orgName", w.url, w."failedCount", w."lastError", w."lastStatus", w."lastDeliveryAt"
        FROM webhook_subscriptions w JOIN organizations o ON o.id = w."orgId"
        WHERE w."isActive" AND w."failedCount" > 0
        ORDER BY w."failedCount" DESC LIMIT 50
      `;
      const [media] = await this.prisma.$queryRaw<Array<{ failed24: bigint; sent24: bigint }>>`
        SELECT
          count(*) FILTER (WHERE status = 'FAILED') AS failed24,
          count(*) FILTER (WHERE status <> 'FAILED') AS sent24
        FROM messages WHERE direction = 'OUTBOUND' AND "createdAt" >= now() - interval '24 hours'
      `;
      const n = (v: unknown) => Number(v ?? 0);
      return {
        queues: queueStats,
        numbersWithError: numbers.map((r) => ({
          orgId: r.orgId,
          orgName: r.orgName,
          orgSlug: r.orgSlug,
          id: r.id,
          label: r.label,
          number: r.number,
          reason: r.reason,
          since: r.since.toISOString(),
        })),
        outbound24h: { failed: n(media?.failed24), sent: n(media?.sent24) },
        failedByOrg: failed.map((r) => ({ orgId: r.orgId, orgName: r.orgName, orgSlug: r.orgSlug, count: n(r.count), lastError: r.lastError })),
        webhooksFailing: webhooks.map((w) => ({
          orgId: w.orgId,
          orgName: w.orgName,
          url: w.url,
          failedCount: Number(w.failedCount),
          lastError: w.lastError,
          lastStatus: w.lastStatus,
          lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
        })),
      };
    });
  }

  // ── Diario del operador ─────────────────────────────────────
  private async audit(actor: string, action: string, orgId: string | null, details: unknown): Promise<void> {
    await this.prisma.platformAuditLog.create({
      data: { actorEmail: actor, action, orgId, details: details === null || details === undefined ? undefined : (details as object) },
    });
  }

  // ── Feedback de las empresas ─────────────────────────────
  async feedbackList(f: { kind?: FeedbackKind; status?: FeedbackStatus | "open" }): Promise<PlatformFeedbackList> {
    return runUnscoped("consola de plataforma: feedback", async () => {
      const where: Prisma.FeedbackWhereInput = {
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.status === "open" ? { status: { in: ["new", "seen"] } } : f.status ? { status: f.status } : {}),
      };
      const [rows, newCount, opinions] = await Promise.all([
        this.prisma.feedback.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 300,
          include: { org: { select: { name: true, slug: true } }, user: { select: { name: true, email: true } } },
        }),
        this.prisma.feedback.count({ where: { status: "new" } }),
        this.prisma.feedback.aggregate({ where: { kind: "opinion", rating: { not: null } }, _avg: { rating: true }, _count: { _all: true } }),
      ]);
      return {
        items: rows.map((r) => this.feedbackDto(r)),
        newCount,
        opinions: opinions._count._all,
        avgRating: opinions._avg.rating ?? null,
      };
    });
  }

  async updateFeedback(id: string, status: FeedbackStatus): Promise<PlatformFeedback> {
    return runUnscoped("consola de plataforma: feedback", async () => {
      const r = await this.prisma.feedback
        .update({
          where: { id },
          data: { status },
          include: { org: { select: { name: true, slug: true } }, user: { select: { name: true, email: true } } },
        })
        .catch(() => {
          throw new NotFoundException("Feedback no encontrado");
        });
      return this.feedbackDto(r);
    });
  }

  private feedbackDto(r: {
    id: string; kind: string; status: string; message: string; rating: number | null; pagePath: string | null; userAgent: string | null;
    orgId: string; createdAt: Date; org: { name: string; slug: string }; user: { name: string | null; email: string } | null;
  }): PlatformFeedback {
    return {
      id: r.id,
      kind: r.kind as FeedbackKind,
      status: r.status as FeedbackStatus,
      message: r.message,
      rating: r.rating,
      pagePath: r.pagePath,
      userAgent: r.userAgent,
      orgId: r.orgId,
      orgName: r.org.name,
      orgSlug: r.org.slug,
      userName: r.user?.name ?? null,
      userEmail: r.user?.email ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async auditList(limit = 100): Promise<PlatformAuditEntry[]> {
    return runUnscoped("consola de plataforma: diario", () => this.auditRows({ limit }));
  }

  private async auditRows(opts: { orgId?: string; limit: number }): Promise<PlatformAuditEntry[]> {
    const rows = await this.prisma.platformAuditLog.findMany({
      where: opts.orgId ? { orgId: opts.orgId } : {},
      orderBy: { createdAt: "desc" },
      take: opts.limit,
      include: { org: { select: { name: true, slug: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      actorEmail: r.actorEmail,
      action: r.action,
      orgId: r.orgId,
      orgName: r.org?.name ?? null,
      orgSlug: r.org?.slug ?? null,
      details: (r.details as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  isActive: boolean;
  createdAt: Date;
  planExpiresAt: Date | null;
  trialEndsAt: Date | null;
  platformNotes: string | null;
  admin_email: string | null;
  users: bigint;
  numbers: bigint;
  coexistence: bigint;
  numbers_error: bigint;
  contacts: bigint;
  active_month: bigint;
  messages30: bigint;
  failed24: bigint;
  won30: bigint;
  last_message_at: Date | null;
  onboarding_completed_at: Date | null;
  ai_own_key: boolean;
}

interface OrgAi {
  ownUsd: number;
  platformUsd: number;
  conversations: number;
}

// La proyección de una empresa para la consola, compartida por el listado y la ficha.
const ORG_SELECT = Prisma.sql`
  SELECT o.id, o.slug, o.name, o.plan, o."isActive", o."createdAt", o."planExpiresAt", o."trialEndsAt", o."platformNotes",
    (SELECT u.email FROM users u WHERE u."orgId" = o.id AND u.role = 'ADMIN' ORDER BY u."createdAt" LIMIT 1) AS admin_email,
    (SELECT count(*) FROM users u WHERE u."orgId" = o.id AND u."isActive")                        AS users,
    (SELECT count(*) FROM whatsapp_connections w WHERE w."orgId" = o.id AND w."isActive")         AS numbers,
    (SELECT count(*) FROM whatsapp_connections w WHERE w."orgId" = o.id AND w."isActive" AND w.mode = 'coexistence') AS coexistence,
    (SELECT count(*) FROM whatsapp_connections w WHERE w."orgId" = o.id AND w."isActive" AND w.status = 'error') AS numbers_error,
    (SELECT count(*) FROM contacts c WHERE c."orgId" = o.id)                                      AS contacts,
    (SELECT count(DISTINCT cv."contactId") FROM messages m JOIN conversations cv ON cv.id = m."conversationId" WHERE m."orgId" = o.id AND m."campaignId" IS NULL AND m."createdAt" >= date_trunc('month', now())) AS active_month,
    (SELECT count(*) FROM messages m WHERE m."orgId" = o.id AND m."createdAt" >= now() - interval '30 days') AS messages30,
    (SELECT count(*) FROM messages m WHERE m."orgId" = o.id AND m.status = 'FAILED' AND m.direction = 'OUTBOUND' AND m."createdAt" >= now() - interval '24 hours') AS failed24,
    (SELECT count(*) FROM deals d JOIN pipeline_stages s ON s.id = d."stageId" WHERE d."orgId" = o.id AND s."isWon" AND coalesce(d."closedAt", d."updatedAt") >= now() - interval '30 days') AS won30,
    (SELECT max(m."createdAt") FROM messages m WHERE m."orgId" = o.id)                            AS last_message_at,
    (SELECT s."completedAt" FROM onboarding_states s WHERE s."orgId" = o.id)                     AS onboarding_completed_at,
    EXISTS (SELECT 1 FROM ai_settings a WHERE a."orgId" = o.id AND (a."openaiKeyEnc" IS NOT NULL OR a."anthropicKeyEnc" IS NOT NULL)) AS ai_own_key
  FROM organizations o
`;

function toDay(d: Date | string): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}
