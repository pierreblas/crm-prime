import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { Role, updateTikTokAccountSchema, type AccessTokenClaims, type UpdateTikTokAccountInput } from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { QUEUE_TIKTOK } from "../../infra/queue/queue.constants";
import { TikTokClient } from "../messaging/tiktok.client";
import { TikTokAccountService } from "./tiktok-account.service";
import { parseTikTokContent, TIKTOK_EVENTS, type TikTokEvent } from "./tiktok-messaging.service";

/** Lo que gestiona el administrador de la empresa. */
@Controller("tiktok")
@UseGuards(JwtAuthGuard)
export class TikTokController {
  constructor(private readonly accounts: TikTokAccountService) {}

  @Get("accounts")
  list() {
    return this.accounts.list();
  }

  @Post("connect/start")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  start(@CurrentUser() user: AccessTokenClaims) {
    return this.accounts.startConnect({ sub: user.sub, org: user.org });
  }

  @Patch("accounts/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateTikTokAccountSchema)) body: UpdateTikTokAccountInput) {
    return this.accounts.update(id, body);
  }

  @Delete("accounts/:id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param("id") id: string) {
    return this.accounts.remove(id);
  }
}

/**
 * Lo que llama TikTok: la vuelta de la autorización (el navegador del
 * administrador, con nuestro pase en `state`) y el webhook de la app. Sin
 * sesión por necesidad; lo que autentica es el pase y la firma.
 */
@Controller("tiktok")
export class TikTokPublicController {
  private readonly logger = new Logger("TikTokWebhook");

  constructor(
    private readonly accounts: TikTokAccountService,
    private readonly client: TikTokClient,
    @InjectQueue(QUEUE_TIKTOK) private readonly queue: Queue,
  ) {}

  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const url = await this.accounts.completeConnect({ code, state, error, errorDescription });
      res.redirect(302, url);
    } catch (e) {
      // Sin pase válido no se sabe ni de qué empresa es: se explica aquí mismo.
      res.status(400).type("text/plain").send(`No se pudo completar la conexión con TikTok: ${(e as Error).message}. Vuelve a Ajustes › Canales › TikTok e inténtalo de nuevo.`);
    }
  }

  /** Los avisos de mensajes. Responder 200 enseguida; el trabajo va a la cola. */
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Body() body: TikTokEvent | TikTokEvent[]): Promise<{ received: true }> {
    const header = req.headers["tiktok-signature"];
    const raw = req.rawBody;
    if (!this.client.configured) {
      this.logger.warn("Webhook de TikTok recibido sin app configurada: se ignora");
      return { received: true };
    }
    if (typeof header !== "string" || !raw || !this.client.verifySignature(header, raw)) {
      throw new UnauthorizedException("Firma de TikTok ausente o inválida");
    }
    const events = (Array.isArray(body) ? body : [body]).filter(
      (e): e is TikTokEvent => !!e && typeof e === "object" && TIKTOK_EVENTS.includes((e.event ?? "") as (typeof TIKTOK_EVENTS)[number]),
    );
    if (events.length) {
      await this.queue.addBulk(
        events.map((data) => {
          const mid = parseTikTokContent(data.content)?.message_id;
          return {
            name: data.event ?? "event",
            data,
            // TikTok reintenta hasta 72 h si no respondimos: el mismo mensaje entra una vez.
            opts: mid ? { jobId: `tt-${createHash("sha1").update(`${data.event}:${mid}`).digest("hex").slice(0, 24)}` } : {},
          };
        }),
      );
      this.logger.log(`${events.length} aviso(s) de TikTok encolado(s)`);
    }
    return { received: true };
  }
}
