import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  connectWithTicketSchema,
  Role,
  type AccessTokenClaims,
  type ConnectHubStatus,
  type ConnectTicketResult,
  type ConnectWithTicketInput,
  type ConnectWithTicketResult,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { env } from "../../common/utils/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { OneTimeTicketService } from "../../infra/tickets/one-time-ticket.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { WhatsappConnectionService } from "./whatsapp-connection.service";
import { PlansService } from "../plans/plans.service";

const PROPOSITO = "whatsapp-connect";

/**
 * El conector de WhatsApp en dominio fijo.
 *
 * Meta solo deja que su SDK de JavaScript arranque en dominios listados a
 * mano en el panel de la app, sin comodines. Con un subdominio por empresa,
 * eso obligaría a tocar Meta en cada alta. Así que el SDK corre siempre en el
 * dominio raíz —`driony.com/connect/whatsapp`, listado una sola vez— y lo que
 * cruza desde el panel de la empresa hasta allí es un pase firmado de un solo
 * uso que dice quién es y de qué empresa. Al terminar, el pase se canjea
 * junto con el resultado de Meta, se abre el contexto de esa empresa y el
 * número se guarda donde debe.
 *
 * En una instalación de una sola empresa no hay conector: el SDK carga en la
 * propia página, como siempre, y `ticket` devuelve `connectUrl: null`.
 */
@Controller("whatsapp/connect")
export class ConnectHubController {
  constructor(
    private readonly tickets: OneTimeTicketService,
    private readonly connection: WhatsappConnectionService,
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) {}

  /** Estado del registro integrado para esta empresa: lo lee la pantalla de WhatsApp. */
  @Get("status")
  @UseGuards(JwtAuthGuard)
  async status(): Promise<ConnectHubStatus> {
    const saas = !!env("SAAS_BASE_DOMAIN");
    const coexistence = (await this.plans.current()).features.coexistence;
    return { saas, coexistence };
  }

  /** Emite el pase y la URL del conector. Solo administradores. */
  @Post("ticket")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async ticket(@CurrentUser() user: AccessTokenClaims): Promise<ConnectTicketResult> {
    const base = env("SAAS_BASE_DOMAIN");
    const coexistence = (await this.plans.current()).features.coexistence;
    if (!base) return { ticket: null, connectUrl: null, coexistence };

    // Quince minutos: escanear el QR de coexistencia lleva su rato.
    const ticket = await this.tickets.issue(
      PROPOSITO,
      { sub: user.sub, org: user.org },
      "15m",
    );
    // El conector lanza el flujo con o sin coexistencia según el plan. La API
    // vuelve a comprobarlo al guardar (connect), así que la URL no decide nada.
    return {
      ticket,
      connectUrl: `${protocolo(base)}://${base}/connect/whatsapp?ticket=${encodeURIComponent(ticket)}&coexistence=${coexistence ? 1 : 0}`,
      coexistence,
    };
  }

  /**
   * Canjea el pase con lo que devolvió Meta. Pública por necesidad: el
   * conector vive en el dominio raíz, donde no hay sesión de ninguna empresa.
   * Quien manda aquí no es la sesión, es el pase.
   */
  @Post("with-ticket")
  async withTicket(
    @Body(new ZodValidationPipe(connectWithTicketSchema))
    body: ConnectWithTicketInput,
  ): Promise<ConnectWithTicketResult> {
    const claims = await this.tickets.redeem<{ org: string }>(PROPOSITO, body.ticket);

    // El pase se emitió a un administrador; se comprueba que lo sigue siendo.
    // Sin contexto todavía —es lo que este pase establece—, así que sin filtrar.
    const user = await runUnscoped("conector: comprobar administrador", () =>
      this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { orgId: true, role: true, isActive: true },
      }),
    );
    if (!user || !user.isActive || user.orgId !== claims.org || user.role !== "ADMIN") {
      throw new ForbiddenException("Solo un administrador puede conectar números");
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: claims.org },
      select: { slug: true },
    });
    if (!org) throw new ForbiddenException("Solo un administrador puede conectar números");

    await runInOrg(claims.org, () =>
      this.connection.connect({
        code: body.code,
        // En coexistencia Meta solo manda el waba_id: la API busca el número.
        phoneNumberId: body.phoneNumberId,
        wabaId: body.wabaId,
        mode: body.mode,
      }),
    );

    const base = env("SAAS_BASE_DOMAIN") ?? "localhost:3000";
    return {
      ok: true,
      returnUrl: `${protocolo(base)}://${org.slug}.${base}/whatsapp?connected=1`,
    };
  }
}

function protocolo(base: string): "http" | "https" {
  return base.startsWith("localhost") ? "http" : "https";
}
