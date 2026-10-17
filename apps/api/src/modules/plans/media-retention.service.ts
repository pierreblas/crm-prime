import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { planFor } from "@crm/shared";
import { env } from "../../common/utils/env";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { STORAGE_PROVIDER, parseStorageRef, type StorageProvider } from "../../infra/storage/storage.provider";
import { runUnscoped, tenancyMode } from "../../infra/tenant/tenant.context";

const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const SWEEP_FIRST_MS = 5 * 60 * 1000;
const BATCH = 200;

/**
 * Retención de adjuntos por plan.
 *
 * Es la única forma en que el plan toca el disco: en vez de vender gigas, cada
 * plan dice cuánto tiempo se guardan los archivos de los mensajes (fotos,
 * audios, documentos). Pasado el plazo, el archivo se borra del almacén y el
 * mensaje se queda con su texto y la marca `mediaPurgedAt`, que la bandeja
 * muestra como «adjunto eliminado por la retención del plan».
 *
 * Solo en la nube (modo multi): en una instalación propia el disco es del
 * cliente y no se borra nada. Barre cada seis horas, en lotes, empresa a
 * empresa, con runUnscoped porque cruza todas.
 */
@Injectable()
export class MediaRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("RetencionMedios");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onModuleInit(): void {
    if (tenancyMode !== "multi" || env("MEDIA_RETENTION_SWEEP") === "off") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    setTimeout(() => void this.sweep(), SWEEP_FIRST_MS).unref();
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Una pasada por todas las empresas. Devuelve cuántos adjuntos borró. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await runUnscoped("retención de adjuntos", async () => {
        const orgs = await this.prisma.organization.findMany({ select: { id: true, plan: true, name: true } });
        let total = 0;
        for (const org of orgs) {
          const days = planFor(org.plan).mediaRetentionDays;
          if (days === null) continue;
          const n = await this.purgeOrg(org.id, days);
          if (n > 0) this.log.log(`${org.name}: ${n} adjuntos borrados (más de ${days} días, plan ${planFor(org.plan).name})`);
          total += n;
        }
        return total;
      });
    } catch (e) {
      this.log.error(`Barrido de retención: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Borra los adjuntos de una empresa anteriores al plazo, en lotes. */
  async purgeOrg(orgId: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let total = 0;
    for (;;) {
      const batch = await this.prisma.message.findMany({
        where: { orgId, mediaUrl: { startsWith: "storage://" }, mediaPurgedAt: null, createdAt: { lt: cutoff } },
        select: { id: true, mediaUrl: true },
        orderBy: { createdAt: "asc" },
        take: BATCH,
      });
      if (batch.length === 0) return total;
      for (const m of batch) {
        const id = parseStorageRef(m.mediaUrl);
        if (id) await this.storage.remove(id).catch(() => undefined);
      }
      await this.prisma.message.updateMany({
        where: { id: { in: batch.map((m) => m.id) } },
        data: { mediaUrl: null, mediaPurgedAt: new Date() },
      });
      total += batch.length;
      if (batch.length < BATCH) return total;
    }
  }
}
