import { Injectable, Logger } from "@nestjs/common";
import {
  AI_FEATURE_LABELS,
  AI_INCLUDED_COUNTED,
  AI_INCLUDED_MODEL,
  AI_PRICES_REVIEWED,
  estimateAiCost,
  type OrgAiBillingMode,
  type AiFeature,
  type AiUsagePeriod,
  type AiUsageReport,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { currentOrgId } from "../../infra/tenant/tenant.context";
import { TenantService } from "../../infra/tenant/tenant.service";

export interface UsageEvent {
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  conversationId?: string | null;
  /**
   * Quién pagó la llamada. Viene de las credenciales resueltas
   * (`ResolvedCredentials.billingMode`), nunca se deduce aquí del modelo.
   */
  billingMode: OrgAiBillingMode;
  /** Id de la respuesta del proveedor, si lo da: la misma respuesta no se registra dos veces. */
  requestId?: string | null;
}

/** De quién era la clave: own (la empresa o el servidor propio) | platform (la de Driony). */
export type UsageSource = "own" | "platform";

/**
 * Registro y lectura del consumo de IA de cada empresa.
 *
 * Se registra en un solo sitio por tipo de llamada (el enrutador de modelos,
 * la clasificación y los embeddings), así ninguna función nueva se queda sin
 * contar por olvido. El registro nunca bloquea ni hace fallar la llamada.
 *
 * Cada fila dice además quién pagó: la modalidad la fija quien resolvió la
 * credencial (AiSettingsService) y aquí solo se copia; `source` se deriva de
 * ella por compatibilidad con los informes. Lo que corrió con la clave de
 * Driony (MANAGED) es lo que cuenta para el cupo de IA incluida del plan.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger("AiUsage");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  record(e: UsageEvent): void {
    const orgId = currentOrgId();
    if (!orgId || /^fake/i.test(e.model) || (e.inputTokens <= 0 && e.outputTokens <= 0)) return;
    const source: UsageSource = e.billingMode === "MANAGED" ? "platform" : "own";
    void this.prisma.aiUsage
      .create({
        data: {
          orgId,
          feature: e.feature,
          model: e.model,
          inputTokens: Math.max(0, Math.round(e.inputTokens)),
          outputTokens: Math.max(0, Math.round(e.outputTokens)),
          conversationId: e.conversationId ?? null,
          source,
          billingMode: e.billingMode,
          requestId: e.requestId || null,
        },
      })
      .catch((err: Error & { code?: string }) => {
        // La misma respuesta ya estaba registrada (reintento): no se duplica el gasto.
        if (err.code === "P2002") return;
        this.logger.warn(`No se pudo registrar el consumo: ${err.message}`);
      });
  }

  /**
   * ¿Esta conversación ya cuenta este mes para el cupo de la IA incluida? Las
   * que ya cuentan se siguen atendiendo aunque el cupo esté lleno.
   */
  async countedThisMonth(orgId: string, conversationId: string): Promise<boolean> {
    const hit = await this.prisma.aiUsage.findFirst({
      where: {
        orgId,
        conversationId,
        source: "platform",
        feature: { in: [...AI_INCLUDED_COUNTED] },
        createdAt: { gte: monthStart() },
      },
      select: { id: true },
    });
    return !!hit;
  }

  /**
   * Uso de la IA de Driony en el mes en curso (UTC): conversaciones distintas
   * que el agente atendió y coste estimado de todo lo gastado con su clave.
   */
  async includedUsage(orgId: string): Promise<{ conversations: number; costUsd: number }> {
    const from = monthStart();
    const [convs, byModel] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT count(DISTINCT "conversationId") AS count FROM ai_usage
        WHERE "orgId" = ${orgId} AND source = 'platform' AND "createdAt" >= ${from}
          AND "conversationId" IS NOT NULL AND feature = ANY(${[...AI_INCLUDED_COUNTED]}::text[])
      `,
      this.prisma.aiUsage.groupBy({
        by: ["model"],
        where: { orgId, source: "platform", createdAt: { gte: from } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);
    let costUsd = 0;
    for (const r of byModel) {
      // Un modelo sin precio en la tabla se cuenta al precio del modelo de la
      // IA incluida, para que un hueco de la tabla no deje el tope sin efecto.
      const input = r._sum.inputTokens ?? 0;
      const output = r._sum.outputTokens ?? 0;
      costUsd += estimateAiCost(r.model, input, output) ?? estimateAiCost(AI_INCLUDED_MODEL, input, output) ?? 0;
    }
    return { conversations: Number(convs[0]?.count ?? 0), costUsd };
  }

  async report(period: AiUsagePeriod): Promise<AiUsageReport> {
    const { from, to } = range(period);
    const orgId = this.tenant.orgId();

    // Agrupado en la base: por función y modelo, y por día y modelo (el
    // precio depende del modelo, así que el coste se calcula aquí después).
    const byFM = await this.prisma.aiUsage.groupBy({
      by: ["feature", "model", "source"],
      where: { createdAt: { gte: from, lt: to } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: { _all: true },
    });
    const days = await this.prisma.$queryRaw<Array<{ day: Date; model: string; input: bigint; output: bigint }>>`
      SELECT date_trunc('day', "createdAt")::date AS day, model,
             sum("inputTokens")::bigint AS input, sum("outputTokens")::bigint AS output
      FROM ai_usage
      WHERE "orgId" = ${orgId} AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1, 2 ORDER BY 1
    `;

    const empty = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: false });
    const total = empty();
    const bySource = { own: empty(), platform: empty() };
    const features = new Map<string, ReturnType<typeof empty>>();
    const models = new Map<string, ReturnType<typeof empty> & { priced: boolean }>();

    for (const r of byFM) {
      const input = r._sum.inputTokens ?? 0;
      const output = r._sum.outputTokens ?? 0;
      const calls = r._count._all;
      const cost = estimateAiCost(r.model, input, output);
      for (const acc of [
        total,
        r.source === "platform" ? bySource.platform : bySource.own,
        features.get(r.feature) ?? features.set(r.feature, empty()).get(r.feature)!,
        models.get(r.model) ?? models.set(r.model, { ...empty(), priced: cost !== null }).get(r.model)!,
      ]) {
        acc.calls += calls;
        acc.inputTokens += input;
        acc.outputTokens += output;
        if (cost === null) acc.unpriced = true;
        else acc.costUsd += cost;
      }
    }

    const dayMap = new Map<string, { tokens: number; costUsd: number }>();
    for (const d of days) {
      const key = (d.day instanceof Date ? d.day.toISOString() : String(d.day)).slice(0, 10);
      const cur = dayMap.get(key) ?? { tokens: 0, costUsd: 0 };
      const input = Number(d.input);
      const output = Number(d.output);
      cur.tokens += input + output;
      cur.costUsd += estimateAiCost(d.model, input, output) ?? 0;
      dayMap.set(key, cur);
    }
    const byDay: AiUsageReport["byDay"] = [];
    for (let t = startOfDay(from).getTime(); t < to.getTime(); t += 86_400_000) {
      const key = new Date(t).toISOString().slice(0, 10);
      byDay.push({ day: key, ...(dayMap.get(key) ?? { tokens: 0, costUsd: 0 }) });
    }

    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      total,
      bySource,
      byFeature: [...features.entries()]
        .map(([feature, v]) => ({ feature, label: AI_FEATURE_LABELS[feature as AiFeature] ?? feature, ...v }))
        .sort((a, b) => b.costUsd - a.costUsd || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)),
      byModel: [...models.entries()]
        .map(([model, v]) => ({ model, ...v }))
        .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)),
      byDay,
      pricesReviewed: AI_PRICES_REVIEWED,
    };
  }
}

/** Día 1 del mes en curso, UTC: el cupo de la IA incluida cuenta desde aquí. */
export function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Día 1 del mes siguiente, UTC: cuando el cupo vuelve a empezar. */
export function nextMonthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function range(period: AiUsagePeriod): { from: Date; to: Date } {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (period === "last_month") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), to: monthStart };
  }
  if (period === "30d") {
    return { from: startOfDay(new Date(now.getTime() - 29 * 86_400_000)), to: new Date(now.getTime() + 1000) };
  }
  return { from: monthStart, to: new Date(now.getTime() + 1000) };
}
