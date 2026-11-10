import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  defaultMetaFormRule,
  parseMetaFormRules,
  type AvailableMetaPage,
  type MetaFormQuestion,
  type MetaFormQuestionsResult,
  type MetaFormRule,
  type MetaLeadField,
  type MetaLeadFormDto,
  type MetaLeadFormsResult,
  type MetaMessagingChannel,
  type MetaPageDto,
  type MetaPagesAvailableResult,
  type UpdateMetaPageInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { MetaGraphClient, type MetaPageAccount } from "./meta-graph.client";
import { fuenteAutomatica } from "../sources/fuente-automatica";

// Preguntas estándar de Meta, por su clave en los leads.
const STANDARD_QUESTIONS: Record<string, string> = {
  full_name: "Nombre completo",
  first_name: "Nombre",
  last_name: "Apellido",
  email: "Email",
  phone_number: "Teléfono",
  city: "Ciudad",
  state: "Estado o región",
  province: "Provincia",
  country: "País",
  zip_code: "Código postal",
  post_code: "Código postal",
  street_address: "Dirección",
  date_of_birth: "Fecha de nacimiento",
  gender: "Género",
  job_title: "Cargo",
  company_name: "Empresa",
  work_email: "Email del trabajo",
  work_phone_number: "Teléfono del trabajo",
};

/** Texto de una pregunta de la que solo se conoce la clave («¿qué_curso?» → «¿Qué curso?»). */
function questionLabel(key: string): string {
  const text = STANDARD_QUESTIONS[key] ?? key.replace(/_/g, " ").trim();
  const first = text.search(/\p{L}/u);
  return first < 0 ? text : text.slice(0, first) + text[first]!.toUpperCase() + text.slice(first + 1);
}

/** El token de usuario solo vive unos minutos, entre elegir páginas y guardar. */
const SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * Lo que la página tiene que notificar para que Messenger e Instagram entren en
 * la bandeja. Instagram no tiene campos propios en la página: sus avisos
 * llegan por «messages» con el objeto «instagram» configurado en la app.
 */
export const META_MESSAGING_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_echoes",
  "message_reads",
  "message_deliveries",
  "message_reactions",
  "messaging_referrals",
] as const;

function subscribedFields(page: { messengerEnabled: boolean; instagramEnabled: boolean }): string[] {
  return page.messengerEnabled || page.instagramEnabled ? ["leadgen", ...META_MESSAGING_FIELDS] : ["leadgen"];
}

@Injectable()
export class MetaPageService {
  private readonly logger = new Logger("MetaPages");
  // No se guarda en la BD: es un token temporal de un paso intermedio.
  private readonly sessions = new Map<
    string,
    { pages: MetaPageAccount[]; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly graph: MetaGraphClient,
  ) {}

  /** Paso 1: del login (token, o código antiguo) a las páginas del usuario (sin sus tokens). */
  async available(input: { accessToken?: string; code?: string }): Promise<MetaPagesAvailableResult> {
    const userToken = input.accessToken
      ? await this.graph.tokenFromLogin(input.accessToken)
      : await this.graph.exchangeCode(input.code ?? "");
    const pages = await this.graph.listPages(userToken);
    if (pages.length === 0) {
      throw new BadRequestException(
        "Tu usuario de Facebook no administra ninguna página.",
      );
    }

    const connected = await this.prisma.metaPage.findMany({
      select: { pageId: true },
    });
    const connectedIds = new Set(connected.map((p) => p.pageId));

    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      pages,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    this.cleanSessions();

    const list: AvailableMetaPage[] = pages.map((p) => ({
      pageId: p.pageId,
      name: p.name,
      connected: connectedIds.has(p.pageId),
    }));
    return { sessionId, pages: list };
  }

  /**
   * Paso 2: guarda las páginas elegidas y las suscribe a los avisos. Con
   * `enable`, además enciende Messenger o Instagram en cada una.
   */
  async connect(sessionId: string, pageIds: string[], enable?: MetaMessagingChannel): Promise<MetaPageDto[]> {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      throw new BadRequestException(
        "La conexión con Facebook caducó. Vuelve a iniciar sesión.",
      );
    }

    const connected: string[] = [];
    for (const pageId of pageIds) {
      const account = session.pages.find((p) => p.pageId === pageId);
      if (!account) continue;

      // Suscribir ANTES de guardar: si Meta la rechaza, no queda una página
      // "conectada" que en realidad no recibe nada.
      await this.graph.subscribePage(account.pageId, account.accessToken);

      const row = await this.prisma.metaPage.upsert({
        where: { pageId: account.pageId },
        create: {
          orgId: this.tenant.orgId(),
          pageId: account.pageId,
          name: account.name,
          accessToken: account.accessToken,
          subscribedAt: new Date(),
        },
        update: {
          name: account.name,
          accessToken: account.accessToken,
          isActive: true,
          subscribedAt: new Date(),
        },
      });
      this.logger.log(`Página conectada: ${account.name} (${account.pageId})`);
      connected.push(row.id);
    }

    this.sessions.delete(sessionId);
    // La fuente de sus formularios existe desde ya (se ve en Ajustes › Fuentes).
    if (connected.length) await fuenteAutomatica(this.prisma, this.tenant.orgId(), "form").catch(() => undefined);
    if (enable) {
      // Encender el canal pedido en cada página. Si una falla (sin Instagram
      // vinculado, sin permiso), las demás siguen y se avisa de la primera.
      let firstError: string | null = null;
      for (const id of connected) {
        try {
          await this.update(id, enable === "messenger" ? { messengerEnabled: true } : { instagramEnabled: true });
        } catch (e) {
          firstError ??= (e as Error).message;
        }
      }
      if (firstError) throw new BadRequestException(firstError);
    }
    return this.list();
  }

  async list(): Promise<MetaPageDto[]> {
    const rows = await this.prisma.metaPage.findMany({
      orderBy: { createdAt: "desc" },
      include: { messengerBot: { select: { id: true, name: true } }, instagramBot: { select: { id: true, name: true } } },
    });
    const counts = await this.prisma.metaLead.groupBy({
      by: ["pageId", "status"],
      _count: { _all: true },
    });

    return rows.map((p) => {
      const mine = counts.filter((c) => c.pageId === p.pageId);
      return {
        id: p.id,
        pageId: p.pageId,
        name: p.name,
        isActive: p.isActive,
        subscribedAt: p.subscribedAt?.toISOString() ?? null,
        sourceId: p.sourceId,
        tagIds: Array.isArray(p.tagIds) ? (p.tagIds as string[]) : [],
        createDeal: p.createDeal,
        dealStageId: p.dealStageId,
        formRules: parseMetaFormRules(p.formRules),
        welcomeTemplateId: p.welcomeTemplateId,
        messengerEnabled: p.messengerEnabled,
        instagramEnabled: p.instagramEnabled,
        instagramId: p.instagramId,
        instagramUsername: p.instagramUsername,
        messagingSubscribedAt: p.messagingSubscribedAt?.toISOString() ?? null,
        messagingError: p.messagingError,
        messengerBot: p.messengerBot ? { id: p.messengerBot.id, name: p.messengerBot.name } : null,
        instagramBot: p.instagramBot ? { id: p.instagramBot.id, name: p.instagramBot.name } : null,
        messengerPipelineId: p.messengerPipelineId,
        instagramPipelineId: p.instagramPipelineId,
        messengerSourceId: p.messengerSourceId,
        instagramSourceId: p.instagramSourceId,
        leadCount: mine.reduce((n, c) => n + c._count._all, 0),
        pendingCount:
          mine.find((c) => c.status === "NO_PHONE")?._count._all ?? 0,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  async update(id: string, input: UpdateMetaPageInput): Promise<MetaPageDto[]> {
    const existing = await this.prisma.metaPage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Página no encontrada");

    // Sin esto, un id inexistente sale como un error opaco de la base. Las
    // fuentes elegidas tienen que existir (la de la página y las de cada formulario).
    const sourceIds = [
      ...(input.sourceId ? [input.sourceId] : []),
      ...(input.formRules ?? []).map((r) => r.source).filter((s) => s !== "page" && s !== "auto"),
    ];
    if (sourceIds.length) {
      const found = await this.prisma.source.count({ where: { id: { in: [...new Set(sourceIds)] } } });
      if (found !== new Set(sourceIds).size) throw new BadRequestException("Esa fuente ya no existe");
    }
    if (input.welcomeTemplateId) {
      const template = await this.prisma.template.findUnique({
        where: { id: input.welcomeTemplateId },
      });
      if (!template) throw new BadRequestException("Esa plantilla ya no existe");
      if (template.status !== "APPROVED") {
        throw new BadRequestException(
          "La plantilla de bienvenida debe estar aprobada por Meta.",
        );
      }
    }
    // Las etapas elegidas tienen que existir (la de la página y las de cada formulario).
    const stageIds = [
      ...(input.dealStageId ? [input.dealStageId] : []),
      ...(input.formRules ?? []).map((r) => r.stage).filter((s) => s !== "page" && s !== "none"),
    ];
    if (stageIds.length) {
      const found = await this.prisma.pipelineStage.count({ where: { id: { in: [...new Set(stageIds)] } } });
      if (found !== new Set(stageIds).size) throw new BadRequestException("Esa etapa ya no existe");
    }

    // ── Mensajería: quién atiende cada canal y si está encendido ──
    const messaging: Prisma.MetaPageUncheckedUpdateInput = {};
    for (const key of ["messengerBotId", "instagramBotId"] as const) {
      const botId = input[key];
      if (botId === undefined) continue;
      if (botId && !(await this.prisma.agentConfig.findUnique({ where: { id: botId }, select: { id: true } }))) {
        throw new BadRequestException("Ese agente ya no existe");
      }
      messaging[key] = botId || null;
    }
    for (const key of ["messengerPipelineId", "instagramPipelineId"] as const) {
      const pipelineId = input[key];
      if (pipelineId === undefined) continue;
      if (pipelineId && !(await this.prisma.pipeline.findUnique({ where: { id: pipelineId }, select: { id: true } }))) {
        throw new BadRequestException("Ese embudo ya no existe");
      }
      messaging[key] = pipelineId || null;
    }
    for (const key of ["messengerSourceId", "instagramSourceId"] as const) {
      const sourceId = input[key];
      if (sourceId === undefined) continue;
      if (sourceId && !(await this.prisma.source.findUnique({ where: { id: sourceId }, select: { id: true } }))) {
        throw new BadRequestException("Esa fuente ya no existe");
      }
      messaging[key] = sourceId || null;
    }
    const wantsMessenger = input.messengerEnabled ?? existing.messengerEnabled;
    const wantsInstagram = input.instagramEnabled ?? existing.instagramEnabled;
    if (wantsInstagram && !existing.instagramId) {
      const ig = await this.graph.pageInstagram(existing.pageId, existing.accessToken);
      if (!ig) {
        throw new BadRequestException(
          "Esta página no tiene una cuenta profesional de Instagram vinculada, o la conexión no incluyó el permiso instagram_basic. Vincúlala en la configuración de la página y vuelve a pulsar «Conectar con Facebook».",
        );
      }
      messaging.instagramId = ig.id;
      messaging.instagramUsername = ig.username;
    }
    if (wantsMessenger !== existing.messengerEnabled || wantsInstagram !== existing.instagramEnabled) {
      // Suscribir ANTES de guardar: si Meta lo rechaza (sin permiso), nada queda encendido a medias.
      await this.graph.subscribePage(
        existing.pageId,
        existing.accessToken,
        subscribedFields({ messengerEnabled: wantsMessenger, instagramEnabled: wantsInstagram }),
      );
      messaging.messengerEnabled = wantsMessenger;
      messaging.instagramEnabled = wantsInstagram;
      messaging.messagingSubscribedAt = wantsMessenger || wantsInstagram ? (existing.messagingSubscribedAt ?? new Date()) : null;
      messaging.messagingError = null;
      messaging.subscribedAt = new Date();
      this.logger.log(`Página ${existing.name}: Messenger ${wantsMessenger ? "sí" : "no"}, Instagram ${wantsInstagram ? "sí" : "no"}`);
    }
    // Las fuentes de los canales encendidos existen desde ya (se ven en Ajustes › Fuentes).
    if (wantsMessenger) await fuenteAutomatica(this.prisma, this.tenant.orgId(), "messenger").catch(() => undefined);
    if (wantsInstagram) await fuenteAutomatica(this.prisma, this.tenant.orgId(), "instagram").catch(() => undefined);

    await this.prisma.metaPage.update({
      where: { id },
      data: {
        ...messaging,
        ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
        ...(input.tagIds !== undefined
          ? { tagIds: input.tagIds as unknown as Prisma.InputJsonValue }
          : {}),
        ...(input.createDeal !== undefined
          ? { createDeal: input.createDeal }
          : {}),
        ...(input.dealStageId !== undefined ? { dealStageId: input.dealStageId } : {}),
        ...(input.formRules !== undefined
          ? { formRules: input.formRules as unknown as Prisma.InputJsonValue }
          : {}),
        ...(input.welcomeTemplateId !== undefined
          ? { welcomeTemplateId: input.welcomeTemplateId }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return this.list();
  }

  /**
   * Los formularios de la página, cada uno con su regla y los leads que trajo:
   * los que Meta lista (si el permiso lo deja) más los que ya mandaron algún
   * lead, que salen aunque Meta no deje listarlos o ya estén archivados.
   */
  async forms(id: string): Promise<MetaLeadFormsResult> {
    const page = await this.prisma.metaPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException("Página no encontrada");
    const [fromMeta, seen] = await Promise.all([
      this.graph.listForms(page.pageId, page.accessToken),
      this.prisma.metaLead.groupBy({
        by: ["formId", "formName"],
        where: { pageId: page.pageId, formId: { not: null } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
    const rules = parseMetaFormRules(page.formRules);
    const byId = new Map<string, MetaLeadFormDto>();
    const ruleOf = (formId: string, formName: string): MetaFormRule =>
      rules.find((r) => r.formId === formId) ?? defaultMetaFormRule(formId, formName);

    for (const f of fromMeta ?? []) {
      byId.set(f.id, { ...ruleOf(f.id, f.name), formName: f.name, status: f.status, leadCount: 0, lastLeadAt: null });
    }
    for (const s of seen) {
      const formId = s.formId!;
      const prev = byId.get(formId);
      const leadCount = (prev?.leadCount ?? 0) + s._count._all;
      const last = s._max.createdAt?.toISOString() ?? null;
      byId.set(formId, {
        ...(prev ?? { ...ruleOf(formId, s.formName ?? formId), status: null }),
        formName: prev?.formName ?? s.formName ?? formId,
        leadCount,
        lastLeadAt: [prev?.lastLeadAt, last].filter(Boolean).sort().at(-1) ?? null,
      });
    }
    // Una regla de un formulario que ya no aparece por ningún lado se conserva igual.
    for (const r of rules) if (!byId.has(r.formId)) byId.set(r.formId, { ...r, status: null, leadCount: 0, lastLeadAt: null });

    // Primero los activos y los que traen leads; los archivados al final.
    const forms = [...byId.values()].sort(
      (a, b) =>
        Number(a.status === "ARCHIVED") - Number(b.status === "ARCHIVED") ||
        (b.lastLeadAt ?? "").localeCompare(a.lastLeadAt ?? "") ||
        a.formName.localeCompare(b.formName, "es"),
    );
    return { forms, fromMeta: fromMeta !== null };
  }

  /**
   * Las preguntas de un formulario, para elegir a dónde va cada respuesta: las
   * que da Meta (si el permiso lo deja) más las que llegaron en los últimos
   * leads, con la última respuesta de ejemplo.
   */
  async questions(id: string, formId: string): Promise<MetaFormQuestionsResult> {
    // Va dentro de la URL de la Graph API: solo un id de Meta (números).
    if (!/^\d{1,30}$/.test(formId)) throw new BadRequestException("Formulario no válido");
    const page = await this.prisma.metaPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException("Página no encontrada");
    const [fromMeta, recent] = await Promise.all([
      this.graph.getFormQuestions(formId, page.accessToken),
      this.prisma.metaLead.findMany({
        where: { pageId: page.pageId, formId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { fieldData: true },
      }),
    ]);
    const sample = new Map<string, string>();
    for (const lead of recent) {
      for (const f of (lead.fieldData as MetaLeadField[] | null) ?? []) {
        if (f.value?.trim() && !sample.has(f.name)) sample.set(f.name, f.value.trim().slice(0, 80));
      }
    }
    const byKey = new Map<string, MetaFormQuestion>();
    for (const q of fromMeta ?? []) byKey.set(q.key, { key: q.key, label: q.label, sample: sample.get(q.key) ?? null });
    for (const [key, value] of sample) if (!byKey.has(key)) byKey.set(key, { key, label: questionLabel(key), sample: value });
    return { questions: [...byKey.values()], fromMeta: fromMeta !== null };
  }

  /** Reintenta la suscripción (p. ej. tras arreglar permisos en Meta). */
  async resubscribe(id: string): Promise<MetaPageDto[]> {
    const page = await this.prisma.metaPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException("Página no encontrada");
    await this.graph.subscribePage(page.pageId, page.accessToken, subscribedFields(page));
    await this.prisma.metaPage.update({
      where: { id },
      data: { subscribedAt: new Date(), isActive: true, messagingError: null },
    });
    return this.list();
  }

  async disconnect(id: string): Promise<MetaPageDto[]> {
    const page = await this.prisma.metaPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException("Página no encontrada");
    await this.graph.unsubscribePage(page.pageId, page.accessToken);
    await this.prisma.metaPage.delete({ where: { id } });
    this.logger.log(`Página desconectada: ${page.name}`);
    return this.list();
  }

  private cleanSessions(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.expiresAt < now) this.sessions.delete(id);
    }
  }
}
