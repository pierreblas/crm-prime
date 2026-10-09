import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { OnEvent } from "@nestjs/event-emitter";
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { AccessTokenClaims } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { corsOrigin } from "../../common/utils/cors-origin";
import { tenancyMode } from "../../infra/tenant/tenant.context";

export interface InboxChangedPayload {
  conversationId: string;
  /** Empresa a la que pertenece el cambio. Decide a qué sala se emite. */
  orgId?: string;
  /** Solo cuando entró un mensaje del cliente: para avisar con nombre y texto. */
  inbound?: { contactName: string; preview: string };
}

/** La IA empieza (on) o termina (off) de redactar en una conversación. */
export interface AiTypingPayload {
  conversationId: string;
  orgId?: string;
  on: boolean;
}

@WebSocketGateway({
  // Mismo criterio que la API REST: cualquier subdominio de empresa vale.
  cors: { origin: corsOrigin(), credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger("Realtime");

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // Autenticación en el handshake con el token de realtime (corta vida).
  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("sin token");
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      const session = await this.prisma.session.findUnique({
        where: { id: claims.sid },
      });
      if (!session || session.revokedAt || session.expiresAt < new Date()) {
        throw new Error("sesión inválida");
      }
      client.data.userId = claims.sub;
      // Una sala por empresa. Antes había una sola sala para todos los
      // agentes conectados, y cada cambio de bandeja de una empresa llegaba a
      // los navegadores de las demás: no el contenido, pero sí los ids y el
      // ritmo de actividad. El `org` del token está firmado, así que la sala
      // a la que entra cada cliente no la decide el cliente.
      const sala = salaDe(claims.org);
      // En SaaS un token sin `org` (anterior al cambio) no entra a ninguna
      // sala: mejor que vuelva a iniciar sesión a que reciba eventos ajenos.
      if (!sala) throw new Error("token sin empresa");
      client.join(sala);
    } catch (e) {
      this.logger.warn(`Conexión rechazada: ${(e as Error).message}`);
      client.disconnect(true);
    }
  }

  // Reemite a los agentes de ESA empresa cuando cambia la bandeja.
  @OnEvent("inbox.changed")
  onInboxChanged(payload: InboxChangedPayload): void {
    this.emitir("inbox.changed", payload.orgId, payload);
  }

  // «La IA está escribiendo»: lo decide el autopilot, no la bandeja.
  @OnEvent("ai.typing")
  onAiTyping(payload: AiTypingPayload): void {
    this.emitir("ai.typing", payload.orgId, payload);
  }

  // Una llamada cambió (entrante, contestada, terminada, grabación lista).
  @OnEvent("call.changed")
  onCallChanged(payload: { orgId?: string; callId: string; conversationId: string | null; missed?: boolean }): void {
    this.emitir("call.changed", payload.orgId, payload);
  }

  // Reemite cuando cambia el pipeline (deal creado/movido/editado).
  @OnEvent("pipeline.changed")
  onPipelineChanged(payload: { dealId: string; orgId?: string }): void {
    this.emitir("pipeline.changed", payload.orgId, payload);
  }

  /**
   * Un evento sin empresa no se emite a todos "por si acaso": en modo SaaS se
   * descarta con aviso. Falla cerrado, igual que las consultas.
   */
  private emitir(evento: string, orgId: string | undefined, payload: unknown): void {
    const sala = salaDe(orgId);
    if (!sala) {
      this.logger.warn(`${evento} sin empresa: no se emite`);
      return;
    }
    this.server.to(sala).emit(evento, payload);
  }
}

/**
 * Sala de una empresa. En modo de una sola empresa los tokens antiguos pueden
 * no traer `org`; ahí vale la sala común, porque solo hay una empresa.
 */
function salaDe(orgId: string | undefined): string | null {
  if (orgId) return `org:${orgId}`;
  return tenancyMode === "multi" ? null : "agents";
}
