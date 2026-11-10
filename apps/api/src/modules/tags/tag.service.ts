import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateTagInput, TagDto, UpdateTagInput } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";

@Injectable()
export class TagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async list(): Promise<TagDto[]> {
    const rows = await this.prisma.tag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { contacts: true } } },
    });
    return rows.map((t) => this.toDto(t));
  }

  async create(input: CreateTagInput): Promise<TagDto> {
    const orgId = this.tenant.orgId();
    const name = input.name.trim();
    const existing = await this.prisma.tag.findFirst({ where: { name } });
    if (existing) throw new ConflictException("Ya existe una etiqueta con ese nombre");
    const t = await this.prisma.tag.create({
      data: { orgId, name, color: input.color },
      include: { _count: { select: { contacts: true } } },
    });
    return this.toDto(t);
  }

  async update(id: string, input: UpdateTagInput): Promise<TagDto> {
    const existing = await this.prisma.tag.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Etiqueta no encontrada");

    if (input.name && input.name.trim() !== existing.name) {
      const dup = await this.prisma.tag.findFirst({
        where: { name: input.name.trim() },
      });
      if (dup) throw new ConflictException("Ya existe una etiqueta con ese nombre");
    }

    const t = await this.prisma.tag.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
      include: { _count: { select: { contacts: true } } },
    });
    return this.toDto(t);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const t = await this.prisma.tag.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Etiqueta no encontrada");
    // El join ContactTag tiene onDelete: Cascade → se limpian las relaciones.
    await this.prisma.tag.delete({ where: { id } });
    return { ok: true };
  }

  private toDto(t: {
    id: string;
    name: string;
    color: string | null;
    waLabelId?: string | null;
    _count: { contacts: number };
  }): TagDto {
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      contactCount: t._count.contacts,
      waLabel: !!t.waLabelId,
    };
  }
}
