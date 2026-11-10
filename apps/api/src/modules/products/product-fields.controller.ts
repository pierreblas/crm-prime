import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import type { ProductField } from "@prisma/client";
import {
  createProductFieldSchema,
  isListFieldType,
  productFieldKey,
  productFieldTypes,
  reorderProductFieldsSchema,
  Role,
  updateProductFieldSchema,
  type ProductFieldDto,
  type ProductFieldType,
} from "@crm/shared";
import type { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";

type CreateBody = z.output<typeof createProductFieldSchema>;
type UpdateBody = z.output<typeof updateProductFieldSchema>;

const MAX_FIELDS = 50;

/**
 * Campos personalizados del catálogo. Son libres: el negocio decide qué datos
 * tienen sus productos, servicios o talleres (talla, duración, cupos…).
 *
 * Borrar un campo no toca los productos: su valor se queda guardado y
 * simplemente deja de mostrarse. Volver a crearlo con el mismo nombre lo
 * recupera.
 */
@Controller("product-fields")
@UseGuards(JwtAuthGuard)
export class ProductFieldsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  @Get()
  async list(): Promise<ProductFieldDto[]> {
    const rows = await this.prisma.productField.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
    return rows.map(toDto);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async create(@Body(new ZodValidationPipe(createProductFieldSchema)) body: CreateBody): Promise<ProductFieldDto> {
    const count = await this.prisma.productField.count();
    if (count >= MAX_FIELDS) throw new BadRequestException(`Máximo ${MAX_FIELDS} campos`);
    assertOptions(body.type, body.options);
    if (body.key && (await this.prisma.productField.findFirst({ where: { key: body.key } }))) {
      throw new ConflictException(`Ya hay un campo con la clave «${body.key}»`);
    }
    const key = body.key ?? (await this.uniqueKey(slug(body.label)));
    const f = await this.prisma.productField.create({
      data: {
        orgId: this.tenant.orgId(),
        key,
        label: body.label,
        type: body.type,
        options: isListFieldType(body.type) ? body.options : [],
        unit: body.type === "number" ? body.unit : null,
        help: body.help,
        required: body.required,
        showOnCard: body.showOnCard,
        aiVisible: body.aiVisible,
        order: count,
      },
    });
    return toDto(f);
  }

  /** La clave propuesta, esquivando las que ya existen: talla, talla_2, talla_3… */
  private async uniqueKey(base: string): Promise<string> {
    let key = base;
    for (let i = 2; await this.prisma.productField.findFirst({ where: { key } }); i++) key = `${base}_${i}`;
    return key;
  }

  /** Nuevo orden: la lista completa de ids, de primero a último. */
  @Put("order")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async reorder(@Body(new ZodValidationPipe(reorderProductFieldsSchema)) body: { ids: string[] }): Promise<ProductFieldDto[]> {
    await this.prisma.$transaction(
      body.ids.map((id, order) => this.prisma.productField.updateMany({ where: { id }, data: { order } })),
    );
    return this.list();
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductFieldSchema)) body: UpdateBody,
  ): Promise<ProductFieldDto> {
    const existing = await this.prisma.productField.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Campo no encontrado");
    const type = body.type ?? (existing.type as ProductFieldType);
    const options = body.options ?? existing.options;
    assertOptions(type, options);
    const f = await this.prisma.productField.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        type,
        options: isListFieldType(type) ? options : [],
        unit: type === "number" ? (body.unit !== undefined ? body.unit : existing.unit) : null,
        ...(body.help !== undefined ? { help: body.help } : {}),
        ...(body.required !== undefined ? { required: body.required } : {}),
        ...(body.showOnCard !== undefined ? { showOnCard: body.showOnCard } : {}),
        ...(body.aiVisible !== undefined ? { aiVisible: body.aiVisible } : {}),
      },
    });
    return toDto(f);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async remove(@Param("id") id: string): Promise<{ ok: true }> {
    const f = await this.prisma.productField.findUnique({ where: { id } });
    if (!f) throw new NotFoundException("Campo no encontrado");
    await this.prisma.productField.delete({ where: { id } });
    return { ok: true };
  }
}

function assertOptions(type: string, options: string[]) {
  if (isListFieldType(type) && options.length === 0) {
    throw new BadRequestException("Una lista necesita al menos una opción");
  }
}

// La clave que se propone cuando no se elige una: la misma regla que ve el usuario y que usan los conectores (@crm/shared).
function slug(label: string): string {
  return productFieldKey(label);
}

function toDto(f: ProductField): ProductFieldDto {
  return {
    id: f.id,
    key: f.key,
    label: f.label,
    type: (productFieldTypes as readonly string[]).includes(f.type) ? (f.type as ProductFieldType) : "text",
    options: f.options,
    unit: f.unit,
    help: f.help,
    required: f.required,
    showOnCard: f.showOnCard,
    aiVisible: f.aiVisible,
    order: f.order,
  };
}
