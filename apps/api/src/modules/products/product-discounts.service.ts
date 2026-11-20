import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { runInOrg, runUnscoped } from "../../infra/tenant/tenant.context";
import { env } from "../../common/utils/env";

/** Cada cuánto se mira si venció algún descuento. */
const SWEEP_EVERY_MS = 5 * 60_000;
/** Productos por pasada; si hubiera más, la siguiente sigue. */
const BATCH = 500;

/**
 * Descuentos vencidos: al pasar `saleEndsAt`, el producto vuelve a su precio
 * normal. Quien lee un precio ya trata el descuento vencido como precio normal
 * (productPricing en @crm/shared); este barrido deja además la fila como debe
 * (`price` = el normal, sin `regularPrice` ni fecha), para que los filtros y el
 * orden por precio en SQL vuelvan a ser exactos.
 *
 * También en productos de una tienda conectada: la tienda mandará su precio en
 * la siguiente sincronización, pero mientras tanto no se ofrece algo vencido.
 * Se apaga con PRODUCT_DISCOUNT_SWEEP=off.
 */
@Injectable()
export class ProductDiscountsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Descuentos");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (env("PRODUCT_DISCOUNT_SWEEP") === "off") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Restaura lo vencido en todas las empresas. Devuelve cuántos productos tocó. */
  async sweep(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await runUnscoped("descuentos vencidos", () =>
        this.prisma.product.findMany({
          where: { saleEndsAt: { lte: now } },
          select: { id: true, orgId: true, price: true, regularPrice: true },
          orderBy: { saleEndsAt: "asc" },
          take: BATCH,
        }),
      );
      let restored = 0;
      for (const p of due) {
        try {
          await runInOrg(p.orgId, () => this.restore(p));
          restored++;
        } catch (e) {
          this.logger.error(`No se pudo restaurar el precio de ${p.id}: ${(e as Error).message}`);
        }
      }
      if (restored) this.logger.log(`${restored} ${restored === 1 ? "descuento vencido: vuelve" : "descuentos vencidos: vuelven"} a su precio normal`);
      return restored;
    } catch (e) {
      this.logger.error(`Barrido de descuentos: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Un producto vencido: su precio y el de cada moneda rebajada vuelven al normal. */
  private async restore(p: { id: string; price: unknown; regularPrice: unknown }): Promise<void> {
    const back = p.regularPrice != null && Number(p.regularPrice) > Number(p.price);
    await this.prisma.product.update({
      where: { id: p.id },
      data: { ...(back ? { price: p.regularPrice as never } : {}), regularPrice: null, saleEndsAt: null },
    });
    const prices = await this.prisma.productPrice.findMany({
      where: { productId: p.id, regularAmount: { not: null } },
      select: { id: true, amount: true, regularAmount: true },
    });
    for (const x of prices) {
      const up = Number(x.regularAmount) > Number(x.amount);
      await this.prisma.productPrice.update({
        where: { id: x.id },
        data: { ...(up ? { amount: x.regularAmount as never } : {}), regularAmount: null },
      });
    }
  }
}
