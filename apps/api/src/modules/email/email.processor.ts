import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { QUEUE_EMAIL } from "../../infra/queue/queue.constants";
import { runJobInOrg } from "../../infra/tenant/job-org";
import { EmailService, type EmailJob } from "./email.service";

/**
 * Correos automáticos (los que pide un flujo). Uno por trabajo, con el orgId
 * dentro. Un fallo pasajero del servidor de correo se reintenta con espera; en
 * el último intento el correo queda como fallido, con su motivo en el chat.
 * El ritmo va limitado: los buzones normales cortan a quien envía en ráfaga.
 */
@Processor(QUEUE_EMAIL, { concurrency: 2, limiter: { max: 40, duration: 60_000 } })
export class EmailProcessor extends WorkerHost {
  constructor(private readonly emails: EmailService) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { emailId, orgId } = job.data;
    if (!emailId) return;
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await runJobInOrg("correo", orgId, () => this.emails.deliver(emailId, final));
  }
}
