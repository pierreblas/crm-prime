import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { TikTokAccountsResponse, TikTokAccountDto, UpdateTikTokAccountInput } from "@crm/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { OneTimeTicketService } from "../../infra/tickets/one-time-ticket.service";
import { env } from "../../common/utils/env";
import { publicApiBase } from "../../common/utils/public-api-base";
import { TikTokClient } from "../messaging/tiktok.client";
import { fuenteAutomatica } from "../sources/fuente-automatica";

const PROPOSITO = "tiktok-connect";

/**
 * Cuentas de TikTok de la empresa: conectar (OAuth en tiktok.com con un pase
 * de un solo uso como `state`), listar, configurar y quitar. El webhook es de
 * la app, no de la cuenta: se registra una vez en TikTok con la URL pública.
 */
@Injectable()
export class TikTokAccountService {
  private readonly logger = new Logger("TikTok");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly tickets: OneTimeTicketService,
    private readonly client: TikTokClient,
  ) {}

  /** La URL de retorno de la autorización: tiene que estar registrada en la app de TikTok. */
  callbackUrl(): string | null {
    const base = publicApiBase() ?? (env("API_PORT") ? `http://localhost:${env("API_PORT")}` : null);
    return base ? `${base}/api/v1/tiktok/callback` : null;
  }

  webhookUrl(): string | null {
    const base = publicApiBase();
    return base ? `${base}/api/v1/tiktok/webhook` : null;
  }

  async list(): Promise<TikTokAccountsResponse> {
    const rows = await this.prisma.tikTokAccount.findMany({
      orderBy: { connectedAt: "desc" },
      include: { bot: { select: { id: true, name: true } } },
    });
    return {
      configured: this.client.configured,
      callbackUrl: this.callbackUrl(),
      webhookUrl: this.webhookUrl(),
      accounts: rows.map((a) => this.toDto(a)),
    };
  }

  /** Paso 1: el pase y la URL de TikTok a la que mandar al administrador. */
  async startConnect(user: { sub: string; org: string }): Promise<{ url: string }> {
    if (!this.client.configured) {
      throw new BadRequestException("Falta la app de TikTok en el servidor (TIKTOK_APP_ID y TIKTOK_APP_SECRET).");
    }
    const redirect = this.callbackUrl();
    if (!redirect) throw new BadRequestException("Falta la URL pública de la API (API_PUBLIC_URL) para recibir la autorización de TikTok.");
    const ticket = await this.tickets.issue(PROPOSITO, { sub: user.sub, org: user.org }, "15m");
    return { url: this.client.authorizeUrl(redirect, ticket) };
  }

  /**
   * Paso 2: TikTok devuelve al navegador con `code` y nuestro `state`. Se canjea
   * el pase (que dice quién y de qué empresa), se piden los tokens y la cuenta
   * queda conectada. Devuelve a dónde mandar al navegador.
   */
  async completeConnect(input: { code?: string; state?: string; error?: string; errorDescription?: string }): Promise<string> {
    if (!input.state) throw new BadRequestException("Falta el pase de la conexión (state).");
    const claims = await this.tickets.redeem<{ sub: string; org: string }>(PROPOSITO, input.state);
    const org = await runUnscoped("conexión de TikTok: empresa del pase", () =>
      this.prisma.organization.findUnique({ where: { id: claims.org }, select: { id: true, slug: true } }),
    );
    if (!org) throw new BadRequestException("Empresa no encontrada");
    const back = (query: string) => `${this.webBase(org.slug)}/settings?tab=channels&channel=tiktok&${query}`;

    if (input.error || !input.code) {
      const reason = input.errorDescription || input.error || "La autorización se canceló";
      return back(`error=${encodeURIComponent(reason)}`);
    }
    try {
      await runInOrg(org.id, async () => {
        // El pase se emitió a un administrador; se comprueba que lo sigue siendo.
        const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, select: { role: true, isActive: true } });
        if (!user || !user.isActive || user.role !== "ADMIN") throw new BadRequestException("Solo un administrador puede conectar cuentas");

        const redirect = this.callbackUrl();
        const tokens = await this.client.exchangeCode(input.code!, redirect ?? "");
        const details = await this.client.accountDetails({ businessId: tokens.businessId, accessToken: tokens.accessToken }).catch(() => ({
          username: null,
          displayName: null,
          avatarUrl: null,
        }));
        await this.prisma.tikTokAccount
          .upsert({
            where: { businessId: tokens.businessId },
            create: {
              orgId: org.id,
              businessId: tokens.businessId,
              username: details.username,
              displayName: details.displayName,
              avatarUrl: details.avatarUrl,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              tokenExpiresAt: tokens.tokenExpiresAt,
              refreshExpiresAt: tokens.refreshExpiresAt,
              status: "connected",
              isActive: true,
            },
            update: {
              username: details.username ?? undefined,
              displayName: details.displayName ?? undefined,
              avatarUrl: details.avatarUrl ?? undefined,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              tokenExpiresAt: tokens.tokenExpiresAt,
              refreshExpiresAt: tokens.refreshExpiresAt,
              status: "connected",
              statusReason: null,
              isActive: true,
            },
          })
          .catch((e: { code?: string }) => {
            // Acotado a la empresa: si la cuenta es de otra, el upsert pasa a crear y el índice único global lo rechaza.
            if (e.code === "P2002") throw new ConflictException("Esa cuenta de TikTok ya está conectada en otra empresa");
            throw e;
          });
        // La fuente «TikTok» existe desde ya (se ve en Ajustes › Fuentes).
        await fuenteAutomatica(this.prisma, org.id, "tiktok").catch(() => undefined);
        this.logger.log(`TikTok conectado: @${details.username ?? tokens.businessId}`);
      });
      return back("connected=1");
    } catch (e) {
      this.logger.warn(`Conexión de TikTok fallida: ${(e as Error).message}`);
      return back(`error=${encodeURIComponent((e as Error).message)}`);
    }
  }

  async update(id: string, input: UpdateTikTokAccountInput): Promise<TikTokAccountsResponse> {
    const existing = await this.prisma.tikTokAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Cuenta de TikTok no encontrada");
    const data: Prisma.TikTokAccountUncheckedUpdateInput = {};
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.botId !== undefined) {
      if (input.botId && !(await this.prisma.agentConfig.findUnique({ where: { id: input.botId }, select: { id: true } }))) {
        throw new BadRequestException("Ese agente ya no existe");
      }
      data.botId = input.botId || null;
    }
    if (input.pipelineId !== undefined) {
      if (input.pipelineId && !(await this.prisma.pipeline.findUnique({ where: { id: input.pipelineId }, select: { id: true } }))) {
        throw new BadRequestException("Ese embudo ya no existe");
      }
      data.pipelineId = input.pipelineId || null;
    }
    if (input.sourceId !== undefined) {
      if (input.sourceId && !(await this.prisma.source.findUnique({ where: { id: input.sourceId }, select: { id: true } }))) {
        throw new BadRequestException("Esa fuente ya no existe");
      }
      data.sourceId = input.sourceId || null;
    }
    await this.prisma.tikTokAccount.update({ where: { id }, data });
    return this.list();
  }

  async remove(id: string): Promise<TikTokAccountsResponse> {
    const existing = await this.prisma.tikTokAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Cuenta de TikTok no encontrada");
    await this.prisma.tikTokAccount.delete({ where: { id } });
    this.logger.log(`TikTok desconectado: @${existing.username ?? existing.businessId}`);
    return this.list();
  }

  /** La cuenta de un webhook, por su open_id. Sin empresa en contexto: es lo que se está averiguando. */
  resolveByBusinessId(businessId: string) {
    return runUnscoped("webhook de TikTok: cuenta", () => this.prisma.tikTokAccount.findUnique({ where: { businessId } }));
  }

  /**
   * El webhook es de la app: una sola URL para todas las cuentas. Al arrancar
   * se comprueba que TikTok tenga la nuestra y, si no, se registra. Sin app o
   * sin URL pública (desarrollo local), no hace nada.
   */
  async ensureWebhook(): Promise<void> {
    const url = this.webhookUrl();
    if (!this.client.configured || !url) return;
    try {
      const current = await this.client.webhookCallbackUrl();
      if (current === url) return;
      await this.client.setWebhookCallbackUrl(url);
      this.logger.log(`Webhook de TikTok registrado: ${url}`);
    } catch (e) {
      this.logger.warn(`No se pudo comprobar el webhook de TikTok: ${(e as Error).message}`);
    }
  }

  /** El panel de la empresa: su subdominio en el SaaS, o la web configurada en una instalación propia. */
  private webBase(slug: string): string {
    const base = env("SAAS_BASE_DOMAIN");
    if (base) return `${base.startsWith("localhost") ? "http" : "https"}://${slug}.${base}`;
    return (env("WEB_PUBLIC_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  private toDto(a: {
    id: string;
    businessId: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    status: string;
    statusReason: string | null;
    isActive: boolean;
    connectedAt: Date;
    tokenExpiresAt: Date;
    lastWebhookAt: Date | null;
    pipelineId: string | null;
    sourceId: string | null;
    bot: { id: string; name: string } | null;
  }): TikTokAccountDto {
    return {
      id: a.id,
      businessId: a.businessId,
      username: a.username,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      status: (a.status as TikTokAccountDto["status"]) ?? "connected",
      statusReason: a.statusReason,
      isActive: a.isActive,
      connectedAt: a.connectedAt.toISOString(),
      tokenExpiresAt: a.tokenExpiresAt.toISOString(),
      lastWebhookAt: a.lastWebhookAt?.toISOString() ?? null,
      bot: a.bot ? { id: a.bot.id, name: a.bot.name } : null,
      pipelineId: a.pipelineId,
      sourceId: a.sourceId,
    };
  }
}
