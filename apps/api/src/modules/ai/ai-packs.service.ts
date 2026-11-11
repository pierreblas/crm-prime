import { Injectable } from "@nestjs/common";
import type { AiPackDto } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { monthStart } from "./ai-usage.service";

/** Saldo de tokens extra de una empresa. */
export interface AiExtra {
  /** Tokens que quedan en paquetes vigentes. */
  remaining: number;
  /** Tokens de paquetes gastados este mes (suben el tope en dólares del mes). */
  usedThisMonth: number;
  /** Cuándo vence el paquete que se está gastando, o null si no queda nada. */
  nextExpiresAt: Date | null;
}

/**
 * Tokens de IA extra (paquetes).
 *
 * El consumo del mes se lee de ai_usage; lo que excede el cupo del plan se
 * carga a los paquetes con `settle`, que apunta en ai_pack_uses cuántos
 * tokens de cada paquete se gastaron este mes (una fila por paquete y mes).
 * Se llama cada vez que se calcula el cupo, así que el saldo se pone al día
 * solo y volver a llamarlo con la misma cifra no gasta dos veces. El que
 * vence antes se gasta primero.
 *
 * Las consultas filtran por orgId además de ir con RLS: el gasto se decide en
 * el trabajo del agente, y esa es la empresa del contexto.
 */
@Injectable()
export class AiPacksService {
  constructor(private readonly prisma: PrismaService) {}

  async extra(orgId: string): Promise<AiExtra> {
    const now = new Date();
    const [packs, used] = await Promise.all([
      this.prisma.aiPack.findMany({
        where: { orgId, expiresAt: { gt: now } },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
        select: { tokens: true, used: true, expiresAt: true },
      }),
      this.prisma.aiPackUse.aggregate({ where: { orgId, month: monthStart() }, _sum: { tokens: true } }),
    ]);
    const left = packs.filter((p) => p.used < p.tokens);
    return {
      remaining: left.reduce((n, p) => n + (p.tokens - p.used), 0),
      usedThisMonth: used._sum.tokens ?? 0,
      nextExpiresAt: left[0]?.expiresAt ?? null,
    };
  }

  /** Los paquetes vigentes, para Ajustes › Plan. */
  async active(orgId: string): Promise<AiPackDto[]> {
    const rows = await this.prisma.aiPack.findMany({
      where: { orgId, expiresAt: { gt: new Date() } },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, tokens: true, used: true, expiresAt: true, createdAt: true },
    });
    return rows.map((p) => ({
      id: p.id,
      tokens: p.tokens,
      used: p.used,
      expiresAt: p.expiresAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    }));
  }

  /**
   * Pone al día lo cargado a los paquetes este mes: `excess` son los tokens
   * gastados por encima del cupo del plan. Si este mes ya se habían apuntado
   * menos, la diferencia se resta de los paquetes vigentes, el que vence antes
   * primero, hasta donde alcance. Devuelve lo apuntado este mes tras el ajuste.
   *
   * Todo en una transacción con un cerrojo por empresa: dos cálculos a la vez
   * (el autopilot responde en paralelo) no cargan lo mismo dos veces.
   */
  async settle(orgId: string, excess: number): Promise<number> {
    const month = monthStart();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-packs:${orgId}`}))`;
      const charged = (await tx.aiPackUse.aggregate({ where: { orgId, month }, _sum: { tokens: true } }))._sum.tokens ?? 0;
      let pending = Math.max(0, Math.floor(excess)) - charged;
      if (pending <= 0) return charged;
      const packs = await tx.$queryRaw<Array<{ id: string; tokens: number; used: number }>>`
        SELECT id, tokens, used FROM ai_packs
        WHERE "orgId" = ${orgId} AND "expiresAt" > now() AND used < tokens
        ORDER BY "expiresAt", "createdAt"
        FOR UPDATE
      `;
      let added = 0;
      for (const p of packs) {
        if (pending <= 0) break;
        const take = Math.min(pending, p.tokens - p.used);
        await tx.aiPack.update({ where: { id: p.id }, data: { used: { increment: take } } });
        await tx.aiPackUse.upsert({
          where: { orgId_packId_month: { orgId, packId: p.id, month } },
          create: { orgId, packId: p.id, month, tokens: take },
          update: { tokens: { increment: take } },
        });
        pending -= take;
        added += take;
      }
      return charged + added;
    });
  }
}
