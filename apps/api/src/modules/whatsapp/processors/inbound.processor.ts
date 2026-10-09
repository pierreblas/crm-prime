import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { QUEUE_INBOUND } from "../../../infra/queue/queue.constants";
import { MessagingService } from "../../messaging/messaging.service";
import { WhatsappConnectionService } from "../whatsapp-connection.service";
import { TemplateService } from "../../campaigns/template.service";
import { runInOrg, tenancyMode } from "../../../infra/tenant/tenant.context";
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from "../whatsapp-provider.interface";
import type { InboundJob } from "../webhook.types";

@Processor(QUEUE_INBOUND)
export class InboundProcessor extends WorkerHost {
  private readonly logger = new Logger("InboundProcessor");

  constructor(
    private readonly messaging: MessagingService,
    private readonly connection: WhatsappConnectionService,
    private readonly templates: TemplateService,
    @Inject(WHATSAPP_PROVIDER) private readonly wa: WhatsAppProvider,
  ) {
    super();
  }

  /**
   * Un worker no tiene petición HTTP detrás, así que el contexto de
   * organización hay que abrirlo aquí. Sale del `phone_number_id` que Meta
   * mandó en el webhook: es lo único que identifica de quién es el mensaje.
   *
   * Si no se puede resolver, el trabajo **falla**. Procesarlo "a ver qué pasa"
   * escribiría datos de un cliente en la empresa equivocada, que es peor que
   * un job en la cola de fallidos.
   */
  async process(job: Job<InboundJob>): Promise<void> {
    const phoneNumberId = job.data.channelPhoneNumberId;
    const channel = phoneNumberId
      ? await this.connection.resolveChannel(phoneNumberId)
      : null;

    // El estado de una plantilla llega a nivel de WABA y sin número, así que
    // para ese caso la empresa se resuelve por el id de la cuenta.
    const porWaba =
      !channel && job.data.kind === "template_status" && job.data.wabaId
        ? await this.connection.resolveOrgByWaba(job.data.wabaId)
        : null;

    const orgId = channel?.orgId ?? porWaba?.orgId ?? null;

    // Entró por la ruta de una empresa (su propia app de Meta): el número
    // tiene que ser suyo. Se descarta sin reintentos: no es un fallo
    // transitorio, es alguien hablando de un número que no es suyo.
    if (job.data.orgId && orgId && orgId !== job.data.orgId) {
      const wabaId = job.data.kind === "template_status" ? job.data.wabaId : undefined;
      this.logger.warn(
        `Descartado: el webhook entró por la empresa ${job.data.orgId} pero el número ` +
          `${phoneNumberId ?? wabaId ?? "?"} pertenece a otra.`,
      );
      return;
    }

    if (!orgId) {
      if (tenancyMode === "multi") {
        throw new Error(
          `Evento de WhatsApp sin canal reconocible (phone_number_id: ${phoneNumberId ?? "ausente"}). ` +
            "No se puede saber de qué empresa es.",
        );
      }
      // Una sola empresa: no hay ambigüedad posible.
      return this.dispatch(job);
    }

    return runInOrg(orgId, () => this.dispatch(job));
  }

  private async dispatch(job: Job<InboundJob>): Promise<void> {
    const data = job.data;

    if (data.kind === "status") {
      await this.messaging.handleStatus(data.waMessageId, data.status);
      return;
    }

    // Coexistencia: mensaje enviado desde la app del celular.
    if (data.kind === "echo") {
      await this.messaging.handleEcho({
        to: data.to,
        waMessageId: data.waMessageId,
        type: data.type,
        text: data.text,
        channelPhoneNumberId: data.channelPhoneNumberId,
      });
      return;
    }

    if (data.kind === "reaction") {
      await this.messaging.handleReaction(data.targetWaMessageId, data.emoji);
      return;
    }

    if (data.kind === "history") {
      await this.messaging.handleHistory({
        customerWaId: data.customerWaId,
        fromCustomer: data.fromCustomer,
        waMessageId: data.waMessageId,
        type: data.type,
        text: data.text,
        timestampMs: data.timestampMs,
        channelPhoneNumberId: data.channelPhoneNumberId,
      });
      return;
    }

    if (data.kind === "state_sync") {
      await this.messaging.handleStateSync(data.items);
      return;
    }

    // Meta revisó una plantilla: aprobada, rechazada, pausada…
    if (data.kind === "template_status") {
      await this.templates.applyStatusUpdate(data);
      return;
    }

    // Mensaje entrante: si trae medio, descargarlo antes de persistir.
    let mediaUrl: string | undefined = data.mediaUrl;
    if (data.mediaId) {
      const media = await this.wa.downloadMedia(
        data.mediaId,
        data.channelPhoneNumberId,
      );
      mediaUrl = media.url;
    }

    await this.messaging.handleInbound({
      from: data.from,
      name: data.name,
      waMessageId: data.waMessageId,
      type: data.type,
      text: data.text,
      mediaUrl,
      channelPhoneNumberId: data.channelPhoneNumberId,
      // Anuncio Click-to-WhatsApp que originó la conversación.
      referral: data.referral,
      replyToWaMessageId: data.replyToWaMessageId,
      buttonPayload: data.buttonPayload,
    });
  }
}
