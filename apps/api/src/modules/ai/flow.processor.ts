import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { QUEUE_FLOW } from "../../infra/queue/queue.constants";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runUnscoped } from "../../infra/tenant/tenant.context";
import { runJobInOrg } from "../../infra/tenant/job-org";
import { FlowEngineService } from "./flow-engine.service";
import { StageAutomationsService, type StageDelayedJob, type StageNoReplyJob } from "./stage-automations.service";

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

  async process(job: Job<FlowResumeJob | StageNoReplyJob | StageDelayedJob>): Promise<void> {
    // «Pasa tiempo sin respuesta» de una automatización de etapa.
    if (job.name === "stage_no_reply") {
      const data = job.data as StageNoReplyJob;
      await runJobInOrg("automatización de etapa", data.orgId, () => this.stageAutomations.checkNoReply(data));
      return;
    }
    if (job.name === "bulk_flow") {
      const data = job.data as unknown as { orgId: string; flowId: string; contactId: string };
      await runJobInOrg("flujo desde el tablero", data.orgId, () => this.stageAutomations.runBulkFlow(data));
      return;
    }
    // «Entra a la etapa» con espera, o «aplicar a los que ya están»: misma comprobación al vencer.
    if (job.name === "stage_enter_delay" || job.name === "stage_apply") {
      const data = job.data as StageDelayedJob;
      await runJobInOrg("automatización de etapa", data.orgId, () => this.stageAutomations.checkStillInStage(data));
      return;
    }
    const resume = job.data as FlowResumeJob;
    const orgId =
      resume.orgId ??
      // Trabajo anterior al cambio: la empresa se deduce de la conversación.
      // Consulta sin filtrar por necesidad: es la que produce el filtro.
      (
        await runUnscoped("worker de flujos: empresa de la conversación", () =>
          this.prisma.conversation.findUnique({
            where: { id: resume.conversationId },
            select: { orgId: true },
          }),
        )
      )?.orgId;

    await runJobInOrg("flujo", orgId, () =>
      job.name === "no_reply" && resume.messageId
        ? this.engine.checkNoReply(resume.conversationId, resume.messageId)
        : this.engine.resumeTimer(resume.conversationId),
    );
  }
}
