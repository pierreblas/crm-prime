import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { QUEUE_INBOUND } from "../../infra/queue/queue.constants";
import { WebhookSignatureGuard } from "./webhook-signature.guard";
import { normalizeWebhook, type MetaWebhookBody } from "./webhook.types";
import { IntegrationSettingsService } from "../integrations/integration-settings.service";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";

@Controller("whatsapp/webhook")
export class WebhookController {
  private readonly logger = new Logger("Webhook");

  constructor(
    @InjectQueue(QUEUE_INBOUND) private readonly inbound: Queue,
    private readonly settings: IntegrationSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  // Verificación del webhook (Meta hace GET una sola vez al configurarlo).
  @Get()
  async verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
  ): Promise<string> {
    const expected = await this.settings.whatsappVerifyToken();
    if (mode === "subscribe" && !!expected && token === expected) {
      this.logger.log("Webhook verificado");
      return challenge;
    }
    throw new ForbiddenException("verify_token inválido");
  }

  // Eventos entrantes. Responder 200 inmediato; el trabajo va a la cola.
  @Post()
  @HttpCode(200)
  @UseGuards(WebhookSignatureGuard)
  async receive(@Body() body: MetaWebhookBody): Promise<{ received: true }> {
    const jobs = normalizeWebhook(body);
    if (jobs.length) {
      await this.inbound.addBulk(
        jobs.map((data) => ({ name: data.kind, data })),
      );
      const ids = [...new Set(jobs.map((j) => j.channelPhoneNumberId).filter((x): x is string => !!x))];
      this.logger.log(`Webhook: ${jobs.length} evento(s) de ${ids.join(", ") || "número desconocido"}`);
      void touchLastWebhook(this.prisma, ids);
    }
    return { received: true };
  }
}

/**
 * Marca en cada número cuándo llegó su último evento. Sin empresa en contexto
 * (el webhook es compartido): va sin acotar, por phoneNumberId, que es único.
 */
export function touchLastWebhook(prisma: PrismaService, phoneNumberIds: string[]): Promise<unknown> {
  if (phoneNumberIds.length === 0) return Promise.resolve();
  return runUnscoped("webhook: último evento", () =>
    prisma.whatsappConnection.updateMany({
      where: { phoneNumberId: { in: phoneNumberIds } },
      data: { lastWebhookAt: new Date() },
    }),
  ).catch(() => undefined);
}
