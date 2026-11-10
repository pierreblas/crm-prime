import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { QUEUE_META_MESSAGING } from "../../infra/queue/queue.constants";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";
import { runJobInOrg } from "../../infra/tenant/job-org";
import { MetaMessagingService } from "./meta-messaging.service";
import type { MetaMessagingJob } from "./meta-messaging.types";

@Processor(QUEUE_META_MESSAGING)
export class MetaMessagingProcessor extends WorkerHost {
  private readonly logger = new Logger("MetaMessagingProcessor");

  constructor(
    private readonly service: MetaMessagingService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  /**
   * El aviso trae solo el id de la cuenta que recibe: la página (Messenger) o
   * la cuenta de Instagram. Los dos son únicos globales y una página pertenece
   * a una sola empresa: de ahí sale el contexto. Esta consulta va sin filtrar
   * por necesidad, es la que produce el filtro. Si no se puede resolver, o la
   * empresa apagó ese canal, se descarta con rastro, no con reintentos.
   */
  async process(job: Job<MetaMessagingJob>): Promise<void> {
    const { platform, accountId } = job.data;
    const page = await runUnscoped("worker de Meta: empresa de la cuenta", () =>
      platform === "instagram"
        ? this.prisma.metaPage.findUnique({ where: { instagramId: accountId } })
        : this.prisma.metaPage.findUnique({ where: { pageId: accountId } }),
    );
    if (!page) {
      this.logger.warn(`Aviso de ${platform} para la cuenta ${accountId}, que no está conectada: descartado`);
      return;
    }
    const enabled = platform === "instagram" ? page.instagramEnabled : page.messengerEnabled;
    if (!enabled || !page.isActive) {
      this.logger.debug(`Aviso de ${platform} para ${page.name}: el canal está apagado`);
      return;
    }
    await runJobInOrg(`mensaje de ${platform}`, page.orgId, () => this.service.dispatch(job.data, page));
  }
}
