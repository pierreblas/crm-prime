import { Injectable } from "@nestjs/common";
import { CATALOG_GAP_DAYS, type CatalogGap } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { cleanAttributes, toProductDto } from "./product-catalog.service";

/** Tope de consultas que se leen: de sobra para 30 días de un negocio normal. */
const MAX_CALLS = 3000;
const MAX_GAPS = 50;

type Row = { gaps: unknown; at: Date; conversationId: string };

/**
 * «Lo que preguntan y falta»: los datos que los clientes pidieron a la IA y el
 * producto no tiene («3 preguntaron el Temario de Genómica»). Sale de las
 * consultas al catálogo: al buscar, la IA dice qué dato pide el cliente y, si
 * el producto no lo tiene, se guarda con la llamada (`output.gaps`).
 *
 * Se vuelve a mirar el producto hoy: lo que ya se completó deja de salir.
 */
@Injectable()
export class CatalogGapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async list(): Promise<CatalogGap[]> {
    const orgId = this.tenant.orgId();
    const since = new Date(Date.now() - CATALOG_GAP_DAYS * 24 * 3600_000);
    // Las llamadas y sus ejecuciones no llevan orgId: se acota por la conversación.
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT tc."output"->'gaps' AS gaps, tc."createdAt" AS at, r."conversationId" AS "conversationId"
      FROM ai_tool_calls tc
      JOIN ai_runs r ON r.id = tc."aiRunId"
      JOIN conversations c ON c.id = r."conversationId"
      WHERE c."orgId" = ${orgId}
        AND tc."toolName" = 'search_products'
        AND tc."createdAt" >= ${since}
        AND tc."output"->'gaps' IS NOT NULL
      ORDER BY tc."createdAt" DESC
      LIMIT ${MAX_CALLS}`;

    // Producto + campo → quién lo pidió y cuándo (las filas vienen de la más reciente).
    const byGap = new Map<string, { productId: string; field: string; convs: Set<string>; last: Date; lastConv: string }>();
    for (const r of rows) {
      if (!Array.isArray(r.gaps)) continue;
      for (const g of r.gaps as { productId?: unknown; field?: unknown }[]) {
        if (typeof g?.productId !== "string" || typeof g?.field !== "string") continue;
        const key = `${g.productId}\u0000${g.field}`;
        const cur = byGap.get(key);
        if (cur) cur.convs.add(r.conversationId);
        else byGap.set(key, { productId: g.productId, field: g.field, convs: new Set([r.conversationId]), last: r.at, lastConv: r.conversationId });
      }
    }
    if (!byGap.size) return [];

    const [products, fields] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: [...new Set([...byGap.values()].map((g) => g.productId))] } },
        include: { prices: { orderBy: { currency: "asc" } }, source: { select: { id: true, kind: true, name: true } } },
      }),
      this.prisma.productField.findMany({ where: { aiVisible: true }, select: { key: true, label: true } }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const keyOf = new Map(fields.map((f) => [f.label, f.key]));

    const out: CatalogGap[] = [];
    for (const g of byGap.values()) {
      const p = productById.get(g.productId);
      const fieldKey = keyOf.get(g.field);
      // Borrado, desactivado, campo renombrado u oculto a la IA, o ya completado: no sale.
      if (!p || !p.isActive || !fieldKey) continue;
      if (cleanAttributes(p.attributes)[fieldKey]) continue;
      out.push({
        product: toProductDto(p),
        field: g.field,
        fieldKey,
        conversations: g.convs.size,
        lastAskedAt: g.last.toISOString(),
        lastConversationId: g.lastConv,
      });
    }
    return out
      .sort((a, b) => b.conversations - a.conversations || b.lastAskedAt.localeCompare(a.lastAskedAt))
      .slice(0, MAX_GAPS);
  }
}
