import { Injectable } from "@nestjs/common";
import {
  ONBOARDING_STEP_KEYS,
  effectivePlan,
  type OnboardingDto,
  type OnboardingStep,
  type OnboardingStepKey,
  type TourKey,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { PROMPT_POR_DEFECTO } from "../organizations/default-prompt";
import { AiSettingsService } from "../ai/ai-settings.service";

/**
 * Primeros pasos: qué le falta a la empresa para estar operativa.
 *
 * Cada paso se comprueba contra los datos reales en el momento de pedirlo,
 * así que no hay nada que "sincronizar": cargar un producto marca el paso
 * aunque se haya hecho por CSV o por la API pública. Lo único que se guarda
 * es lo que no se deduce: omitidos, marcados por el sistema y "ocultar".
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async status(userId: string): Promise<OnboardingDto> {
    const orgId = this.tenant.orgId();
    const [org, state, user, detected] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { createdAt: true },
      }),
      this.prisma.onboardingState.findUnique({ where: { orgId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { toursSeen: true } }),
      this.detect(),
    ]);

    const skipped = new Set(state?.skipped ?? []);
    const manual = new Set(state?.done ?? []);
    const steps: OnboardingStep[] = ONBOARDING_STEP_KEYS.map((key) => {
      const d = detected[key];
      const done = d.done || manual.has(key);
      return {
        key,
        status: done ? "done" : skipped.has(key) ? "skipped" : "pending",
        count: d.count,
      };
    });
    const done = steps.filter((s) => s.status !== "pending").length;

    // Al completarse por primera vez se deja constancia (para saber cuánto
    // tardó la empresa en estar lista); se guarda sin bloquear la respuesta.
    let completedAt = state?.completedAt ?? null;
    if (done === steps.length && !completedAt) {
      completedAt = new Date();
      void this.prisma.onboardingState.upsert({
        where: { orgId },
        update: { completedAt },
        create: { orgId, completedAt },
      });
    }

    return {
      steps,
      done,
      total: steps.length,
      completedAt: completedAt?.toISOString() ?? null,
      dismissedAt: state?.dismissedAt?.toISOString() ?? null,
      orgCreatedAt: org.createdAt.toISOString(),
      setupCompletedAt: state?.setupCompletedAt?.toISOString() ?? null,
      toursSeen: user?.toursSeen ?? [],
    };
  }

  /** Comprueba cada paso contra los datos. Todo en paralelo: son conteos. */
  private async detect(): Promise<Record<OnboardingStepKey, { done: boolean; count: number | null }>> {
    const [whatsapp, aiSetting, agents, products, knowledge, conversations, users] = await Promise.all([
      this.prisma.whatsappConnection.count({ where: { isActive: true } }),
      this.prisma.aiSetting.findFirst({ select: { openaiKeyEnc: true, anthropicKeyEnc: true } }),
      this.prisma.agentConfig.findMany({
        select: { systemPrompt: true, isDefault: true, welcomeEnabled: true, name: true },
      }),
      this.prisma.product.count(),
      this.prisma.knowledgeDoc.count(),
      this.prisma.conversation.count(),
      this.prisma.user.count({ where: { isActive: true } }),
    ]);

    // El agente nace con un prompt genérico: cuenta como personalizado si lo
    // cambiaron, si activaron el saludo o si crearon otro bot.
    const agentCustomized = agents.some(
      (a) => !a.isDefault || a.systemPrompt.trim() !== PROMPT_POR_DEFECTO || a.welcomeEnabled,
    );

    // Con key propia, con las de la plataforma prestadas, o con la IA
    // incluida en su plan, la IA responde sin que la empresa haga nada.
    const aiReady =
      !!aiSetting?.openaiKeyEnc ||
      !!aiSetting?.anthropicKeyEnc ||
      AiSettingsService.platformKeysShared() ||
      (AiSettingsService.includedEnabled() && (await this.planHasIncludedAi()));

    return {
      whatsapp: { done: whatsapp > 0, count: whatsapp },
      ai: { done: aiReady, count: null },
      agent: { done: agentCustomized, count: null },
      products: { done: products > 0, count: products },
      knowledge: { done: knowledge > 0, count: knowledge },
      try_agent: { done: false, count: null }, // lo marca el simulador (markDone)
      first_chat: { done: conversations > 0, count: conversations },
      team: { done: users > 1, count: users },
    };
  }

  private async planHasIncludedAi(): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: this.tenant.orgId() },
      select: { plan: true, trialEndsAt: true },
    });
    return (effectivePlan(org?.plan, org?.trialEndsAt).aiConversations ?? 0) > 0;
  }

  async skip(key: OnboardingStepKey, skipped: boolean): Promise<void> {
    const orgId = this.tenant.orgId();
    const state = await this.prisma.onboardingState.findUnique({ where: { orgId } });
    const list = new Set(state?.skipped ?? []);
    if (skipped) list.add(key);
    else list.delete(key);
    await this.prisma.onboardingState.upsert({
      where: { orgId },
      update: { skipped: [...list] },
      create: { orgId, skipped: [...list] },
    });
  }

  /**
   * Marca un paso que no se deduce de los datos. Lo llaman otros módulos
   * (el simulador del agente); es idempotente y nunca falla hacia fuera.
   */
  async markDone(key: OnboardingStepKey): Promise<void> {
    try {
      const orgId = this.tenant.orgId();
      const state = await this.prisma.onboardingState.findUnique({ where: { orgId } });
      if (state?.done.includes(key)) return;
      await this.prisma.onboardingState.upsert({
        where: { orgId },
        update: { done: [...(state?.done ?? []), key] },
        create: { orgId, done: [key] },
      });
    } catch {
      // Un fallo aquí no puede romper la acción que lo disparó.
    }
  }

  async dismiss(dismissed: boolean): Promise<void> {
    const orgId = this.tenant.orgId();
    const dismissedAt = dismissed ? new Date() : null;
    await this.prisma.onboardingState.upsert({
      where: { orgId },
      update: { dismissedAt },
      create: { orgId, dismissedAt },
    });
  }

  async tourSeen(userId: string, key: TourKey): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { toursSeen: true } });
    if (!user || user.toursSeen.includes(key)) return;
    await this.prisma.user.update({
      where: { id: userId },
      data: { toursSeen: [...user.toursSeen, key] },
    });
  }
}
