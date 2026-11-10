import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { QUEUE_PRODUCT_SYNC } from "../../infra/queue/queue.constants";
import { runJobInOrg } from "../../infra/tenant/job-org";
import { ProductSyncService, type ProductSyncJob } from "./product-sync.service";

/**
 * Una lectura de catálogo por trabajo. El orgId viaja en el propio trabajo
 * (lo puso quien lo encoló, con contexto). Dos a la vez como mucho: las
 * tiendas limitan las peticiones y una lectura grande puede tardar minutos.
 */
@Processor(QUEUE_PRODUCT_SYNC, { concurrency: 2 })
export class ProductSyncProcessor extends WorkerHost {
  private readonly logger = new Logger("ProductSyncProcessor");

  constructor(private readonly sync: ProductSyncService) {
    super();
  }

  async process(job: Job<ProductSyncJob>): Promise<void> {
    const { sourceId, orgId } = job.data;
    if (!sourceId) return;
    const result = await runJobInOrg("lectura de catálogo", orgId, () => this.sync.run(sourceId));
    if (result.skipped) {
      // Otra lectura iba por la mitad y puede no haber visto el cambio que motivó esta: una más, un poco después.
      this.logger.debug(`catálogo ${sourceId}: ya había una lectura en marcha; se repite en 20 s`);
      await this.sync.enqueue(sourceId, orgId, { delayMs: 20_000, tag: "retry" }).catch(() => undefined);
    }
  }
}
