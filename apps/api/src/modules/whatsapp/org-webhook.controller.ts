import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { Request } from "express";
import { QUEUE_INBOUND } from "../../infra/queue/queue.constants";
import { IntegrationSettingsService } from "../integrations/integration-settings.service";
import {
  OrgWebhookSignatureGuard,
  type OrgWebhookRequest,
} from "./org-webhook-signature.guard";
import { OrgWebhookResolver } from "./org-webhook.resolver";
import { normalizeWebhook, type MetaWebhookBody } from "./webhook.types";
import { touchLastWebhook } from "./webhook.controller";
import { PrismaService } from "../../infra/prisma/prisma.service";

/**
 * Webhook de WhatsApp para la **app de Meta propia** de una empresa:
 * `api.driony.com/api/v1/webhooks/whatsapp/acme` (o, si el proxy lo manda
 * aquí, `acme.driony.com/api/v1/webhooks/whatsapp`).
 *
 * Existe porque el Embedded Signup solo incorpora clientes cuando Meta ha
 * dado a la plataforma acceso avanzado a los permisos de WhatsApp. Mientras
 * tanto —o si lo prefiere— un cliente puede usar su propia app: guarda su App
 * secret y verify token en Ajustes › Integraciones, apunta el webhook de su
 * app aquí y añade el número a mano con su token. El webhook de la app de la
 * plataforma sigue en `whatsapp/webhook`.
 *
 * El slug dice de qué empresa es la ruta; la firma con SU secreto es lo que
 * autentica; y el worker exige además que el número del evento sea suyo
 * (`InboundOrigin`), para que una app ajena no pueda meter mensajes en otra
 * empresa aunque firme bien lo suyo.
 */
@Controller("webhooks/whatsapp")
export class OrgWebhookController {
  private readonly logger = new Logger("WebhookPropio");

  constructor(
    @InjectQueue(QUEUE_INBOUND) private readonly inbound: Queue,
    private readonly settings: IntegrationSettingsService,
    private readonly resolver: OrgWebhookResolver,
    private readonly prisma: PrismaService,
  ) {}

  // Verificación: Meta hace GET una sola vez al dar de alta el webhook.
  @Get(":slug")
  async verify(
    @Req() req: Request,
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
  ): Promise<string> {
    return this.verificar(req, mode, token, challenge);
  }

  /** Misma verificación cuando la empresa viene en el subdominio. */
  @Get()
  async verifyByHost(
    @Req() req: Request,
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
  ): Promise<string> {
    return this.verificar(req, mode, token, challenge);
  }

  // Eventos. 200 inmediato; el trabajo va a la cola, atado a la empresa.
  @Post(":slug")
  @HttpCode(200)
  @UseGuards(OrgWebhookSignatureGuard)
  async receive(
    @Req() req: OrgWebhookRequest,
    @Body() body: MetaWebhookBody,
  ): Promise<{ received: true }> {
    return this.recibir(req, body);
  }

  @Post()
  @HttpCode(200)
  @UseGuards(OrgWebhookSignatureGuard)
  async receiveByHost(
    @Req() req: OrgWebhookRequest,
    @Body() body: MetaWebhookBody,
  ): Promise<{ received: true }> {
    return this.recibir(req, body);
  }

  private async verificar(req: Request, mode: string, token: string, challenge: string): Promise<string> {
    const org = await this.resolver.de(req);
    const propia = await this.settings.ownWhatsappApp(org.id);
    if (!propia?.verifyToken) {
      // Que se vea en el log por qué Meta no pudo verificar: no es el token,
      // es que esta empresa aún no guardó el suyo.
      this.logger.warn(`Webhook propio de ${org.slug}: sin verify token guardado en Ajustes › Integraciones`);
      throw new ForbiddenException("Esta empresa no tiene verify token guardado en Ajustes › Integraciones");
    }
    if (mode === "subscribe" && token === propia.verifyToken) {
      this.logger.log(`Webhook propio verificado (${org.slug})`);
      return challenge;
    }
    this.logger.warn(`Webhook propio de ${org.slug}: verify token distinto al guardado`);
    throw new ForbiddenException("verify_token inválido");
  }

  private async recibir(req: OrgWebhookRequest, body: MetaWebhookBody): Promise<{ received: true }> {
    const { orgId } = req.orgWebhook;
    const jobs = normalizeWebhook(body);
    if (jobs.length) {
      await this.inbound.addBulk(
        jobs.map((data) => ({ name: data.kind, data: { ...data, orgId } })),
      );
      void touchLastWebhook(this.prisma, [...new Set(jobs.map((j) => j.channelPhoneNumberId).filter((x): x is string => !!x))]);
    }
    return { received: true };
  }
}
