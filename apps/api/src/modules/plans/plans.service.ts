import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  AI_INCLUDED_COUNTED,
  FEATURE_LABELS,
  PLAN_KEYS,
  PLANS,
  SELF_HOSTED_PLAN,
  planFor,
  planWithFeature,
  type MyPlanDto,
  type PlanDef,
  type PlanFeature,
  type PlanLimit,
} from "@crm/shared";
import { env } from "../../common/utils/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { tenancyMode } from "../../infra/tenant/tenant.context";

/**
 * El plan de la empresa en curso y lo que permite.
 *
 * Los límites se comprueban al AÑADIR (otro número, otro usuario), nunca sobre
 * lo que ya existe: bajar de plan no desconecta nada ni echa a nadie. Las
 * características (coexistencia, difusiones, API) se comprueban al usarlas.
 *
 * Contactos y oportunidades son límites blandos: quien escribe por WhatsApp
 * entra siempre (sería absurdo no atender a un cliente nuevo); lo que se frena
 * al llegar al tope es crear o importar a mano y la API pública.
 *
 * En instalación propia no hay planes: todo pasa.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  get saas(): boolean {
    return tenancyMode === "multi";
  }

  async current(): Promise<PlanDef> {
    if (!this.saas) return SELF_HOSTED_PLAN;
    const org = await this.prisma.organization.findUnique({
      where: { id: this.tenant.orgId() },
      select: { plan: true },
    });
    return planFor(org?.plan);
  }

  async usage(): Promise<{
    numbers: number;
    users: number;
    contacts: number;
    deals: number;
    activeContacts: number;
    aiConversations: number;
  }> {
    const orgId = this.tenant.orgId();
    const [numbers, users, contacts, deals, active, ai] = await Promise.all([
      this.prisma.whatsappConnection.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.contact.count(),
      // Abiertas: ni ganadas, ni perdidas, ni descartadas.
      this.prisma.deal.count({ where: { discardedAt: null, stage: { isWon: false, isLost: false } } }),
      // Activos este mes: con algún mensaje enviado o recibido, difusiones aparte.
      this.prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT count(DISTINCT c."contactId") AS count
        FROM messages m JOIN conversations c ON c.id = m."conversationId"
        WHERE m."orgId" = ${orgId} AND m."campaignId" IS NULL AND m."createdAt" >= date_trunc('month', now())
      `,
      // Conversaciones atendidas este mes con la IA de Driony (el cupo del plan).
      this.prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT count(DISTINCT "conversationId") AS count FROM ai_usage
        WHERE "orgId" = ${orgId} AND source = 'platform' AND "conversationId" IS NOT NULL
          AND feature = ANY(${[...AI_INCLUDED_COUNTED]}::text[])
          AND "createdAt" >= date_trunc('month', now() AT TIME ZONE 'UTC')
      `,
    ]);
    return {
      numbers,
      users,
      contacts,
      deals,
      activeContacts: Number(active[0]?.count ?? 0),
      aiConversations: Number(ai[0]?.count ?? 0),
    };
  }

  async mine(): Promise<MyPlanDto> {
    const [plan, usage] = await Promise.all([this.current(), this.usage()]);
    return {
      saas: this.saas,
      plan,
      usage,
      plans: this.saas ? PLAN_KEYS.map((k) => PLANS[k]) : [],
      contactEmail: env("NEXT_PUBLIC_CONTACT_EMAIL") ?? env("CONTACT_EMAIL") ?? null,
    };
  }

  /** La característica está en el plan, o 403 con qué plan la incluye. */
  async assertFeature(feature: PlanFeature): Promise<void> {
    const plan = await this.current();
    if (plan.features[feature]) return;
    const needed = planWithFeature(feature);
    throw new ForbiddenException(
      `${FEATURE_LABELS[feature]} no está en tu plan ${plan.name}` +
        (needed ? `: está disponible a partir del plan ${needed.name}` : "") +
        ". Puedes cambiarlo desde Ajustes › Plan.",
    );
  }

  /** Cabe uno más, o 403 con el límite del plan. */
  async assertCanAdd(kind: PlanLimit): Promise<void> {
    const plan = await this.current();
    const limit = plan.limits[kind];
    if (limit === null) return;
    const used = (await this.usage())[kind];
    if (used < limit) return;
    const n = limit.toLocaleString("es");
    const msg: Record<PlanLimit, string> = {
      numbers: `Tu plan ${plan.name} admite ${limit} ${limit === 1 ? "número de WhatsApp" : "números de WhatsApp"}. Para añadir más, cambia de plan desde Ajustes › Plan.`,
      users: `Tu plan ${plan.name} admite ${limit} ${limit === 1 ? "usuario" : "usuarios"}. Para añadir más, cambia de plan desde Ajustes › Plan.`,
      contacts: `Tu plan ${plan.name} admite ${n} contactos. Los que te escriben por WhatsApp entran igual; para crear o importar más a mano, cambia de plan desde Ajustes › Plan.`,
      deals: `Tu plan ${plan.name} admite ${n} oportunidades abiertas. Las que entran por WhatsApp se crean igual; para añadir más a mano, cierra o descarta algunas, o cambia de plan desde Ajustes › Plan.`,
      // Orientativo: nunca se llama con este tipo, pero el mapa tiene que estar completo.
      activeContacts: `Tu plan ${plan.name} está pensado para ${n} contactos activos al mes.`,
    };
    throw new ForbiddenException(msg[kind]);
  }
}
