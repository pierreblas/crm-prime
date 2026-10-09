import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import {
  simulateInboundSchema,
  MessageType,
  type SimulateInboundInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { QUEUE_INBOUND } from "../../infra/queue/queue.constants";
import { STORAGE_PROVIDER, type StorageProvider } from "../../infra/storage/storage.provider";
import type { InboundMessageJob } from "./webhook.types";

/**
 * Inyecta un mensaje entrante sintético en el mismo pipeline que el webhook.
 * Permite probar la Fase 1 sin credenciales de Meta.
 */
@Controller("whatsapp/dev")
@UseGuards(JwtAuthGuard)
export class DevController {
  constructor(
    @InjectQueue(QUEUE_INBOUND) private readonly inbound: Queue,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Post("simulate-inbound")
  async simulate(
    @Body(new ZodValidationPipe(simulateInboundSchema))
    body: SimulateInboundInput,
  ): Promise<{ queued: true; waMessageId: string }> {
    // Con imagen: se guarda en el almacén como haría la descarga de Meta y el
    // mensaje entra como IMAGE (el texto, si lo hay, es el pie de foto).
    let mediaUrl: string | undefined;
    if (body.image) {
      const { buffer, mime } = await this.loadImage(body.image);
      const stored = await this.storage.save(buffer, mime, `sim-${randomUUID()}`);
      mediaUrl = `storage://${stored.id}`;
    }
    const job: InboundMessageJob = {
      kind: "message",
      from: body.phone,
      name: body.name,
      waMessageId: `wamid.sim.${randomUUID()}`,
      type: mediaUrl ? MessageType.IMAGE : MessageType.TEXT,
      text: body.text?.trim() || undefined,
      mediaUrl,
    };
    await this.inbound.add("message", job);
    return { queued: true, waMessageId: job.waMessageId };
  }

  private async loadImage(src: string): Promise<{ buffer: Buffer; mime: string }> {
    const data = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(src);
    if (data) return { buffer: Buffer.from(data[2]!, "base64"), mime: data[1]!.toLowerCase() };
    if (!/^https?:\/\//i.test(src)) throw new BadRequestException("image debe ser una URL http(s) o un data:image/…;base64");
    const res = await fetch(src);
    if (!res.ok) throw new BadRequestException(`No se pudo descargar la imagen (${res.status})`);
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
    return { buffer: Buffer.from(await res.arrayBuffer()), mime };
  }
}
