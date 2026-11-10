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
import { createHash } from "node:crypto";
import { QUEUE_META_LEADS, QUEUE_META_MESSAGING } from "../../infra/queue/queue.constants";
import { WebhookSignatureGuard } from "../whatsapp/webhook-signature.guard";
import { IntegrationSettingsService } from "../integrations/integration-settings.service";
import type { LeadgenNotification } from "./meta-lead.service";
import { normalizeMetaMessaging, type MetaMessagingBody } from "./meta-messaging.types";

/** Aviso de Meta cuando alguien completa un formulario. */
interface LeadgenWebhookBody {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        leadgen_id?: string | number;
        page_id?: string | number;
        form_id?: string | number;
        ad_id?: string | number;
        created_time?: number;
      };
    }[];
  }[];
}

/**
 * Webhook de las páginas de Facebook: Lead Ads (objeto «page», cambios
 * `leadgen`), Messenger (objeto «page», `messaging`) e Instagram (objeto
 * «instagram»). Meta manda poco y hay que responder 200 enseguida (si no,
 * reintenta y acaba desactivando la suscripción): todo va a una cola y el
 * worker descarga, resuelve la empresa y guarda.
 */
@Controller("meta/webhook")
export class MetaWebhookController {
  private readonly logger = new Logger("MetaWebhook");

  constructor(
    @InjectQueue(QUEUE_META_LEADS) private readonly queue: Queue,
    @InjectQueue(QUEUE_META_MESSAGING) private readonly messaging: Queue,
    private readonly settings: IntegrationSettingsService,
  ) {}

  // Verificación inicial: Meta hace un GET al guardar la URL en el panel.
  @Get()
  async verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
  ): Promise<string> {
    const expected = await this.settings.whatsappVerifyToken();
    if (mode === "subscribe" && !!expected && token === expected) {
      this.logger.log("Webhook de leads verificado");
      return challenge;
    }
    throw new ForbiddenException("verify_token inválido");
  }

  @Post()
  @HttpCode(200)
  @UseGuards(WebhookSignatureGuard)
  async receive(@Body() body: LeadgenWebhookBody & MetaMessagingBody): Promise<{ received: true }> {
    const jobs: LeadgenNotification[] = [];

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "leadgen" || !change.value) continue;
        const v = change.value;
        if (!v.leadgen_id || !v.page_id) continue;
        jobs.push({
          leadgenId: String(v.leadgen_id),
          pageId: String(v.page_id),
          formId: v.form_id ? String(v.form_id) : undefined,
          adId: v.ad_id ? String(v.ad_id) : undefined,
        });
      }
    }

    if (jobs.length) {
      await this.queue.addBulk(
        jobs.map((data) => ({
          name: "lead",
          data,
          // Un mismo lead solo entra una vez aunque Meta reintente el aviso.
          opts: { jobId: `lead-${data.leadgenId}` },
        })),
      );
      this.logger.log(`${jobs.length} lead(s) encolado(s)`);
    }

    const social = normalizeMetaMessaging(body);
    if (social.length) {
      await this.messaging.addBulk(
        social.map((data) => ({
          name: data.kind,
          data,
          // Meta reintenta si tardamos: el mismo mensaje entra una sola vez.
          opts: data.kind === "message" ? { jobId: `mm-${hash(`${data.platform}:${data.mid}`)}` } : {},
        })),
      );
      this.logger.log(`${social.length} aviso(s) de Messenger/Instagram encolado(s)`);
    }
    return { received: true };
  }
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 24);
}
