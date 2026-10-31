import { namedTemplateVars } from "@crm/shared";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  type CreateTemplateInput,
  type SyncTemplatesResult,
  type TemplateButton,
  type TemplateCategory,
  type TemplateDto,
  type TemplateHeader,
  type TemplateStatusValue,
  type TemplateVariable,
  type UpdateTemplateInput,
  validateButtons,
} from "@crm/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import {
  STORAGE_PROVIDER,
  parseStorageRef,
  type StorageProvider,
} from "../../infra/storage/storage.provider";
import {
  MetaTemplateClient,
  countVariables,
  normalizeStatus,
  type MetaTemplate,
  type MetaTemplateComponent,
  type TemplateDefinition,
} from "./meta-template.client";
import { i18n } from "../../i18n/i18n";

@Injectable()
export class TemplateService {
  private readonly logger = new Logger("Templates");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly meta: MetaTemplateClient,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async list(): Promise<TemplateDto[]> {
    const rows = await this.prisma.template.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((t) => this.toDto(t));
  }

  async create(input: CreateTemplateInput): Promise<TemplateDto> {
    const buttonsError = validateButtons(input.buttons);
    if (buttonsError) throw new BadRequestException(buttonsError);
    this.assertVariablesMatch(input.body, input.variables);

    const duplicate = await this.prisma.template.findFirst({
      where: { name: input.name, language: input.language },
    });
    if (duplicate) {
      throw new BadRequestException(
        i18n("template.duplicate", { name: input.name, language: input.language }),
      );
    }

    const definition: TemplateDefinition = {
      name: input.name,
      language: input.language,
      category: input.category,
      header: input.header,
      body: input.body,
      footer: input.footer,
      buttons: input.buttons,
      variables: input.variables,
    };

    let waTemplateId: string | null = null;
    let status: TemplateStatusValue = "PENDING";
    if (input.submitToMeta) {
      const handle = await this.headerExampleHandle(input.header);
      const created = await this.meta.create(definition, handle);
      waTemplateId = created.id;
      status = created.status;
    }

    const row = await this.prisma.template.create({
      data: {
        orgId: this.tenant.orgId(),
        waTemplateId,
        name: input.name,
        language: input.language,
        category: input.category,
        status,
        header: (input.header ?? undefined) as unknown as Prisma.InputJsonValue,
        body: input.body,
        footer: input.footer,
        buttons: input.buttons as unknown as Prisma.InputJsonValue,
        variables: input.variables as unknown as Prisma.InputJsonValue,
        syncedAt: waTemplateId ? new Date() : null,
      },
    });
    return this.toDto(row);
  }

  async update(id: string, input: UpdateTemplateInput): Promise<TemplateDto> {
    const existing = await this.prisma.template.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Plantilla no encontrada");
    if (existing.readOnly) {
      throw new BadRequestException(
        "Esta plantilla se importó de Meta y usa componentes que el editor no cubre. Edítala en el panel de Meta.",
      );
    }
    if (input.body) {
      this.assertVariablesMatch(
        input.body,
        input.variables ?? (existing.variables as TemplateVariable[] | null) ?? [],
      );
    }
    if (input.buttons) {
      const buttonsError = validateButtons(input.buttons);
      if (buttonsError) throw new BadRequestException(buttonsError);
    }

    const row = await this.prisma.template.update({
      where: { id },
      data: {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.footer !== undefined ? { footer: input.footer } : {}),
        ...(input.header !== undefined
          ? { header: (input.header ?? undefined) as unknown as Prisma.InputJsonValue }
          : {}),
        ...(input.buttons !== undefined
          ? { buttons: input.buttons as unknown as Prisma.InputJsonValue }
          : {}),
        ...(input.variables !== undefined
          ? { variables: input.variables as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return this.toDto(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const t = await this.prisma.template.findUnique({
      where: { id },
      include: { _count: { select: { campaigns: true } } },
    });
    if (!t) throw new NotFoundException("Plantilla no encontrada");
    if (t._count.campaigns > 0) {
      throw new BadRequestException(
        "La plantilla se usa en una difusión. Elimina antes esa difusión.",
      );
    }
    if (t.waTemplateId) {
      await this.meta.remove(t.name, t.waTemplateId);
    }
    await this.prisma.template.delete({ where: { id } });
    return { ok: true };
  }

  /** Trae de Meta las plantillas de la cuenta y las refleja en el CRM. */
  async importFromMeta(): Promise<SyncTemplatesResult> {
    const remote = await this.meta.list();
    let imported = 0;
    let updated = 0;

    for (const t of remote) {
      const parsed = parseMetaTemplate(t);
      const existing = await this.prisma.template.findFirst({
        where: { OR: [{ waTemplateId: t.id }, { name: t.name, language: t.language }] },
      });
      const data = {
        waTemplateId: t.id,
        name: t.name,
        language: t.language,
        category: (t.category?.toUpperCase() ?? "MARKETING") as TemplateCategory,
        status: normalizeStatus(t.status),
        header: (parsed.header ?? undefined) as unknown as Prisma.InputJsonValue,
        body: parsed.body,
        footer: parsed.footer,
        buttons: parsed.buttons as unknown as Prisma.InputJsonValue,
        variables: parsed.variables as unknown as Prisma.InputJsonValue,
        rejectedReason: t.rejected_reason ?? null,
        readOnly: parsed.readOnly,
        syncedAt: new Date(),
      };
      if (existing) {
        await this.prisma.template.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await this.prisma.template.create({
          data: { ...data, orgId: this.tenant.orgId() },
        });
        imported++;
      }
    }

    this.logger.log(
      `Sincronización con Meta: ${imported} nuevas, ${updated} actualizadas`,
    );
    return { imported, updated, total: remote.length };
  }

  /**
   * Webhook `message_template_status_update`: Meta avisa cuando aprueba,
   * rechaza o pausa una plantilla.
   */
  async applyStatusUpdate(update: {
    waTemplateId?: string;
    name?: string;
    language?: string;
    status?: string;
    reason?: string | null;
    category?: string;
  }): Promise<void> {
    const where = update.waTemplateId
      ? { waTemplateId: update.waTemplateId }
      : update.name
        ? { name: update.name, language: update.language }
        : null;
    if (!where) return;

    const existing = await this.prisma.template.findFirst({ where });
    if (!existing) return;

    await this.prisma.template.update({
      where: { id: existing.id },
      data: {
        status: normalizeStatus(update.status),
        rejectedReason: update.reason ?? null,
        ...(update.category
          ? { category: update.category.toUpperCase() as TemplateCategory }
          : {}),
        syncedAt: new Date(),
      },
    });
    this.logger.log(
      `Plantilla ${existing.name} (${existing.language}) → ${normalizeStatus(update.status)}`,
    );
  }

  // ── Auxiliares ─────────────────────────────────────────────

  /** Sube a Meta el archivo de ejemplo del encabezado y devuelve su handle. */
  private async headerExampleHandle(
    header: TemplateHeader | null,
  ): Promise<string | undefined> {
    if (!header || header.format === "TEXT" || header.format === "LOCATION") {
      return undefined;
    }
    if (!header.example) {
      throw new BadRequestException(
        "Sube un archivo de ejemplo para el encabezado: Meta lo exige para aprobar la plantilla.",
      );
    }
    const storageId = parseStorageRef(header.example);
    if (!storageId) {
      throw new BadRequestException("El archivo de ejemplo no es válido.");
    }
    const file = await this.storage.read(storageId);
    if (!file) {
      throw new BadRequestException("El archivo de ejemplo ya no está disponible.");
    }
    return this.meta.uploadHeaderExample(
      file.buffer,
      file.mimeType,
      `ejemplo-${storageId}`,
    );
  }

  /** El cuerpo no puede tener huecos sin definir ni al revés. */
  private assertVariablesMatch(body: string, variables: TemplateVariable[]): void {
    const used = countVariables(body);
    const declared = variables.length;
    if (used !== declared) {
      throw new BadRequestException(
        i18n("template.variableMismatch", { used, declared }),
      );
    }
    const indexes = variables.map((v) => v.index).sort((a, b) => a - b);
    const consecutive = indexes.every((n, i) => n === i + 1);
    if (!consecutive) {
      throw new BadRequestException(
        "Las variables deben ir numeradas de forma consecutiva desde {{1}}.",
      );
    }
  }

  private toDto(t: {
    id: string;
    waTemplateId: string | null;
    name: string;
    language: string;
    category: string;
    status: string;
    header: unknown;
    body: string;
    footer: string | null;
    buttons: unknown;
    variables: unknown;
    rejectedReason: string | null;
    readOnly: boolean;
    syncedAt: Date | null;
    createdAt: Date;
  }): TemplateDto {
    return {
      id: t.id,
      waTemplateId: t.waTemplateId,
      name: t.name,
      language: t.language,
      category: t.category as TemplateCategory,
      status: t.status as TemplateStatusValue,
      header: (t.header as TemplateHeader | null) ?? null,
      body: t.body,
      footer: t.footer,
      buttons: (t.buttons as TemplateButton[] | null) ?? [],
      variables: variablesOf(t.body, t.variables),
      rejectedReason: t.rejectedReason,
      readOnly: t.readOnly,
      syncedAt: t.syncedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    };
  }
}

/**
 * Las variables guardadas o, si es una plantilla con variables con nombre
 * importada antes de que el CRM las entendiera (se guardó sin ninguna), las
 * que salen de su texto.
 */
function variablesOf(body: string, stored: unknown): TemplateVariable[] {
  const list = (stored as TemplateVariable[] | null) ?? [];
  if (list.length) return list;
  return namedTemplateVars(body).map((name, i) => ({ index: i + 1, label: name, name }));
}

/** Convierte los componentes de Meta al modelo del CRM. */
export function parseMetaTemplate(t: MetaTemplate): {
  header: TemplateHeader | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  variables: TemplateVariable[];
  readOnly: boolean;
} {
  let header: TemplateHeader | null = null;
  let body = "";
  let footer: string | null = null;
  const buttons: TemplateButton[] = [];
  // Carruseles, catálogo, OTP…: el editor no los cubre, se marcan de solo lectura.
  let readOnly = false;

  for (const c of t.components ?? []) {
    const type = c.type?.toUpperCase();
    if (type === "HEADER") {
      const format = (c.format ?? "TEXT").toUpperCase();
      if (format === "TEXT") header = { format: "TEXT", text: c.text ?? "" };
      else if (format === "LOCATION") header = { format: "LOCATION" };
      else if (format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT") {
        header = { format };
      } else readOnly = true;
    } else if (type === "BODY") {
      body = c.text ?? "";
    } else if (type === "FOOTER") {
      footer = c.text ?? null;
    } else if (type === "BUTTONS") {
      for (const b of c.buttons ?? []) {
        const parsed = parseMetaButton(b);
        if (parsed) buttons.push(parsed);
        else readOnly = true;
      }
    } else if (type) {
      readOnly = true;
    }
  }

  // Creada en Meta con variables con nombre ({{nombre}}): se rellenan por
  // orden de aparición y se envían con su nombre.
  const named = namedTemplateVars(body);
  const variables = named.length
    ? named.map((name, i) => ({ index: i + 1, label: name, name }))
    : Array.from({ length: countVariables(body) }, (_, i) => ({
        index: i + 1,
        label: `Variable ${i + 1}`,
      }));

  return { header, body, footer, buttons, variables, readOnly };
}

function parseMetaButton(b: Record<string, unknown>): TemplateButton | null {
  const type = String(b.type ?? "").toUpperCase();
  const text = typeof b.text === "string" ? b.text : "";
  switch (type) {
    case "QUICK_REPLY":
      return { type: "QUICK_REPLY", text };
    case "URL":
      return typeof b.url === "string"
        ? { type: "URL", text, url: b.url }
        : null;
    case "PHONE_NUMBER":
      return typeof b.phone_number === "string"
        ? { type: "PHONE_NUMBER", text, phoneNumber: b.phone_number }
        : null;
    case "COPY_CODE":
      return { type: "COPY_CODE", example: String(b.example ?? "") };
    default:
      return null; // OTP, FLOW, catálogo…
  }
}

/** Solo para tests y depuración: expone el armado de componentes. */
export type { MetaTemplateComponent };
