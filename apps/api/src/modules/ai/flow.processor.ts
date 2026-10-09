import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { QUEUE_FLOW } from "../../infra/queue/queue.constants";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";
import { runJobInOrg } from "../../infra/tenant/job-org";
import { FlowEngineService } from "./flow-engine.service";
import { StageAutomationsService, type StageNoReplyJob } from "./stage-automations.service";

interface FlowResumeJob {
  conversationId: string;
  /** Lo pone quien encola. Los trabajos anteriores al cambio no lo traen. */
  orgId?: string;
  /** Solo en "no_reply": el mensaje nuestro que el cliente tendría que haber contestado. */
  messageId?: string;
}

@Processor(QUEUE_FLOW)
export class FlowProcessor extends WorkerHost {
  constructor(
    private readonly engine: FlowEngineService,
    private readonly stageAutomations: StageAutomationsService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<FlowResumeJob | StageNoReplyJob>): Promise<void> {
    // «Pasa tiempo sin respuesta» de una automatización de etapa.
    if (job.name === "stage_no_reply") {
      const data = job.data as StageNoReplyJob;
      await runJobInOrg("automatización de etapa", data.orgId, () => this.stageAutomations.checkNoReply(data));
      return;
    }
    const orgId =
      job.data.orgId ??
      // Trabajo anterior al cambio: la empresa se deduce de la conversación.
      // Consulta sin filtrar por necesidad: es la que produce el filtro.
      (
        await runUnscoped("worker de flujos: empresa de la conversación", () =>
          this.prisma.conversation.findUnique({
            where: { id: job.data.conversationId },
            select: { orgId: true },
          }),
        )
      )?.orgId;

    await runJobInOrg("flujo", orgId, () =>
      job.name === "no_reply" && job.data.messageId
        ? this.engine.checkNoReply(job.data.conversationId, job.data.messageId)
        : this.engine.resumeTimer(job.data.conversationId),
    );
  }
}
