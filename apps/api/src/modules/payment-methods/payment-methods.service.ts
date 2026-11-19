import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  PAYMENT_METHODS_MAX,
  type CreatePaymentMethodInput,
  type PaymentMethodDto,
  type UpdatePaymentMethodInput,
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
} from "@crm/shared";
import type { PaymentMethod } from "@prisma/client";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";

export function toPaymentMethodDto(m: PaymentMethod): PaymentMethodDto {
  return {
    id: m.id,
    name: m.name,
    countries: m.countries,
    details: m.details,
    instructions: m.instructions,
    imageUrl: m.imageUrl,
    isActive: m.isActive,
    order: m.order,
  };
}

/** Métodos de pago de la empresa (Ajustes › Métodos de pago). */
@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async list(): Promise<PaymentMethodDto[]> {
    const rows = await this.prisma.paymentMethod.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
    return rows.map(toPaymentMethodDto);
  }

  async create(raw: CreatePaymentMethodInput): Promise<PaymentMethodDto> {
    const input = createPaymentMethodSchema.parse(raw);
    const count = await this.prisma.paymentMethod.count();
    if (count >= PAYMENT_METHODS_MAX) throw new BadRequestException(`Como mucho ${PAYMENT_METHODS_MAX} métodos de pago`);
    const last = await this.prisma.paymentMethod.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
    const row = await this.prisma.paymentMethod.create({
      data: { ...input, orgId: this.tenant.orgId(), order: (last?.order ?? -1) + 1 },
    });
    return toPaymentMethodDto(row);
  }

  async update(id: string, raw: UpdatePaymentMethodInput): Promise<PaymentMethodDto> {
    const input = updatePaymentMethodSchema.parse(raw);
    await this.mustExist(id);
    const row = await this.prisma.paymentMethod.update({ where: { id }, data: input });
    return toPaymentMethodDto(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.mustExist(id);
    await this.prisma.paymentMethod.delete({ where: { id } });
    return { ok: true };
  }

  /** Nuevo orden de la lista (los ids en el orden que se quieren). */
  async reorder(ids: string[]): Promise<PaymentMethodDto[]> {
    const rows = await this.prisma.paymentMethod.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (rows.length !== new Set(ids).size) throw new NotFoundException("Método de pago no encontrado");
    await this.prisma.$transaction(ids.map((id, order) => this.prisma.paymentMethod.update({ where: { id }, data: { order } })));
    return this.list();
  }

  private async mustExist(id: string): Promise<void> {
    const row = await this.prisma.paymentMethod.findFirst({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException("Método de pago no encontrado");
  }
}
