import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  AvailableMetaPage,
  MetaPageDto,
  MetaPagesAvailableResult,
  UpdateMetaPageInput,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { MetaGraphClient, type MetaPageAccount } from "./meta-graph.client";

/** El token de usuario solo vive unos minutos, entre elegir páginas y guardar. */
const SESSION_TTL_MS = 10 * 60 * 1000;

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

  /** Paso 2: guarda las páginas elegidas y las suscribe a los avisos. */
  async connect(sessionId: string, pageIds: string[]): Promise<MetaPageDto[]> {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      throw new BadRequestException(
        "La conexión con Facebook caducó. Vuelve a iniciar sesión.",
      );
    }

    for (const pageId of pageIds) {
      const account = session.pages.find((p) => p.pageId === pageId);
      if (!account) continue;

      // Suscribir ANTES de guardar: si Meta la rechaza, no queda una página
      // "conectada" que en realidad no recibe nada.
      await this.graph.subscribePage(account.pageId, account.accessToken);

      await this.prisma.metaPage.upsert({
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
    }

    this.sessions.delete(sessionId);
    return this.list();
  }

  async list(): Promise<MetaPageDto[]> {
    const rows = await this.prisma.metaPage.findMany({
      orderBy: { createdAt: "desc" },
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
        welcomeTemplateId: p.welcomeTemplateId,
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

    // Sin esto, un id inexistente sale como un error opaco de la base.
    if (input.sourceId) {
      const source = await this.prisma.source.findUnique({
        where: { id: input.sourceId },
      });
      if (!source) throw new BadRequestException("Esa fuente ya no existe");
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

    await this.prisma.metaPage.update({
      where: { id },
      data: {
        ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
        ...(input.tagIds !== undefined
          ? { tagIds: input.tagIds as unknown as Prisma.InputJsonValue }
          : {}),
        ...(input.createDeal !== undefined
          ? { createDeal: input.createDeal }
          : {}),
        ...(input.welcomeTemplateId !== undefined
          ? { welcomeTemplateId: input.welcomeTemplateId }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return this.list();
  }

  /** Reintenta la suscripción (p. ej. tras arreglar permisos en Meta). */
  async resubscribe(id: string): Promise<MetaPageDto[]> {
    const page = await this.prisma.metaPage.findUnique({ where: { id } });
    if (!page) throw new NotFoundException("Página no encontrada");
    await this.graph.subscribePage(page.pageId, page.accessToken);
    await this.prisma.metaPage.update({
      where: { id },
      data: { subscribedAt: new Date(), isActive: true },
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
