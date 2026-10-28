import { Injectable } from "@nestjs/common";
import type { DashboardDto, DashboardPeriod } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";

const DAYS: Record<DashboardPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Zona horaria IANA válida o UTC. Se pasa a SQL como parámetro, nunca pegada. */
export function safeTimeZone(tz: string | undefined): string {
  if (!tz || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** "2026-09-30" en la zona horaria dada. */
export function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * Métricas del panel. Todo en SQL agregado y con el filtro de empresa
 * explícito (además de RLS): son consultas crudas, donde la capa de Prisma
 * que filtra sola no llega.
 *
 * Los mensajes de difusiones no cuentan como respuestas: una campaña no es
 * atender a nadie, y dispararía la parte de "respondido por humanos".
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async get(period: DashboardPeriod, tzRaw: string | undefined, pipelineId?: string): Promise<DashboardDto> {
    const orgId = this.tenant.orgId();
    const tz = safeTimeZone(tzRaw);
    const days = DAYS[period];
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const prevFrom = new Date(from.getTime() - days * 86_400_000);
    const q = <T = Row>(sql: TemplateStringsArray, ...args: unknown[]) =>
      this.prisma.$queryRaw<T[]>(sql, ...args);

    const [convDaily, leadDaily, msgDaily, wonDaily, sources, heat, team, awaiting, prevCounts, frNow, frPrev, closedNow, closedPrev] =
      await Promise.all([
        q`SELECT ((c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day, count(*) AS n
          FROM conversations c WHERE c."orgId" = ${orgId} AND c."createdAt" >= ${from} AND c."createdAt" < ${to} GROUP BY 1`,
        q`SELECT ((c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day, count(*) AS n
          FROM contacts c WHERE c."orgId" = ${orgId} AND c."createdAt" >= ${from} AND c."createdAt" < ${to} GROUP BY 1`,
        q`SELECT ((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day, m.direction::text AS dir, m.author::text AS author, count(*) AS n
          FROM messages m WHERE m."orgId" = ${orgId} AND m."createdAt" >= ${from} AND m."createdAt" < ${to} AND m."campaignId" IS NULL
          GROUP BY 1, 2, 3`,
        q`SELECT ((d."closedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day, d.currency, st."isWon" AS won, count(*) AS n, coalesce(sum(d.value), 0) AS v
          FROM deals d JOIN pipeline_stages st ON st.id = d."stageId"
          WHERE d."orgId" = ${orgId} AND d."closedAt" >= ${from} AND d."closedAt" < ${to} AND d."discardedAt" IS NULL
          GROUP BY 1, 2, 3`,
        q`SELECT coalesce(s.name, 'Sin fuente') AS name, count(*) AS n
          FROM contacts c LEFT JOIN sources s ON s.id = c."sourceId"
          WHERE c."orgId" = ${orgId} AND c."createdAt" >= ${from} AND c."createdAt" < ${to}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        q`SELECT extract(dow FROM ((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}))::int AS dow,
                 extract(hour FROM ((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}))::int AS h, count(*) AS n
          FROM messages m WHERE m."orgId" = ${orgId} AND m.direction = 'INBOUND' AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
          GROUP BY 1, 2`,
        q`SELECT c."assignedAgentId" AS uid, u.name, u.email, count(*) AS convs,
                 count(*) FILTER (WHERE c.status = 'CLOSED') AS closed,
                 count(*) FILTER (WHERE c."awaitingReply" AND c.status <> 'CLOSED') AS awaiting
          FROM conversations c LEFT JOIN users u ON u.id = c."assignedAgentId"
          WHERE c."orgId" = ${orgId} AND c."lastMessageAt" >= ${from}
          GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 12`,
        q`SELECT count(*) AS n FROM conversations c WHERE c."orgId" = ${orgId} AND c."awaitingReply" AND c.status <> 'CLOSED'`,
        q`SELECT
            (SELECT count(*) FROM conversations WHERE "orgId" = ${orgId} AND "createdAt" >= ${prevFrom} AND "createdAt" < ${from}) AS convs,
            (SELECT count(*) FROM contacts WHERE "orgId" = ${orgId} AND "createdAt" >= ${prevFrom} AND "createdAt" < ${from}) AS leads,
            (SELECT count(*) FROM messages WHERE "orgId" = ${orgId} AND direction = 'INBOUND' AND "createdAt" >= ${prevFrom} AND "createdAt" < ${from}) AS inbound,
            (SELECT count(*) FROM messages WHERE "orgId" = ${orgId} AND direction = 'OUTBOUND' AND author = 'AI' AND "campaignId" IS NULL AND "createdAt" >= ${prevFrom} AND "createdAt" < ${from}) AS out_ai,
            (SELECT count(*) FROM messages WHERE "orgId" = ${orgId} AND direction = 'OUTBOUND' AND author = 'HUMAN' AND "campaignId" IS NULL AND "createdAt" >= ${prevFrom} AND "createdAt" < ${from}) AS out_human`,
        this.firstResponses(orgId, from, to),
        this.firstResponses(orgId, prevFrom, from),
        this.closedTotals(orgId, from, to),
        this.closedTotals(orgId, prevFrom, from),
      ]);

    // Moneda principal: la de más oportunidades cerradas; si no hay, la de las abiertas.
    const currency = closedNow.mainCurrency ?? (await this.openCurrency(orgId)) ?? "USD";

    // Serie diaria completa (los días sin nada también existen).
    const dayKeys: string[] = [];
    for (let t = from.getTime() + 86_400_000; t <= to.getTime() + 1; t += 86_400_000) {
      const k = localDay(new Date(t), tz);
      if (dayKeys[dayKeys.length - 1] !== k) dayKeys.push(k);
    }
    const daily = new Map(
      dayKeys.map((k) => [k, { day: k, conversations: 0, leads: 0, inbound: 0, outboundAi: 0, outboundHuman: 0, wonValue: 0 }]),
    );
    const at = (k: string) => daily.get(k);
    for (const r of convDaily) { const x = at(d(r.day)); if (x) x.conversations += n(r.n); }
    for (const r of leadDaily) { const x = at(d(r.day)); if (x) x.leads += n(r.n); }
    let inbound = 0, outAi = 0, outHuman = 0;
    for (const r of msgDaily) {
      const x = at(d(r.day));
      const c = n(r.n);
      if (r.dir === "INBOUND") { inbound += c; if (x) x.inbound += c; }
      else if (r.author === "AI") { outAi += c; if (x) x.outboundAi += c; }
      else if (r.author === "HUMAN") { outHuman += c; if (x) x.outboundHuman += c; }
    }
    for (const r of wonDaily) {
      if (!r.won || r.currency !== currency) continue;
      const x = at(d(r.day));
      if (x) x.wonValue += n(r.v);
    }

    const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const r of heat) heatmap[n(r.dow)]![n(r.h)] = n(r.n);

    const prev = prevCounts[0] ?? {};
    const share = (ai: number, human: number) => (ai + human ? ai / (ai + human) : null);
    const byAgent = new Map<string, number[]>();
    for (const f of frNow) {
      const key = f.agent ?? "";
      byAgent.set(key, [...(byAgent.get(key) ?? []), f.secs]);
    }

    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      tz,
      currency,
      kpis: {
        conversations: { value: [...daily.values()].reduce((a, x) => a + x.conversations, 0), prev: n(prev.convs) },
        leads: { value: [...daily.values()].reduce((a, x) => a + x.leads, 0), prev: n(prev.leads) },
        inbound: { value: inbound, prev: n(prev.inbound) },
        firstResponseSec: { value: median(frNow.map((f) => f.secs)), prev: median(frPrev.map((f) => f.secs)) },
        aiShare: { value: share(outAi, outHuman), prev: share(n(prev.out_ai), n(prev.out_human)) },
        wonCount: { value: closedNow.won, prev: closedPrev.won },
        wonValue: { value: closedNow.wonValue.get(currency) ?? 0, prev: closedPrev.wonValue.get(currency) ?? 0 },
        winRate: {
          value: closedNow.won + closedNow.lost ? closedNow.won / (closedNow.won + closedNow.lost) : null,
          prev: closedPrev.won + closedPrev.lost ? closedPrev.won / (closedPrev.won + closedPrev.lost) : null,
        },
        awaitingNow: n(awaiting[0]?.n),
      },
      daily: [...daily.values()],
      sources: sources.map((r) => ({ name: String(r.name), count: n(r.n) })),
      lossReasons: (
        await q`SELECT coalesce(nullif(d."lostReason", ''), 'Sin motivo') AS reason, count(*) AS n
          FROM deals d JOIN pipeline_stages st ON st.id = d."stageId"
          WHERE d."orgId" = ${orgId} AND st."isLost" AND d."discardedAt" IS NULL
            AND d."closedAt" >= ${from} AND d."closedAt" < ${to}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`
      ).map((r) => ({ reason: String(r.reason), count: n(r.n) })),
      funnel: await this.funnel(orgId, pipelineId, currency),
      team: team.map((r) => ({
        userId: (r.uid as string | null) ?? null,
        name: r.uid ? String(r.name || r.email || "Sin nombre") : "Sin asignar",
        conversations: n(r.convs),
        closed: n(r.closed),
        awaiting: n(r.awaiting),
        firstResponseSec: median(byAgent.get((r.uid as string | null) ?? "") ?? []),
      })),
      heatmap,
    };
  }

  /**
   * Tiempo hasta la primera respuesta de cada conversación empezada en el
   * rango: del primer mensaje del cliente a la primera respuesta (de la IA o
   * de una persona), sin contar difusiones.
   */
  private async firstResponses(orgId: string, from: Date, to: Date): Promise<{ secs: number; agent: string | null }[]> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT extract(epoch FROM (fo."createdAt" - fi."createdAt")) AS secs, c."assignedAgentId" AS agent
      FROM conversations c
      JOIN LATERAL (
        SELECT m."createdAt" FROM messages m
        WHERE m."conversationId" = c.id AND m.direction = 'INBOUND'
        ORDER BY m."createdAt" LIMIT 1
      ) fi ON true
      JOIN LATERAL (
        SELECT m."createdAt" FROM messages m
        WHERE m."conversationId" = c.id AND m.direction = 'OUTBOUND' AND m."campaignId" IS NULL AND m."createdAt" >= fi."createdAt"
        ORDER BY m."createdAt" LIMIT 1
      ) fo ON true
      WHERE c."orgId" = ${orgId} AND c."createdAt" >= ${from} AND c."createdAt" < ${to}
      LIMIT 20000`;
    return rows.map((r) => ({ secs: n(r.secs), agent: (r.agent as string | null) ?? null }));
  }

  private async closedTotals(orgId: string, from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT st."isWon" AS won, d.currency, count(*) AS n, coalesce(sum(d.value), 0) AS v
      FROM deals d JOIN pipeline_stages st ON st.id = d."stageId"
      WHERE d."orgId" = ${orgId} AND d."closedAt" >= ${from} AND d."closedAt" < ${to} AND d."discardedAt" IS NULL
      GROUP BY 1, 2`;
    let won = 0, lost = 0;
    const wonValue = new Map<string, number>();
    const perCurrency = new Map<string, number>();
    for (const r of rows) {
      const c = n(r.n);
      perCurrency.set(String(r.currency), (perCurrency.get(String(r.currency)) ?? 0) + c);
      if (r.won) {
        won += c;
        wonValue.set(String(r.currency), (wonValue.get(String(r.currency)) ?? 0) + n(r.v));
      } else lost += c;
    }
    const mainCurrency = [...perCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { won, lost, wonValue, mainCurrency };
  }

  private async openCurrency(orgId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT currency, count(*) AS n FROM deals WHERE "orgId" = ${orgId} AND "discardedAt" IS NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1`;
    return rows[0] ? String(rows[0].currency) : null;
  }

  /** Embudo actual: oportunidades abiertas por etapa del embudo elegido. */
  private async funnel(orgId: string, pipelineId: string | undefined, currency: string): Promise<DashboardDto["funnel"]> {
    const pipelines = await this.prisma.pipeline.findMany({
      orderBy: [{ isDefault: "desc" }, { order: "asc" }],
      select: { id: true, name: true },
    });
    const current = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
    if (!current) return { pipelineId: null, pipelineName: null, pipelines: [], stages: [] };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT st.id, st.name, st."order", st."isWon" AS won, st."isLost" AS lost,
             count(d.id) AS n, coalesce(sum(d.value) FILTER (WHERE d.currency = ${currency}), 0) AS v
      FROM pipeline_stages st
      LEFT JOIN deals d ON d."stageId" = st.id AND d."discardedAt" IS NULL
      WHERE st."orgId" = ${orgId} AND st."pipelineId" = ${current.id}
      GROUP BY st.id, st.name, st."order", st."isWon", st."isLost"
      ORDER BY st."order"`;
    return {
      pipelineId: current.id,
      pipelineName: current.name,
      pipelines,
      stages: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        count: n(r.n),
        value: n(r.v),
        isWon: !!r.won,
        isLost: !!r.lost,
      })),
    };
  }
}
