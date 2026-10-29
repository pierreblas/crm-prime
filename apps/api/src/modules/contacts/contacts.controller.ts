import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  contactCurrency,
  countryFromPhone,
  createContactSchema,
  setContactTagsSchema,
  updateContactSchema,
  utmKeys,
  type ContactDto,
  type ContactListItem,
  type ContactTagsDto,
  type CreateContactInput,
  type SetContactTagsInput,
  type UpdateContactInput,
} from "@crm/shared";
import { Prisma } from "@prisma/client";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { PlansService } from "../plans/plans.service";
import { PermissionsService } from "../permissions/permissions.service";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ContactImportService } from "./contact-import.service";
import { importContactsSchema, Role, type ImportContactsInput, type ImportContactsResult } from "@crm/shared";
import { maskPhone, type AccessTokenClaims } from "@crm/shared";

// Lo que necesita una fila del directorio (y la ficha del panel de la bandeja).
const LIST_INCLUDE = {
  tags: { include: { tag: true } },
  source: true,
  // Solo la conversación que trae anuncio: es la que da la atribución.
  conversations: {
    where: { referral: { not: Prisma.DbNull } },
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { referral: true },
  },
} satisfies Prisma.ContactInclude;
type ContactRow = Prisma.ContactGetPayload<{ include: typeof LIST_INCLUDE }>;

@Controller("contacts")
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly events: EventEmitter2,
    private readonly plans: PlansService,
    private readonly perms: PermissionsService,
    private readonly importer: ContactImportService,
  ) {}

  // Autocompletar (id/name/phone) — lo usa el pipeline.
  @Get()
  async list(@CurrentUser() user: AccessTokenClaims, @Query("search") search?: string): Promise<ContactDto[]> {
    const scope = await this.perms.contactWhere(user.sub);
    const rows = await this.prisma.contact.findMany({
      where: { AND: [search ? this.searchWhere(search) : {}, scope ?? {}] },
      orderBy: { lastMessageAt: "desc" },
      take: 20,
    });
    const phone = await this.phoneFor(user.sub);
    return rows.map((c) => ({ id: c.id, name: c.name, phone: phone(c.phone) }));
  }

  /** Sin permiso de ver el teléfono, se enmascara en todo lo que sale de aquí. */
  private async phoneFor(userId: string): Promise<(p: string) => string> {
    return (await this.perms.canSeePhone(userId)) ? (p) => p : maskPhone;
  }

  // Directorio completo para la sección de Contactos.
  @Get("directory")
  async directory(
    @CurrentUser() user: AccessTokenClaims,
    @Query("search") search?: string,
  ): Promise<ContactListItem[]> {
    const scope = await this.perms.contactWhere(user.sub);
    const rows = await this.prisma.contact.findMany({
      where: { AND: [search ? this.searchWhere(search) : {}, scope ?? {}] },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      take: 200,
      include: LIST_INCLUDE,
    });
    const phone = await this.phoneFor(user.sub);
    return rows.map((c) => ({ ...this.toListItem(c), phone: phone(c.phone) }));
  }

  // Ficha de un contacto: lo mismo que una fila del directorio, para el panel
  // de la bandeja (que solo tiene el id de la conversación).
  @Get(":id")
  async one(@CurrentUser() user: AccessTokenClaims, @Param("id") id: string): Promise<ContactListItem> {
    const scope = await this.perms.contactWhere(user.sub);
    const c = await this.prisma.contact.findFirst({ where: { id, ...(scope ?? {}) }, include: LIST_INCLUDE });
    if (!c) throw new NotFoundException("Contacto no encontrado");
    const phone = await this.phoneFor(user.sub);
    return { ...this.toListItem(c), phone: phone(c.phone) };
  }

  /**
   * Etiquetas del contacto como conjunto final. Las que no existan se crean
   * (sin color); las que ya no vengan se quitan. Cada alta dispara
   * `contact.tagged`, igual que cuando etiqueta el agente de IA, para que los
   * flujos con disparador "etiqueta añadida" también arranquen desde aquí.
   */
  @Put(":id/tags")
  async setTags(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setContactTagsSchema)) body: SetContactTagsInput,
  ): Promise<ContactTagsDto> {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: { tags: { include: { tag: true } } },
    });
    if (!contact) throw new NotFoundException("Contacto no encontrado");
    const orgId = this.tenant.orgId();

    // Sin duplicados por mayúsculas: "VIP" y "vip" son la misma etiqueta.
    const wanted = new Map<string, string>();
    for (const raw of body.tags) {
      const name = raw.trim();
      if (name && !wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
    }
    const current = new Map(contact.tags.map((ct) => [ct.tag.name.toLowerCase(), ct.tag]));

    const added: { id: string; name: string }[] = [];
    for (const [key, name] of wanted) {
      if (current.has(key)) continue;
      const tag =
        (await this.prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) ??
        (await this.prisma.tag.create({ data: { orgId, name } }));
      await this.prisma.contactTag.upsert({
        where: { contactId_tagId: { contactId: id, tagId: tag.id } },
        create: { contactId: id, tagId: tag.id },
        update: {},
      });
      added.push({ id: tag.id, name: tag.name });
    }
    const removed = [...current.entries()].filter(([key]) => !wanted.has(key)).map(([, tag]) => tag.id);
    if (removed.length) {
      await this.prisma.contactTag.deleteMany({ where: { contactId: id, tagId: { in: removed } } });
    }
    for (const tag of added) {
      this.events.emit("contact.tagged", { orgId, contactId: id, tag: tag.name });
    }

    const rows = await this.prisma.contactTag.findMany({
      where: { contactId: id },
      include: { tag: true },
      orderBy: { assignedAt: "asc" },
    });
    return rows.map((ct) => ({ id: ct.tag.id, name: ct.tag.name, color: ct.tag.color }));
  }

  private toListItem(c: ContactRow): ContactListItem {
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      optIn: c.optIn,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      tags: c.tags.map((ct) => ({ name: ct.tag.name, color: ct.tag.color })),
      source: c.source
        ? { id: c.source.id, name: c.source.name, color: c.source.color }
        : null,
      origin: (c.origin ?? "manual") as ContactListItem["origin"],
      originDetail: c.originDetail,
      attribution: {
        utms: this.utmsFrom(c.metadata),
        ad: this.adFrom(c.conversations[0]?.referral),
      },
      // Sin los utm_*: van en `attribution`, y si salieran también aquí el
      // panel los reescribiría como si fueran campos editables del negocio.
      fields: this.businessFields(c.metadata),
      country: (() => {
        const k = countryFromPhone(c.phone);
        return k ? { code: k.code, name: k.name } : null;
      })(),
      currency: contactCurrency(c),
      currencyOverride: c.currency,
    };
  }

  // Los utm_* viven en metadata junto a los campos personalizados, pero son
  // otra cosa: datos de marketing que nadie edita a mano. Se separan aquí
  // para que la UI pueda tratarlos como lo que son.
  private utmsFrom(metadata: unknown): Record<string, string> {
    const all = this.fieldsFrom(metadata);
    const out: Record<string, string> = {};
    for (const key of utmKeys) {
      if (all[key]) out[key] = all[key];
    }
    return out;
  }

  private businessFields(metadata: unknown): Record<string, string> {
    const all = this.fieldsFrom(metadata);
    for (const key of utmKeys) delete all[key];
    return all;
  }

  private adFrom(referral: unknown): ContactListItem["attribution"]["ad"] {
    if (!referral || typeof referral !== "object") return null;
    const r = referral as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      sourceId: str(r.sourceId),
      headline: str(r.headline),
      body: str(r.body),
      sourceUrl: str(r.sourceUrl),
      ctwaClid: str(r.ctwaClid),
    };
  }

  /** Importar desde Excel o CSV (filas ya validadas en el navegador). */
  @Post("import")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  importContacts(@Body(new ZodValidationPipe(importContactsSchema)) body: ImportContactsInput): Promise<ImportContactsResult> {
    return this.importer.import(body);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createContactSchema)) body: CreateContactInput,
  ): Promise<{ id: string }> {
    // Ya viene normalizado a E.164 por el esquema (phoneField).
    const phone = body.phone;
    const existing = await this.prisma.contact.findFirst({ where: { phone } });
    if (existing) {
      throw new ConflictException("Ya existe un contacto con ese teléfono");
    }
    await this.plans.assertCanAdd("contacts");
    const c = await this.prisma.contact.create({
      data: {
        orgId: this.tenant.orgId(),
        phone,
        name: body.name,
        sourceId: body.sourceId,
        origin: "manual",
      },
    });
    return { id: c.id };
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateContactSchema)) body: UpdateContactInput,
  ): Promise<{ ok: true }> {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Contacto no encontrado");

    // Campos personalizados: fusionar con la metadata existente.
    const metadata =
      body.fields !== undefined
        ? ({
            ...this.fieldsFrom(existing.metadata),
            ...body.fields,
          } as Prisma.InputJsonValue)
        : undefined;

    await this.prisma.contact.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.optIn !== undefined ? { optIn: body.optIn } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
    });
    return { ok: true };
  }

  private fieldsFrom(metadata: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (metadata && typeof metadata === "object") {
      for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
        if (v != null) out[k] = String(v);
      }
    }
    return out;
  }

  private searchWhere(search: string) {
    return {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search } },
      ],
    };
  }
}
