import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import {
  MessageAuthor,
  MessageDirection,
  MessageStatus,
  MessageType,
  type TemplateButton,
  type TemplateHeader,
} from "@crm/shared";
import { QUEUE_CAMPAIGN } from "../../infra/queue/queue.constants";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";
import { runJobInOrg } from "../../infra/tenant/job-org";
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from "../whatsapp/whatsapp-provider.interface";
import { CampaignService } from "./campaign.service";
import { TemplateFillService, normalizeFill } from "./template-fill.service";

// `orgId` lo pone quien encola. Los trabajos anteriores al cambio no lo traen
// y la empresa se deduce de la plantilla de la campaña.
type CampaignJob =
  | { kind: "launch"; campaignId: string; orgId?: string }
  | { kind: "send"; campaignId: string; contactId: string; orgId?: string };

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Throttling: como máximo 10 envíos por segundo (respeta rate limits de Meta).
@Processor(QUEUE_CAMPAIGN, {
  concurrency: 5,
  limiter: { max: 10, duration: 1000 },
})
export class CampaignProcessor extends WorkerHost {
  private readonly logger = new Logger("CampaignProcessor");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly campaigns: CampaignService,
    private readonly fills: TemplateFillService,
    @Inject(WHATSAPP_PROVIDER) private readonly wa: WhatsAppProvider,
  ) {
    super();
  }

  async process(job: Job<CampaignJob>): Promise<void> {
    const orgId = job.data.orgId ?? (await this.orgDeCampana(job.data.campaignId));
    await runJobInOrg("campaña", orgId, async () => {
      if (job.data.kind === "launch") {
        await this.campaigns.fanOut(job.data.campaignId);
        return;
      }
      await this.sendOne(job.data.campaignId, job.data.contactId);
    });
  }

  /**
   * Una campaña no lleva `orgId` propio (cuelga de su plantilla, que sí). Se
   * consulta sin filtrar por necesidad: es la que produce el filtro.
   */
  private async orgDeCampana(campaignId: string): Promise<string | null> {
    const c = await runUnscoped("worker de campañas: empresa de la campaña", () =>
      this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { template: { select: { orgId: true } } },
      }),
    );
    return c?.template?.orgId ?? null;
  }

  private async sendOne(campaignId: string, contactId: string): Promise<void> {
    const [campaign, contact] = await Promise.all([
      this.prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { template: true, channel: true },
      }),
      this.prisma.contact.findUnique({ where: { id: contactId } }),
    ]);
    if (!campaign || !contact) return;
    if (campaign.status === "CANCELLED") return;
    if (!contact.optIn) return; // respeta opt-out

    const fill = normalizeFill(campaign.variableValues);
    const spec = await this.fills.build(
      {
        name: campaign.template.name,
        language: campaign.template.language,
        header: (campaign.template.header as TemplateHeader | null) ?? null,
        buttons: (campaign.template.buttons as TemplateButton[] | null) ?? [],
        body: campaign.template.body,
      },
      fill,
      contact,
      campaign.channel?.phoneNumberId,
    );
    // El renderizado pasó a `fills.preview` en la rama de plantillas.
    const preview = this.fills.preview(campaign.template.body, spec);
    // Esto corre en un worker, sin petición HTTP detrás: la organización sale
    // del propio contacto, no del contexto.
    const orgId = contact.orgId;
    const conversationId = await this.ensureConversation(
      orgId,
      contactId,
      campaign.channelId,
    );

    const message = await this.prisma.message.create({
      data: {
        orgId,
        conversationId,
        campaignId,
        templateId: campaign.templateId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEMPLATE,
        author: MessageAuthor.HUMAN,
        content: preview,
        status: MessageStatus.QUEUED,
      },
    });

    try {
      const res = await this.wa.sendTemplate(
        contact.phone,
        spec,
        campaign.channel?.phoneNumberId,
      );
      await this.prisma.message.update({
        where: { id: message.id },
        data: { waMessageId: res.waMessageId, status: MessageStatus.SENT },
      });
    } catch (e) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.FAILED,
          errorReason: (e as Error).message.slice(0, 500),
        },
      });
      this.logger.warn(
        `Envío de difusión falló a ${contact.phone}: ${(e as Error).message}`,
      );
    }

    // Cifras recalculadas desde los mensajes (un reintento sustituye al fallo).
    await this.campaigns.refreshStats(campaignId);
    await this.campaigns.checkCompletion(campaignId);
  }

  // Reusa la conversación abierta del contacto o crea una nueva.
  private async ensureConversation(
    orgId: string,
    contactId: string,
    channelId: string | null,
  ): Promise<string> {
    const open = await this.prisma.conversation.findFirst({
      where: { contactId, status: { not: "CLOSED" } },
      orderBy: { createdAt: "desc" },
    });
    if (open) return open.id;
    const created = await this.prisma.conversation.create({
      data: {
        orgId,
        contactId,
        channelId,
        status: "OPEN",
        windowExpiresAt: new Date(Date.now() + WINDOW_MS),
        lastMessageAt: new Date(),
      },
    });
    return created.id;
  }
}
