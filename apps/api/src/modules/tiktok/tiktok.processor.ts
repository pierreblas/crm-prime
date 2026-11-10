import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { QUEUE_TIKTOK } from "../../infra/queue/queue.constants";
import { runJobInOrg } from "../../infra/tenant/job-org";
import { TikTokAccountService } from "./tiktok-account.service";
import { TikTokMessagingService, type TikTokEvent } from "./tiktok-messaging.service";

@Processor(QUEUE_TIKTOK)
export class TikTokProcessor extends WorkerHost {
  private readonly logger = new Logger("TikTokProcessor");

  constructor(
    private readonly accounts: TikTokAccountService,
    private readonly service: TikTokMessagingService,
  ) {
    super();
  }

  /**
   * El aviso trae solo el open_id de la cuenta (user_openid), único global y
   * de una sola empresa: de ahí sale el contexto. Si la cuenta no está (se
   * desconectó mientras el aviso esperaba) o está apagada, se descarta con
   * rastro, no con reintentos.
   */
  async process(job: Job<TikTokEvent>): Promise<void> {
    const businessId = job.data.user_openid;
    if (!businessId) return;
    const account = await this.accounts.resolveByBusinessId(businessId);
    if (!account) {
      this.logger.warn(`Aviso de TikTok para la cuenta ${businessId}, que no está conectada: descartado`);
      return;
    }
    if (!account.isActive) {
      this.logger.debug(`Aviso de TikTok para @${account.username ?? businessId}: la cuenta está apagada`);
      return;
    }
    await runJobInOrg("mensaje de TikTok", account.orgId, () => this.service.dispatch(job.data, account));
  }
}
