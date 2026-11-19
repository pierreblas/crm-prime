import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readAdReferral, type AdSalesReport, type DashboardPeriod } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { aggregateAdSales, type AdClick } from "./ad-sales";

const DAYS: Record<DashboardPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };
/** Tope de filas por consulta: el informe es de un periodo, no un volcado. */
const MAX_ROWS = 20_000;
const CHUNK = 5_000;

function chunks<T>(xs: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Ventas por anuncio (Panel): trae los clics en anuncios del periodo, las
 * oportunidades de esos clientes y sus pasos por etapas «potencial», y lo
 * cuenta ad-sales.ts. Filtro de empresa explícito en cada consulta, además del
 * de la capa de Prisma y RLS.
 */
@Injectable()
export class AdSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async report(period: DashboardPeriod): Promise<AdSalesReport> {
    const orgId = this.tenant.orgId();
    const from = new Date(Date.now() - DAYS[period] * 86_400_000);

    const [messages, conversations] = await Promise.all([
      // Cada clic queda en el mensaje que lo trajo (también con el chat ya abierto).
      this.prisma.message.findMany({
        where: { orgId, direction: "INBOUND", referral: { not: Prisma.DbNull }, createdAt: { gte: from } },
        // Si hubiera más que el tope, que se queden los más recientes (el último clic es el que cuenta).
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
        select: { referral: true, createdAt: true, conversation: { select: { contactId: true, channelKind: true } } },
      }),
      // Las conversaciones nuevas del periodo en las que el cliente escribió: las
      // de antes de guardar el clic por mensaje traen el anuncio aquí, y las
      // demás son los «sin anuncio». Sin mensaje del cliente en el periodo no
      // cuentan: una difusión a 500 contactos o el historial importado al
      // conectar un número abren conversaciones sin que nadie haya escrito.
      this.prisma.conversation.findMany({
        where: { orgId, createdAt: { gte: from }, messages: { some: { direction: "INBOUND", createdAt: { gte: from } } } },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
        select: { contactId: true, createdAt: true, referral: true, channelKind: true },
      }),
    ]);

    const clicks: AdClick[] = [];
    for (const m of messages) {
      const referral = readAdReferral(m.referral);
      if (referral) clicks.push({ contactId: m.conversation.contactId, at: m.createdAt, referral, channel: m.conversation.channelKind });
    }
    const withMessageClick = new Set(clicks.map((c) => c.contactId));
    const started = new Map<string, Date>();
    for (const c of conversations) {
      // La primera del periodo (llegan de la más reciente a la más antigua).
      const seen = started.get(c.contactId);
      if (!seen || c.createdAt < seen) started.set(c.contactId, c.createdAt);
      if (withMessageClick.has(c.contactId)) continue;
      const referral = readAdReferral(c.referral);
      if (referral) clicks.push({ contactId: c.contactId, at: c.createdAt, referral, channel: c.channelKind });
    }

    const contactIds = [...new Set([...clicks.map((c) => c.contactId), ...started.keys()])];
    const deals = (
      await Promise.all(
        chunks(contactIds).map((ids) =>
          this.prisma.deal.findMany({
            where: { orgId, contactId: { in: ids }, discardedAt: null },
            select: {
              id: true,
              contactId: true,
              value: true,
              currency: true,
              createdAt: true,
              stageEnteredAt: true,
              closedAt: true,
              stage: { select: { isWon: true, isQualified: true } },
            },
          }),
        ),
      )
    ).flat();
    const dealIds = deals.map((d) => d.id);

    const qualifiedStages = (await this.prisma.pipelineStage.findMany({ where: { orgId, isQualified: true }, select: { id: true } })).map(
      (s) => s.id,
    );
    const [steps, sent, fallback] = await Promise.all([
      qualifiedStages.length
        ? Promise.all(
            chunks(dealIds).map((ids) =>
              this.prisma.dealEvent.findMany({
                where: { orgId, dealId: { in: ids }, kind: "stage", toStageId: { in: qualifiedStages } },
                select: { dealId: true, createdAt: true },
              }),
            ),
          ).then((r) => r.flat())
        : Promise.resolve([]),
      Promise.all(
        chunks(dealIds).map((ids) =>
          this.prisma.conversionEvent.findMany({ where: { orgId, dealId: { in: ids }, status: "sent" }, select: { dealId: true } }),
        ),
      ).then((r) => r.flat()),
      this.prisma.deal.groupBy({ by: ["currency"], where: { orgId, discardedAt: null }, _count: { _all: true }, orderBy: { _count: { currency: "desc" } }, take: 1 }),
    ]);

    return aggregateAdSales({
      period,
      clicks,
      started,
      deals: deals.map((d) => ({
        id: d.id,
        contactId: d.contactId,
        value: d.value == null ? null : Number(d.value),
        currency: d.currency,
        createdAt: d.createdAt,
        stageEnteredAt: d.stageEnteredAt,
        closedAt: d.closedAt,
        isWon: d.stage.isWon,
        isQualified: d.stage.isQualified,
      })),
      qualifiedSteps: steps.map((s) => ({ dealId: s.dealId, at: s.createdAt })),
      sentDealIds: new Set(sent.map((s) => s.dealId)),
      fallbackCurrency: fallback[0]?.currency ?? "USD",
    });
  }
}
