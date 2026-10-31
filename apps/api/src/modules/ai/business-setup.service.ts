import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_FOLLOW_UPS,
  DEFAULT_HANDOFF_MESSAGE,
  businessSetupSchema,
  createBotSchema,
  welcomeMessageFor,
  type BusinessSetupInput,
  type BusinessSetupState,
  type EscalationRules,
  type SetupAgentResult,
  type SetupKnowledgeResult,
  type SetupProfileResult,
  type UpdateBotInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { DEFAULT_STAGES } from "../pipeline/pipeline.service";
import { AgentActionsService } from "./agent-actions.service";
import { AiSettingsService } from "./ai-settings.service";
import { BotService } from "./bot.service";
import { PromptAssistantService } from "./prompt-assistant.service";
import { availableTools } from "./tools.registry";
import {
  SETUP_HANDOFF_KEYWORDS,
  SETUP_KNOWLEDGE_SOURCE,
  businessHoursFor,
  composeBrief,
  isValidTimeZone,
  knowledgeDoc,
  localAgentPrompt,
  normalizeWebsite,
  quickRepliesFor,
  stagePlan,
  toolsForGoal,
} from "./business-setup.rules";

/** Páginas de su web que se leen al construir: suficiente para aprender sin hacer esperar. */
const WEBSITE_PAGES = 6;

/**
 * Asistente de bienvenida: con lo que la empresa contó al darse de alta, arma
 * su IA de WhatsApp. En tres fases, para que la pantalla de carga enseñe lo
 * que de verdad ya está hecho y un fallo se pueda reintentar desde donde se
 * quedó:
 *
 *   1 · perfil        guarda lo que contó, adapta el embudo y crea respuestas rápidas
 *   2 · conocimiento  lo convierte en un documento y lee su web
 *   3 · agente        redacta las instrucciones y configura el agente principal
 *
 * Cada fase se puede repetir: sustituye lo que escribió la vez anterior en
 * vez de duplicarlo.
 */
@Injectable()
export class BusinessSetupService {
  private readonly logger = new Logger("BusinessSetup");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly bots: BotService,
    private readonly assistant: PromptAssistantService,
    private readonly knowledge: KnowledgeService,
    private readonly actions: AgentActionsService,
    private readonly aiSettings: AiSettingsService,
  ) {}

  async state(): Promise<BusinessSetupState> {
    const orgId = this.tenant.orgId();
    const [org, row, ai] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
      this.prisma.onboardingState.findUnique({
        where: { orgId },
        select: { business: true, setupCompletedAt: true },
      }),
      this.aiSettings.status(),
    ]);
    // Lo guardado pasa otra vez por el esquema: si cambió desde entonces, se
    // empieza de cero en vez de rellenar el formulario con algo que no vale.
    const saved = businessSetupSchema.safeParse(row?.business ?? null);
    return {
      profile: saved.success ? saved.data : null,
      completedAt: row?.setupCompletedAt?.toISOString() ?? null,
      orgName: org.name,
      aiReady: ai.ready,
    };
  }

  // ── 1 · Perfil, embudo y respuestas rápidas ──────────────────
  async saveProfile(input: BusinessSetupInput): Promise<SetupProfileResult> {
    const orgId = this.tenant.orgId();
    const profile: BusinessSetupInput = {
      ...input,
      timezone: isValidTimeZone(input.timezone) ? input.timezone : "America/Lima",
    };
    await this.prisma.onboardingState.upsert({
      where: { orgId },
      update: { business: profile as unknown as Prisma.InputJsonObject },
      create: { orgId, business: profile as unknown as Prisma.InputJsonObject },
    });
    const orgName = await this.orgName();

    // Embudo principal con las etapas del rubro, si nadie las cambió todavía.
    let stages: string[] | null = null;
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { isDefault: true },
      select: { stages: { select: { id: true, name: true }, orderBy: { order: "asc" } } },
    });
    if (pipeline) {
      const plan = stagePlan(
        pipeline.stages.map((s) => s.name),
        profile.businessType,
        DEFAULT_STAGES.map((s) => s.name),
      );
      if (plan) {
        await this.prisma.$transaction(
          pipeline.stages.map((s, i) =>
            this.prisma.pipelineStage.update({ where: { id: s.id }, data: { name: plan[i]! } }),
          ),
        );
        stages = plan;
      }
    }

    // Respuestas rápidas: solo las que faltan; las que ya existen son de la
    // empresa (pudo editarlas) y no se pisan.
    const taken = new Set(
      (await this.prisma.quickReply.findMany({ select: { shortcut: true } })).map((q) => q.shortcut),
    );
    const fresh = quickRepliesFor(profile, orgName).filter((q) => !taken.has(q.shortcut));
    if (fresh.length) {
      await this.prisma.quickReply.createMany({
        data: fresh.map((q) => ({ orgId, shortcut: q.shortcut, title: q.title, body: q.body })),
        skipDuplicates: true,
      });
    }

    this.logger.log(`Perfil de ${orgName}: ${profile.businessType}, ${fresh.length} respuestas rápidas`);
    return { stages, quickReplies: fresh.length };
  }

  // ── 2 · Conocimiento ─────────────────────────────────────────
  async buildKnowledge(): Promise<SetupKnowledgeResult> {
    const profile = await this.profile();
    const orgName = await this.orgName();

    const old = await this.prisma.knowledgeDoc.findMany({
      where: { source: SETUP_KNOWLEDGE_SOURCE },
      select: { id: true },
    });
    if (old.length) await this.prisma.knowledgeDoc.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

    const doc = knowledgeDoc(profile, orgName);
    if (doc) {
      await this.knowledge.ingest({ title: doc.title, content: doc.content, source: SETUP_KNOWLEDGE_SOURCE });
    }

    // Su web: lo que no consiga leerse no frena nada, se cuenta y se sigue.
    let website: SetupKnowledgeResult["website"] = null;
    if (profile.website) {
      try {
        const r = await this.knowledge.importUrl(
          { url: normalizeWebsite(profile.website), crawl: true },
          WEBSITE_PAGES,
        );
        website = {
          ok: r.imported.length > 0,
          pages: r.imported.length,
          error: r.imported.length ? null : (r.skipped[0]?.reason ?? "No encontramos texto en la página"),
        };
      } catch (e) {
        website = { ok: false, pages: 0, error: (e as Error).message.slice(0, 200) };
      }
    }
    return { facts: doc?.facts ?? 0, website };
  }

  // ── 3 · Agente ───────────────────────────────────────────────
  async buildAgent(): Promise<SetupAgentResult> {
    const orgId = this.tenant.orgId();
    const profile = await this.profile();
    const orgName = await this.orgName();
    const tools = toolsForGoal(profile.goal, availableTools(await this.actions.loadContext()));

    // Con IA, las redacta el modelo con todo el contexto real (catálogo,
    // conocimiento recién creado, embudo). Sin IA, o si la respuesta no
    // sirve, la plantilla: el agente queda bien configurado igualmente.
    let prompt: string | null = null;
    const ai = await this.aiSettings.status();
    if (ai.ready) {
      try {
        const reply = await this.assistant.run({
          prompt: composeBrief(profile, orgName),
          target: "systemPrompt",
          current: "",
          botName: profile.agentName,
          enabledTools: tools,
          history: [],
        });
        if (reply.provider !== "fake" && reply.proposal && reply.proposal.length >= 200) prompt = reply.proposal;
      } catch (e) {
        this.logger.warn(`No se pudieron redactar las instrucciones con IA: ${(e as Error).message}`);
      }
    }
    const writtenBy = prompt ? "ai" : "template";
    prompt ??= localAgentPrompt(profile, orgName, tools);

    const bot =
      (await this.prisma.agentConfig.findFirst({ where: { isDefault: true } })) ??
      (await this.prisma.agentConfig.findFirst({ orderBy: { createdAt: "asc" } }));
    const rules = (bot?.escalationRules as EscalationRules | null) ?? {};
    const config: UpdateBotInput = {
      name: profile.agentName,
      systemPrompt: prompt,
      enabledTools: tools,
      isActive: true,
      autopilotByDefault: profile.autopilot,
      splitReplies: true,
      welcomeEnabled: profile.welcome,
      welcomeMessage: welcomeMessageFor(profile.tone, profile.agentName, orgName),
      businessHoursEnabled: !!profile.hours,
      ...(profile.hours ? { businessHours: businessHoursFor(profile.hours, profile.timezone, orgName) } : {}),
      escalationRules: {
        ...rules,
        minConfidence: rules.minConfidence ?? 0.75,
        escalateOnNegativeSentiment: true,
        keywords: [...new Set([...(rules.keywords ?? []), ...SETUP_HANDOFF_KEYWORDS])],
        handoffMessage: rules.handoffMessage ?? DEFAULT_HANDOFF_MESSAGE,
      },
    };
    const saved = bot
      ? await this.bots.update(bot.id, config)
      : await this.bots.create(
          createBotSchema.parse({ ...config, followUps: DEFAULT_FOLLOW_UPS }),
        );

    await this.prisma.onboardingState.update({ where: { orgId }, data: { setupCompletedAt: new Date() } });
    this.logger.log(`IA de ${orgName} construida (${writtenBy}, ${tools.length} herramientas)`);
    return {
      botId: saved.id,
      botName: saved.name,
      writtenBy,
      autopilot: saved.autopilotByDefault,
      welcome: saved.welcomeEnabled,
      hours: saved.businessHoursEnabled,
      tools: tools.length,
    };
  }

  private async profile(): Promise<BusinessSetupInput> {
    const row = await this.prisma.onboardingState.findUnique({
      where: { orgId: this.tenant.orgId() },
      select: { business: true },
    });
    const parsed = businessSetupSchema.safeParse(row?.business ?? null);
    if (!parsed.success) throw new BadRequestException("Primero cuéntanos de tu negocio");
    return parsed.data;
  }

  private async orgName(): Promise<string> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: this.tenant.orgId() },
      select: { name: true },
    });
    return org.name;
  }
}
