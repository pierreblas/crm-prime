import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { EmailTemplate, Prisma } from "@prisma/client";
import { emailAttachmentSchema, type EmailAttachment, type EmailTemplateDto, type EmailTemplateInput, type UpdateEmailTemplateInput } from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";

/** Adjuntos guardados en una fila (JSON): solo los que siguen teniendo la forma esperada. */
export function readAttachments(raw: unknown): EmailAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a) => {
    const parsed = emailAttachmentSchema.safeParse(a);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Plantillas de correo: asunto y cuerpo con {{variables}}, y adjuntos opcionales. */
@Injectable()
export class EmailTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async list(): Promise<EmailTemplateDto[]> {
    const rows = await this.prisma.emailTemplate.findMany({ orderBy: { name: "asc" } });
    return rows.map(toDto);
  }

  async create(input: EmailTemplateInput): Promise<EmailTemplateDto> {
    await this.assertNameFree(input.name);
    const row = await this.prisma.emailTemplate.create({
      data: {
        orgId: this.tenant.orgId(),
        name: input.name,
        subject: input.subject,
        body: input.body,
        attachments: input.attachments as unknown as Prisma.InputJsonValue,
      },
    });
    return toDto(row);
  }

  async update(id: string, input: UpdateEmailTemplateInput): Promise<EmailTemplateDto> {
    const existing = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Plantilla de correo no encontrada");
    if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) await this.assertNameFree(input.name);
    const row = await this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.attachments !== undefined ? { attachments: input.attachments as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    return toDto(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Plantilla de correo no encontrada");
    await this.prisma.emailTemplate.delete({ where: { id } });
    return { ok: true };
  }

  private async assertNameFree(name: string): Promise<void> {
    const taken = await this.prisma.emailTemplate.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (taken) throw new ConflictException("Ya hay una plantilla de correo con ese nombre");
  }
}

function toDto(r: EmailTemplate): EmailTemplateDto {
  return {
    id: r.id,
    name: r.name,
    subject: r.subject,
    body: r.body,
    attachments: readAttachments(r.attachments),
    updatedAt: r.updatedAt.toISOString(),
  };
}
