import { Injectable, Logger } from "@nestjs/common";
import {
  ACTION_LABELS,
  META_FORM_SOURCE_NAME,
  SCOPE_LABELS,
  SECTION_LABELS,
  effectivePermissions,
  parseMetaFormRules,
  type PermissionAction,
  type PermissionSection,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { AiSettingsService } from "./ai-settings.service";
import { docsDir, loadDocs, type CopilotDoc } from "./admin-copilot.docs";
import type { LlmTool } from "./llm.types";

const DAY = 86_400_000;
/** Lo que se le devuelve al modelo por herramienta: suficiente para diagnosticar sin llenar el contexto. */
const MAX_OUTPUT = 14_000;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** El estado de un número en una frase: lo que de verdad le pasa, sin campos sueltos que interpretar. */
const waSituation = (c: { status: string; statusReason: string | null; isActive: boolean }) =>
  !c.isActive
    ? "apagado en Driony: no recibe ni envía mensajes"
    : c.status === "connected"
      ? "conectado"
      : c.status === "error"
        ? `con error: ${c.statusReason ?? "sin detalle"}`
        : `desconectado${c.statusReason ? `: ${c.statusReason}` : ""}`;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "(URL no válida)";
  }
};

/**
 * Herramientas del copiloto del administrador. TODAS leen y ninguna escribe:
 * el copiloto explica y diagnostica, los cambios los hace la persona.
 *
 * Nunca devuelven claves, tokens ni secretos: de las integraciones solo se
 * dice si están configuradas. Las consultas van por el cliente de Prisma con
 * el filtro de empresa; los leads de Meta (sin orgId propio) se piden siempre
 * por los ids de las páginas de esta empresa.
 */
@Injectable()
export class AdminCopilotTools {
  private readonly logger = new Logger("AdminCopilot");
  private docsCache: CopilotDoc[] | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly tenant: TenantService,
  ) {}

  docs(): CopilotDoc[] {
    if (!this.docsCache) {
      this.docsCache = loadDocs(docsDir());
      if (!this.docsCache.length) {
        this.logger.warn(`No hay documentación en ${docsDir()}: el copiloto responderá sin ella.`);
      }
    }
    return this.docsCache;
  }

  definitions(): LlmTool[] {
    const slugs = this.docs().map((d) => d.slug);
    const none = { type: "object", properties: {}, additionalProperties: false };
    return [
      ...(slugs.length
        ? [
            {
              name: "read_doc",
              description:
                "Lee un documento de la documentación de Driony (cómo se usa cada parte y dónde está cada ajuste). Úsalo antes de explicar cómo hacer algo.",
              input_schema: {
                type: "object",
                properties: { slug: { type: "string", enum: slugs } },
                required: ["slug"],
                additionalProperties: false,
              },
            },
          ]
        : []),
      {
        name: "account_overview",
        description:
          "Resumen de la cuenta: plan, equipo, números de WhatsApp y su estado, plantillas, IA, embudos, páginas de Facebook, flujos, integraciones y conversaciones abiertas.",
        input_schema: none,
      },
      {
        name: "ai_agents",
        description:
          "Agentes de IA: cuáles hay, si están activos, número y embudos, horario, modelo, si la clave de IA está lista y su cupo, y los últimos pases a humano y errores de la IA.",
        input_schema: none,
      },
      {
        name: "team",
        description:
          "Equipo: cada persona con su rol, si está activa, qué chats ve, sus secciones, sus fuentes y cuántos chats abiertos tiene asignados. Y las fuentes con sus vendedores.",
        input_schema: none,
      },
      {
        name: "pipelines",
        description:
          "Embudos con sus etapas: oportunidades abiertas por etapa, automatizaciones, eventos de conversión de Meta y la entrada automática desde WhatsApp.",
        input_schema: none,
      },
      {
        name: "meta_leads",
        description:
          "Formularios de Facebook (Lead Ads): páginas conectadas, su fuente, etiquetas, etapa, plantilla de bienvenida, reglas por formulario y los últimos leads con su estado o error.",
        input_schema: none,
      },
      {
        name: "find_contacts",
        description:
          "Busca contactos por teléfono (6 o más dígitos) o por nombre y devuelve su fuente, etiquetas, conversaciones (asignada a, IA, mensajes fallidos), oportunidades y leads de Meta. También leads de formularios que no llegaron a ser contacto.",
        input_schema: {
          type: "object",
          properties: { query: { type: "string", description: "Teléfono o nombre" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "recent_problems",
        description:
          "Problemas de los últimos días: mensajes de WhatsApp que fallaron (con el motivo), números desconectados, plantillas rechazadas, leads sin teléfono o con error, conversiones de Meta fallidas, webhooks con errores y la IA sin clave o sin cupo.",
        input_schema: {
          type: "object",
          properties: { days: { type: "integer", minimum: 1, maximum: 30, description: "Por defecto 7" } },
          additionalProperties: false,
        },
      },
    ];
  }

  /** Cómo se le enseña al administrador lo que se consultó. */
  label(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case "read_doc": {
        const doc = this.docs().find((d) => d.slug === input.slug);
        return `Documentación: ${doc?.title ?? String(input.slug)}`;
      }
      case "account_overview":
        return "Resumen de la cuenta";
      case "ai_agents":
        return "Agentes de IA";
      case "team":
        return "Equipo y fuentes";
      case "pipelines":
        return "Embudos y etapas";
      case "meta_leads":
        return "Formularios de Facebook";
      case "find_contacts":
        return `Contactos: «${String(input.query ?? "").slice(0, 40)}»`;
      case "recent_problems":
        return "Problemas recientes";
      default:
        return name;
    }
  }

  async run(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      const out = await this.dispatch(name, input);
      const text = typeof out === "string" ? out : JSON.stringify(out);
      return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}… (recortado)` : text;
    } catch (e) {
      this.logger.warn(`Herramienta ${name} falló: ${(e as Error).message}`);
      return `Error al consultar: ${(e as Error).message}`;
    }
  }

  private dispatch(name: string, input: Record<string, unknown>): Promise<unknown> | unknown {
    switch (name) {
      case "read_doc":
        return this.readDoc(String(input.slug ?? ""));
      case "account_overview":
        return this.accountOverview();
      case "ai_agents":
        return this.aiAgents();
      case "team":
        return this.team();
      case "pipelines":
        return this.pipelines();
      case "meta_leads":
        return this.metaLeads();
      case "find_contacts":
        return this.findContacts(String(input.query ?? ""));
      case "recent_problems":
        return this.recentProblems(Number(input.days) || 7);
      default:
        return `La herramienta ${name} no existe.`;
    }
  }

  // ── Documentación ───────────────────────────────────────────
  readDoc(slug: string): string {
    const doc = this.docs().find((d) => d.slug === slug);
    if (!doc) return `No hay ningún documento «${slug}». Disponibles: ${this.docs().map((d) => d.slug).join(", ")}.`;
    return doc.markdown;
  }

  // ── Resumen de la cuenta ────────────────────────────────────
  private async accountOverview() {
    const orgId = this.tenant.orgId();
    const since7 = new Date(Date.now() - 7 * DAY);
    const [org, users, conns, templates, ai, activeAgents, pipelines, sources, pages, flows, automations, webhooks, integ, convs, unassigned, waiting, newContacts, knowledge] =
      await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true, plan: true, trialEndsAt: true, planExpiresAt: true },
        }),
        this.prisma.user.groupBy({ by: ["role", "isActive"], _count: { _all: true } }),
        this.prisma.whatsappConnection.findMany({
          select: {
            label: true,
            displayPhoneNumber: true,
            mode: true,
            status: true,
            statusReason: true,
            isActive: true,
            lastWebhookAt: true,
            capiEnabled: true,
            pipeline: { select: { name: true } },
            bot: { select: { name: true, isActive: true } },
          },
        }),
        this.prisma.template.groupBy({ by: ["status"], _count: { _all: true } }),
        this.settings.status(),
        this.prisma.agentConfig.count({ where: { isActive: true } }),
        this.prisma.pipeline.findMany({
          orderBy: { order: "asc" },
          select: { name: true, isDefault: true, inboundEnabled: true, _count: { select: { stages: true } } },
        }),
        this.prisma.source.count(),
        this.prisma.metaPage.findMany({ select: { name: true, isActive: true, subscribedAt: true } }),
        this.prisma.flow.groupBy({ by: ["isActive"], _count: { _all: true } }),
        this.prisma.stageAutomation.count({ where: { enabled: true } }),
        this.prisma.webhookSubscription.count({ where: { isActive: true } }),
        this.prisma.integrationSetting.findFirst({
          select: { twilioAccountSid: true, twilioNumber: true, voyageKeyEnc: true, whatsappAppId: true },
        }),
        this.prisma.conversation.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.conversation.count({ where: { status: "OPEN", assignedAgentId: null } }),
        this.prisma.conversation.count({ where: { status: "OPEN", awaitingReply: true } }),
        this.prisma.contact.count({ where: { createdAt: { gte: since7 } } }),
        this.prisma.knowledgeDoc.count(),
      ]);

    const usersBy = (role: string, active = true) =>
      users.filter((u) => u.role === role && u.isActive === active).reduce((n, u) => n + u._count._all, 0);
    const convBy = (s: string) => convs.find((c) => c.status === s)?._count._all ?? 0;

    return {
      empresa: {
        nombre: org?.name,
        plan: org?.plan,
        pruebaHasta: iso(org?.trialEndsAt),
        planPagadoHasta: iso(org?.planExpiresAt),
      },
      equipo: {
        administradores: usersBy("ADMIN"),
        vendedores: usersBy("AGENT"),
        inactivos: usersBy("ADMIN", false) + usersBy("AGENT", false),
      },
      whatsapp: conns.map((c) => ({
        numero: c.displayPhoneNumber ?? "(sin número)",
        nombre: c.label,
        modo: c.mode,
        situacion: waSituation(c),
        ultimoAvisoDeMeta: iso(c.lastWebhookAt),
        embudo: c.pipeline?.name ?? null,
        agenteIA: c.bot ? `${c.bot.name}${c.bot.isActive ? "" : " (apagado)"}` : null,
        conversionesDeMeta: c.capiEnabled,
      })),
      plantillasPorEstado: Object.fromEntries(templates.map((t) => [t.status, t._count._all])),
      ia: {
        lista: ai.ready,
        proveedor: ai.provider,
        modelo: ai.model,
        clave: ai.source,
        cupoDeDriony: ai.included
          ? {
              conversaciones: ai.included.conversations,
              limite: ai.included.limit,
              extraRestante: ai.included.extraRemaining,
              agotado: ai.included.full || ai.included.exhausted,
              seRenueva: ai.included.resetsAt,
            }
          : null,
        agentesActivos: activeAgents,
      },
      embudos: pipelines.map((p) => ({
        nombre: p.name,
        predeterminado: p.isDefault,
        entradaDesdeWhatsApp: p.inboundEnabled,
        etapas: p._count.stages,
      })),
      fuentes: sources,
      paginasDeFacebook: pages.map((p) => ({ nombre: p.name, activa: p.isActive, recibeLeads: !!p.subscribedAt })),
      flujos: {
        activos: flows.find((f) => f.isActive)?._count._all ?? 0,
        apagados: flows.find((f) => !f.isActive)?._count._all ?? 0,
      },
      automatizacionesDeEtapa: automations,
      webhooksSalientesActivos: webhooks,
      integraciones: {
        llamadasTwilio: !!(integ?.twilioAccountSid && integ?.twilioNumber),
        embeddingsVoyage: !!integ?.voyageKeyEnc,
        appPropiaDeMeta: !!integ?.whatsappAppId,
      },
      conversaciones: {
        abiertas: convBy("OPEN"),
        pendientes: convBy("PENDING"),
        cerradas: convBy("CLOSED"),
        abiertasSinAsignar: unassigned,
        esperandoRespuesta: waiting,
      },
      contactosNuevosUltimos7Dias: newContacts,
      documentosDeConocimiento: knowledge,
    };
  }

  // ── Agentes de IA ───────────────────────────────────────────
  private async aiAgents() {
    const orgId = this.tenant.orgId();
    const since7 = new Date(Date.now() - 7 * DAY);
    const [agents, ai, modes, handoffs, runs] = await Promise.all([
      this.prisma.agentConfig.findMany({
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          name: true,
          isActive: true,
          isDefault: true,
          model: true,
          effort: true,
          autopilotByDefault: true,
          replyDelaySec: true,
          welcomeEnabled: true,
          businessHoursEnabled: true,
          businessHours: true,
          enabledTools: true,
          monthlyTokenBudget: true,
          systemPrompt: true,
          channel: { select: { displayPhoneNumber: true, label: true } },
          pipelines: { select: { name: true } },
        },
      }),
      this.settings.status(),
      this.prisma.conversation.groupBy({ by: ["aiMode"], where: { status: "OPEN" }, _count: { _all: true } }),
      this.prisma.conversation.findMany({
        where: { handoffAt: { gte: since7 } },
        orderBy: { handoffAt: "desc" },
        take: 10,
        select: { id: true, handoffAt: true, handoffReason: true, contact: { select: { name: true, phone: true } } },
      }),
      // AiRun no lleva orgId: se filtra por la empresa de su conversación.
      this.prisma.aiRun.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since7 }, conversation: { orgId } },
        _count: { _all: true },
      }),
    ]);

    return {
      clave: {
        lista: ai.ready,
        proveedor: ai.provider,
        modelo: ai.model,
        deQuien: ai.source,
        cupoDeDriony: ai.included
          ? { conversaciones: ai.included.conversations, limite: ai.included.limit, agotado: ai.included.full || ai.included.exhausted }
          : null,
      },
      agentes: agents.map((a) => ({
        nombre: a.name,
        activo: a.isActive,
        principal: a.isDefault,
        numero: a.channel ? (a.channel.label ?? a.channel.displayPhoneNumber) : "todos los números sin agente propio",
        embudos: a.pipelines.map((p) => p.name),
        modelo: a.model,
        esfuerzo: a.effort,
        respondeSoloEnChatsNuevos: a.autopilotByDefault,
        esperaAntesDeResponderSeg: a.replyDelaySec,
        bienvenida: a.welcomeEnabled,
        horario: a.businessHoursEnabled ? a.businessHours : "siempre",
        herramientas: a.enabledTools,
        topeMensualDeTokens: a.monthlyTokenBudget,
        instrucciones: a.systemPrompt.length > 800 ? `${a.systemPrompt.slice(0, 800)}…` : a.systemPrompt,
      })),
      chatsAbiertosPorModoDeIA: Object.fromEntries(modes.map((m) => [m.aiMode, m._count._all])),
      respuestasDeLaIAUltimos7Dias: Object.fromEntries(runs.map((r) => [r.status, r._count._all])),
      ultimosPasesAHumano: handoffs.map((h) => ({
        cuando: iso(h.handoffAt),
        motivo: h.handoffReason,
        contacto: h.contact.name ?? h.contact.phone,
        enlace: `/?c=${h.id}`,
      })),
    };
  }

  // ── Equipo ──────────────────────────────────────────────────
  private async team() {
    const [users, sources] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: {
          name: true,
          email: true,
          role: true,
          isActive: true,
          permissions: true,
          sources: { select: { source: { select: { name: true } } } },
          _count: { select: { assignedConversations: { where: { status: "OPEN" } } } },
        },
      }),
      this.prisma.source.findMany({
        orderBy: { name: "asc" },
        select: { name: true, _count: { select: { users: true, contacts: true } } },
      }),
    ]);

    return {
      personas: users.map((u) => {
        const p = effectivePermissions(u.role, u.permissions);
        return {
          nombre: u.name ?? u.email,
          email: u.email,
          rol: u.role === "ADMIN" ? "administrador" : "vendedor",
          activo: u.isActive,
          ve: SCOPE_LABELS[p.scope],
          secciones: (Object.keys(p.sections) as PermissionSection[])
            .filter((k) => p.sections[k])
            .map((k) => SECTION_LABELS[k]),
          puede: (Object.keys(p.actions) as PermissionAction[]).filter((k) => p.actions[k]).map((k) => ACTION_LABELS[k]),
          fuentes: u.sources.map((s) => s.source.name),
          chatsAbiertosAsignados: u._count.assignedConversations,
        };
      }),
      fuentes: sources.map((s) => ({ nombre: s.name, vendedores: s._count.users, contactos: s._count.contacts })),
    };
  }

  // ── Embudos ─────────────────────────────────────────────────
  private async pipelines() {
    const rows = await this.prisma.pipeline.findMany({
      orderBy: { order: "asc" },
      select: {
        name: true,
        isDefault: true,
        inboundEnabled: true,
        inboundStageId: true,
        inboundDiscardDays: true,
        bot: { select: { name: true } },
        channels: { select: { displayPhoneNumber: true, label: true } },
        stages: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
            isWon: true,
            isLost: true,
            isQualified: true,
            conversionEvents: true,
            _count: { select: { deals: { where: { discardedAt: null } } } },
            automations: {
              orderBy: { order: "asc" },
              select: { trigger: true, delayMinutes: true, enabled: true, flow: { select: { name: true, isActive: true } } },
            },
          },
        },
      },
    });

    return rows.map((p) => ({
      embudo: p.name,
      predeterminado: p.isDefault,
      numeros: p.channels.map((c) => c.label ?? c.displayPhoneNumber),
      agenteIA: p.bot?.name ?? null,
      entradaDesdeWhatsApp: p.inboundEnabled
        ? {
            etapa: p.stages.find((s) => s.id === p.inboundStageId)?.name ?? p.stages[0]?.name ?? null,
            descartaSinRespuestaTrasDias: p.inboundDiscardDays,
          }
        : false,
      etapas: p.stages.map((s) => ({
        nombre: s.name,
        tipo: s.isWon ? "ganada" : s.isLost ? "perdida" : s.isQualified ? "calificada" : "normal",
        oportunidades: s._count.deals,
        conversionesDeMeta: Array.isArray(s.conversionEvents)
          ? (s.conversionEvents as { eventName?: string }[]).map((e) => e?.eventName).filter(Boolean)
          : [],
        automatizaciones: s.automations.map((a) => ({
          cuando: a.trigger,
          esperaMin: a.delayMinutes,
          flujo: a.flow ? `${a.flow.name}${a.flow.isActive ? "" : " (flujo apagado)"}` : null,
          activa: a.enabled,
        })),
      })),
    }));
  }

  // ── Formularios de Facebook ─────────────────────────────────
  private async metaLeads() {
    const pages = await this.prisma.metaPage.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        pageId: true,
        name: true,
        isActive: true,
        subscribedAt: true,
        tagIds: true,
        createDeal: true,
        dealStageId: true,
        formRules: true,
        source: { select: { name: true } },
        template: { select: { name: true, status: true } },
      },
    });
    if (!pages.length) return { paginas: [], nota: "No hay páginas de Facebook conectadas." };

    const pageIds = pages.map((p) => p.pageId);
    const rules = pages.map((p) => parseMetaFormRules(p.formRules));
    const stageIds = new Set<string>();
    const tagIds = new Set<string>();
    const sourceIds = new Set<string>();
    pages.forEach((p, i) => {
      if (p.dealStageId) stageIds.add(p.dealStageId);
      if (Array.isArray(p.tagIds)) (p.tagIds as string[]).forEach((t) => tagIds.add(t));
      for (const r of rules[i]!) {
        if (r.stage !== "page" && r.stage !== "none") stageIds.add(r.stage);
        if (r.source !== "page" && r.source !== "auto") sourceIds.add(r.source);
        r.tagIds.forEach((t) => tagIds.add(t));
      }
    });

    const [stages, tags, sources, leads, counts] = await Promise.all([
      this.prisma.pipelineStage.findMany({
        where: { id: { in: [...stageIds] } },
        select: { id: true, name: true, pipeline: { select: { name: true } } },
      }),
      this.prisma.tag.findMany({ where: { id: { in: [...tagIds] } }, select: { id: true, name: true } }),
      this.prisma.source.findMany({ where: { id: { in: [...sourceIds] } }, select: { id: true, name: true } }),
      this.prisma.metaLead.findMany({
        where: { pageId: { in: pageIds } },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { pageId: true, formName: true, status: true, error: true, name: true, phone: true, platform: true, createdAt: true },
      }),
      this.prisma.metaLead.groupBy({ by: ["pageId", "status"], where: { pageId: { in: pageIds } }, _count: { _all: true } }),
    ]);
    const stageName = (id: string) => {
      const s = stages.find((x) => x.id === id);
      return s ? `${s.pipeline.name} › ${s.name}` : "(etapa borrada)";
    };
    const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? "(etiqueta borrada)";
    const pageName = (pageId: string) => pages.find((p) => p.pageId === pageId)?.name ?? pageId;

    return {
      paginas: pages.map((p, i) => ({
        nombre: p.name,
        activa: p.isActive,
        recibeLeads: !!p.subscribedAt,
        fuente: p.source?.name ?? `${META_FORM_SOURCE_NAME} (automática)`,
        etiquetas: Array.isArray(p.tagIds) ? (p.tagIds as string[]).map(tagName) : [],
        oportunidad: p.createDeal
          ? p.dealStageId
            ? stageName(p.dealStageId)
            : "primera etapa del embudo predeterminado"
          : "no crea oportunidad",
        plantillaDeBienvenida: p.template ? `${p.template.name} (${p.template.status})` : null,
        leadsPorEstado: Object.fromEntries(
          counts.filter((c) => c.pageId === p.pageId).map((c) => [c.status, c._count._all]),
        ),
        formulariosConfigurados: rules[i]!.map((r) => ({
          formulario: r.formName || r.formId,
          importa: r.enabled,
          etapa: r.stage === "page" ? "la de la página" : r.stage === "none" ? "sin oportunidad" : stageName(r.stage),
          fuente:
            r.source === "page"
              ? "la de la página"
              : r.source === "auto"
                ? META_FORM_SOURCE_NAME
                : (sources.find((s) => s.id === r.source)?.name ?? "(fuente borrada: usa la de la página)"),
          etiquetasExtra: r.tagIds.map(tagName),
          camposAMano: r.fieldMap,
        })),
      })),
      ultimosLeads: leads.map((l) => ({
        pagina: pageName(l.pageId),
        formulario: l.formName,
        estado: l.status,
        error: l.error,
        nombre: l.name,
        telefono: l.phone,
        red: l.platform,
        cuando: iso(l.createdAt),
      })),
      nota: "Estados: PROCESSED = entró como contacto; NO_PHONE = llegó sin teléfono y espera en la lista de leads; ERROR = falló al procesarse.",
    };
  }

  // ── Contactos ───────────────────────────────────────────────
  private async findContacts(raw: string) {
    const q = raw.trim().slice(0, 80);
    if (q.length < 2) return "Escribe al menos 2 letras o 6 dígitos.";
    const digits = q.replace(/\D/g, "");
    const byPhone = digits.length >= 6;

    const contacts = await this.prisma.contact.findMany({
      where: byPhone
        ? { phone: { contains: digits } }
        : {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { waUsername: { contains: q, mode: "insensitive" } },
            ],
          },
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: {
        name: true,
        phone: true,
        origin: true,
        originDetail: true,
        createdAt: true,
        lastMessageAt: true,
        source: { select: { name: true } },
        tags: { select: { tag: { select: { name: true } } } },
        conversations: {
          orderBy: { updatedAt: "desc" },
          take: 3,
          select: {
            id: true,
            status: true,
            aiMode: true,
            aiPausedUntil: true,
            handoffReason: true,
            awaitingReply: true,
            windowExpiresAt: true,
            lastMessageAt: true,
            channel: { select: { displayPhoneNumber: true, label: true } },
            assignedAgent: { select: { name: true, email: true } },
            messages: {
              where: { status: "FAILED" },
              orderBy: { createdAt: "desc" },
              take: 2,
              select: { errorReason: true, createdAt: true },
            },
          },
        },
        deals: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            title: true,
            value: true,
            currency: true,
            discardedAt: true,
            discardReason: true,
            owner: { select: { name: true, email: true } },
            stage: { select: { name: true, isWon: true, isLost: true, pipeline: { select: { name: true } } } },
          },
        },
        metaLeads: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { formName: true, status: true, error: true, createdAt: true },
        },
      },
    });

    // Leads de formularios que no llegaron a contacto (sin teléfono o con error).
    const pageIds = (await this.prisma.metaPage.findMany({ select: { pageId: true } })).map((p) => p.pageId);
    const orphanLeads = pageIds.length
      ? await this.prisma.metaLead.findMany({
          where: {
            pageId: { in: pageIds },
            contactId: null,
            OR: byPhone
              ? [{ phone: { contains: digits } }]
              : [
                  { name: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                ],
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { formName: true, status: true, error: true, name: true, phone: true, email: true, createdAt: true },
        })
      : [];

    return {
      contactos: contacts.map((c) => ({
        nombre: c.name,
        telefono: c.phone,
        procedencia: c.originDetail ? `${c.origin}: ${c.originDetail}` : c.origin,
        fuente: c.source?.name ?? null,
        etiquetas: c.tags.map((t) => t.tag.name),
        creado: iso(c.createdAt),
        ultimoMensaje: iso(c.lastMessageAt),
        conversaciones: c.conversations.map((v) => ({
          enlace: `/?c=${v.id}`,
          estado: v.status,
          numero: v.channel ? (v.channel.label ?? v.channel.displayPhoneNumber) : null,
          asignadaA: v.assignedAgent ? (v.assignedAgent.name ?? v.assignedAgent.email) : null,
          modoIA: v.aiMode,
          iaPausadaHasta: iso(v.aiPausedUntil),
          motivoPaseAHumano: v.handoffReason,
          esperaRespuesta: v.awaitingReply,
          ventana24hHasta: iso(v.windowExpiresAt),
          mensajesFallidos: v.messages.map((m) => ({ cuando: iso(m.createdAt), motivo: m.errorReason })),
        })),
        oportunidades: c.deals.map((d) => ({
          titulo: d.title,
          embudo: d.stage.pipeline.name,
          etapa: d.stage.name,
          estado: d.discardedAt
            ? `descartada${d.discardReason ? `: ${d.discardReason}` : ""}`
            : d.stage.isWon
              ? "ganada"
              : d.stage.isLost
                ? "perdida"
                : "abierta",
          valor: d.value ? `${d.value.toString()} ${d.currency}` : null,
          responsable: d.owner ? (d.owner.name ?? d.owner.email) : null,
        })),
        leadsDeFormularios: c.metaLeads.map((l) => ({
          formulario: l.formName,
          estado: l.status,
          error: l.error,
          cuando: iso(l.createdAt),
        })),
      })),
      leadsSinContacto: orphanLeads.map((l) => ({
        formulario: l.formName,
        estado: l.status,
        error: l.error,
        nombre: l.name,
        telefono: l.phone,
        email: l.email,
        cuando: iso(l.createdAt),
      })),
      ...(contacts.length === 5 ? { nota: "Hay más coincidencias: pide un dato más concreto." } : {}),
    };
  }

  // ── Problemas recientes ─────────────────────────────────────
  private async recentProblems(rawDays: number) {
    const days = Math.min(30, Math.max(1, Math.round(rawDays)));
    const since = new Date(Date.now() - days * DAY);
    const pageIds = (await this.prisma.metaPage.findMany({ select: { pageId: true } })).map((p) => p.pageId);

    const [failedByReason, lastFailed, conns, templates, leads, conversions, webhooks, ai] = await Promise.all([
      this.prisma.message.groupBy({
        by: ["errorReason"],
        where: { status: "FAILED", createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { errorReason: "desc" } },
        take: 6,
      }),
      this.prisma.message.findMany({
        where: { status: "FAILED", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          createdAt: true,
          errorReason: true,
          type: true,
          author: true,
          conversationId: true,
          conversation: { select: { contact: { select: { name: true, phone: true } } } },
        },
      }),
      this.prisma.whatsappConnection.findMany({
        where: { OR: [{ status: { not: "connected" } }, { isActive: false }] },
        select: { label: true, displayPhoneNumber: true, status: true, statusReason: true, isActive: true, lastWebhookAt: true },
      }),
      this.prisma.template.findMany({
        where: { status: { in: ["REJECTED", "PAUSED", "DISABLED"] } },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { name: true, language: true, status: true, rejectedReason: true, updatedAt: true },
      }),
      pageIds.length
        ? this.prisma.metaLead.findMany({
            where: { pageId: { in: pageIds }, status: { in: ["NO_PHONE", "ERROR"] }, createdAt: { gte: since } },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { formName: true, status: true, error: true, name: true, createdAt: true },
          })
        : Promise.resolve([]),
      this.prisma.conversionEvent.findMany({
        where: { status: "failed", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { eventName: true, error: true, createdAt: true },
      }),
      this.prisma.webhookSubscription.findMany({
        where: { OR: [{ lastStatus: { gte: 400 } }, { lastError: { not: null } }] },
        select: { name: true, url: true, isActive: true, lastStatus: true, lastError: true, lastDeliveryAt: true, failedCount: true, deliveredCount: true },
      }),
      this.settings.status(),
    ]);

    const failedTotal = failedByReason.reduce((n, r) => n + r._count._all, 0);
    const aiProblem = !ai.ready
      ? "La IA no tiene clave ni cupo de Driony disponible: los agentes y el copiloto no funcionan."
      : ai.included && (ai.included.full || ai.included.exhausted)
        ? `El cupo de IA de Driony está agotado hasta ${ai.included.resetsAt}.`
        : null;

    const fixAt: Record<string, string> = {};
    if (conns.length) fixAt.numeros = "/settings?tab=channels&channel=whatsapp";
    if (templates.length) fixAt.plantillas = "/difusiones";
    if (leads.length) fixAt.leads = "/settings?tab=channels&channel=facebook";
    if (conversions.length) fixAt.conversiones = "/settings?tab=integrations";
    if (webhooks.length) fixAt.webhooks = "/settings?tab=webhooksOut";
    if (aiProblem) fixAt.ia = "/settings?tab=ai";

    return {
      periodo: `últimos ${days} días`,
      dondeSeArregla: fixAt,
      mensajesFallidos: failedTotal
        ? {
            total: failedTotal,
            porMotivo: failedByReason.map((r) => ({ motivo: r.errorReason ?? "(sin motivo)", veces: r._count._all })),
            ultimos: lastFailed.map((m) => ({
              cuando: iso(m.createdAt),
              motivo: m.errorReason,
              tipo: m.type,
              enviadoPor: m.author,
              contacto: m.conversation.contact.name ?? m.conversation.contact.phone,
              enlace: `/?c=${m.conversationId}`,
            })),
          }
        : null,
      numerosConProblemas: conns.map((c) => ({
        numero: c.label ? `${c.label} (${c.displayPhoneNumber ?? "sin número"})` : c.displayPhoneNumber,
        situacion: waSituation(c),
        ultimoAvisoDeMeta: iso(c.lastWebhookAt),
      })),
      plantillasConProblemas: templates.map((t) => ({
        nombre: t.name,
        idioma: t.language,
        estado: t.status,
        motivo: t.rejectedReason,
      })),
      leadsDeFormulariosConProblemas: leads.map((l) => ({
        formulario: l.formName,
        estado: l.status,
        error: l.error,
        nombre: l.name,
        cuando: iso(l.createdAt),
      })),
      conversionesDeMetaFallidas: conversions.map((c) => ({ evento: c.eventName, error: c.error, cuando: iso(c.createdAt) })),
      webhooksConErrores: webhooks.map((w) => ({
        nombre: w.name,
        destino: hostOf(w.url),
        activo: w.isActive,
        ultimoCodigo: w.lastStatus,
        ultimoError: w.lastError,
        ultimoEnvio: iso(w.lastDeliveryAt),
        fallidos: w.failedCount,
        entregados: w.deliveredCount,
      })),
      ia: aiProblem,
    };
  }
}
