import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AiPackDto } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { monthStart } from "./ai-usage.service";

/** Saldo de conversaciones extra de una empresa. */
export interface AiExtra {
  /** Lo que queda en paquetes vigentes. */
  remaining: number;
  /** Las gastadas este mes (suben el tope en dólares del mes). */
  usedThisMonth: number;
  /** Cuándo vence el paquete que se está gastando, o null si no queda nada. */
  nextExpiresAt: Date | null;
}

/**
 * Conversaciones con IA extra (paquetes).
 *
 * Se gastan solo cuando el cupo del mes del plan está lleno, y cada
 * conversación gasta una sola vez al mes (ai_pack_uses, único por
 * conversación y mes): si el agente le contesta diez veces o se reintenta un
 * trabajo, sigue siendo una. El que vence antes se gasta primero.
 *
 * Las consultas filtran por orgId además de ir con RLS: el gasto se decide en
 * el trabajo del agente, y esa es la empresa del contexto.
 */
@Injectable()
export class AiPacksService {
  constructor(private readonly prisma: PrismaService) {}

  async extra(orgId: string): Promise<AiExtra> {
    const now = new Date();
    const [packs, usedThisMonth] = await Promise.all([
      this.prisma.aiPack.findMany({
        where: { orgId, expiresAt: { gt: now } },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
        select: { conversations: true, used: true, expiresAt: true },
      }),
      this.prisma.aiPackUse.count({ where: { orgId, month: monthStart() } }),
    ]);
    const left = packs.filter((p) => p.used < p.conversations);
    return {
      remaining: left.reduce((n, p) => n + (p.conversations - p.used), 0),
      usedThisMonth,
      nextExpiresAt: left[0]?.expiresAt ?? null,
    };
  }

  /** Los paquetes vigentes, para Ajustes › Plan. */
  async active(orgId: string): Promise<AiPackDto[]> {
    const rows = await this.prisma.aiPack.findMany({
      where: { orgId, expiresAt: { gt: new Date() } },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, conversations: true, used: true, expiresAt: true, createdAt: true },
    });
    return rows.map((p) => ({
      id: p.id,
      conversations: p.conversations,
      used: p.used,
      expiresAt: p.expiresAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    }));
  }

  /**
   * Gasta una conversación extra para esta conversación este mes. true si ya
   * la tenía o si quedaba saldo; false si no queda nada.
   */
  async consume(orgId: string, conversationId: string): Promise<boolean> {
    const month = monthStart();
    const done = await this.prisma.aiPackUse.findFirst({
      where: { orgId, conversationId, month },
      select: { id: true },
    });
    if (done) return true;

    // Restar y elegir el paquete en una sola sentencia: dos mensajes a la vez
    // no pueden gastar la misma última conversación de un paquete.
    const [hit] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE ai_packs SET used = used + 1
      WHERE id = (
        SELECT id FROM ai_packs
        WHERE "orgId" = ${orgId} AND "expiresAt" > now() AND used < conversations
        ORDER BY "expiresAt", "createdAt"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
    if (!hit) return false;

    try {
      await this.prisma.aiPackUse.create({ data: { orgId, packId: hit.id, conversationId, month } });
    } catch (e) {
      // Otra petición apuntó la misma conversación a la vez: ya está pagada,
      // así que se devuelve la que acabamos de restar.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        await this.prisma.$executeRaw`UPDATE ai_packs SET used = used - 1 WHERE id = ${hit.id} AND used > 0`;
        return true;
      }
      throw e;
    }
    return true;
  }
}
