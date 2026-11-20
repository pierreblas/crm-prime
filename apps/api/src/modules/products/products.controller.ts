import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createProductSchema,
  importProductsSchema,
  parseProductListQuery,
  productBulkSchema,
  updateProductSchema,
  type CreateProductInput,
  type ImportProductsInput,
  type ImportProductsResult,
  type ProductBulkInput,
  type CatalogGap,
  type ProductBulkResult,
  type ProductDto,
  type ProductPage,
  type UpdateProductInput,
} from "@crm/shared";
import type { Prisma } from "@prisma/client";
import { ProductCatalogService, cleanAttributes as clean } from "./product-catalog.service";
import { CatalogGapsService } from "./catalog-gaps.service";
import { assertPriceDiscounts, resolveDiscount } from "./product-discount";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { TenantService } from "../../infra/tenant/tenant.service";
import { i18n } from "../../i18n/i18n";

@Controller("products")
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly catalog: ProductCatalogService,
    private readonly gaps: CatalogGapsService,
  ) {}

  /**
   * Una página del catálogo con búsqueda, filtros (estado, origen, precio y
   * campos propios: f.<clave>=…) y orden. Recibe la misma cadena que la URL
   * de la pantalla.
   */
  @Get()
  list(@Query() query: Record<string, unknown>): Promise<ProductPage> {
    return this.catalog.page(parseProductListQuery(query));
  }

  /** Lo que los clientes pidieron a la IA y el producto no tiene (últimos 30 días). */
  @Get("gaps")
  listGaps(): Promise<CatalogGap[]> {
    return this.gaps.list();
  }

  /** Activar, desactivar o borrar varios: los elegidos o todos los que cumplen los filtros. */
  @Post("bulk")
  bulk(@Body(new ZodValidationPipe(productBulkSchema)) body: ProductBulkInput): Promise<ProductBulkResult> {
    return this.catalog.bulk(body);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
  ): Promise<ProductDto> {
    // El SKU es único en la BD: sin esta comprobación, un duplicado sale
    // como un 500 opaco en vez de decirle al usuario qué corregir.
    await this.assertSkuFree(body.sku, null);
    const discount = resolveDiscount(body, null);
    assertPriceDiscounts(body.prices);
    const p = await this.prisma.product.create({
      data: {
        orgId: this.tenant.orgId(),
        name: body.name,
        sku: body.sku,
        description: body.description,
        price: body.price,
        ...discount,
        currency: body.currency,
        imageUrl: body.imageUrl,
        isActive: body.isActive,
        attributes: clean(body.attributes) as Prisma.InputJsonValue,
      },
    });
    await this.setPrices(p.id, p.currency, body.prices);
    return this.dtoById(p.id);
  }

  /**
   * Importación masiva desde CSV. El archivo se lee en el navegador (misma
   * librería que aquí), así que llegan filas ya normalizadas. Una fila con
   * problemas no aborta el resto: se reporta y se sigue.
   */
  @Post("import")
  async import(
    @Body(new ZodValidationPipe(importProductsSchema))
    body: ImportProductsInput,
  ): Promise<ImportProductsResult> {
    const result: ImportProductsResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    // Un mismo SKU repetido dentro del archivo: se queda el primero.
    const seenSkus = new Set<string>();

    for (const [index, row] of body.rows.entries()) {
      // Fila 1 = cabecera, así que la primera de datos es la 2 para el usuario.
      const rowNumber = index + 2;
      try {
        if (row.sku && seenSkus.has(row.sku)) {
          result.skipped++;
          result.errors.push({
            row: rowNumber,
            message: `El SKU "${row.sku}" está repetido en el archivo`,
          });
          continue;
        }
        if (row.sku) seenSkus.add(row.sku);

        // findFirst: el SKU ya solo es único dentro de la empresa, y la
        // extensión acota la consulta a la organización en curso.
        const existing = row.sku
          ? await this.prisma.product.findFirst({ where: { sku: row.sku } })
          : null;

        if (existing && !body.updateExisting) {
          result.skipped++;
          continue;
        }

        const data = {
          name: row.name,
          sku: row.sku,
          description: row.description,
          price: row.price,
          // El archivo manda sobre su precio: con «precio con descuento» queda
          // rebajado (sin fecha de fin); sin esa columna, sin descuento.
          regularPrice: row.regularPrice,
          saleEndsAt: null,
          currency: row.currency,
          imageUrl: row.imageUrl,
          isActive: row.isActive,
        };

        if (existing) {
          // Los campos personalizados del archivo se suman a los que ya tenía.
          const merged = {
            ...((existing.attributes as Record<string, string> | null) ?? {}),
            ...clean(row.attributes),
          };
          await this.prisma.product.update({
            where: { id: existing.id },
            data: { ...data, attributes: merged as Prisma.InputJsonValue },
          });
          // Las columnas precio_XXX del archivo actualizan esas monedas y
          // dejan intactas las demás.
          if (row.prices.length) await this.upsertPrices(existing.id, row.currency, row.prices);
          result.updated++;
        } else {
          const created = await this.prisma.product.create({
            data: {
              ...data,
              orgId: this.tenant.orgId(),
              attributes: clean(row.attributes) as Prisma.InputJsonValue,
            },
          });
          await this.setPrices(created.id, created.currency, row.prices);
          result.created++;
        }
      } catch (e) {
        result.skipped++;
        result.errors.push({
          row: rowNumber,
          message: (e as Error).message.slice(0, 200),
        });
      }
    }

    return result;
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
  ): Promise<ProductDto> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Producto no encontrado");
    if (body.sku !== undefined) await this.assertSkuFree(body.sku, id);
    const discount = resolveDiscount(body, existing);
    if (body.prices !== undefined) assertPriceDiscounts(body.prices);
    const p = await this.prisma.product.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.sku !== undefined ? { sku: body.sku } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.price !== undefined ? { price: body.price } : {}),
        ...discount,
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.attributes !== undefined ? { attributes: clean(body.attributes) as Prisma.InputJsonValue } : {}),
      },
    });
    if (body.prices !== undefined) await this.setPrices(p.id, p.currency, body.prices);
    // Si cambió la moneda base, sobra un precio adicional en esa moneda.
    else if (body.currency !== undefined) {
      await this.prisma.productPrice.deleteMany({ where: { productId: p.id, currency: p.currency } });
    }
    return this.dtoById(p.id);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Producto no encontrado");
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  // Varios productos pueden quedarse sin SKU (null), pero un SKU con valor
  // no puede repetirse. `ignoreId` permite que un producto conserve el suyo.
  private async assertSkuFree(
    sku: string | null | undefined,
    ignoreId: string | null,
  ): Promise<void> {
    if (!sku) return;
    const dup = await this.prisma.product.findFirst({ where: { sku } });
    if (dup && dup.id !== ignoreId) {
      throw new ConflictException(i18n("product.skuTaken", { sku }));
    }
  }

  /**
   * Sustituye la lista de precios adicionales. La moneda base no se guarda
   * aquí (vive en el propio producto), así que se descarta si viene.
   */
  private async setPrices(
    productId: string,
    base: string,
    prices: { currency: string; amount: number; regularAmount?: number | null }[],
  ): Promise<void> {
    await this.prisma.productPrice.deleteMany({ where: { productId } });
    const rows = prices.filter((p) => p.currency !== base);
    if (!rows.length) return;
    await this.prisma.productPrice.createMany({
      data: rows.map((p) => ({
        orgId: this.tenant.orgId(),
        productId,
        currency: p.currency,
        amount: p.amount,
        regularAmount: p.regularAmount ?? null,
      })),
    });
  }

  /** Crea o actualiza solo las monedas dadas (importación sobre existentes). */
  private async upsertPrices(
    productId: string,
    base: string,
    prices: { currency: string; amount: number }[],
  ): Promise<void> {
    for (const p of prices) {
      if (p.currency === base) continue;
      // El archivo no trae descuento por moneda: su precio pasa a ser el de esa moneda, sin rebaja.
      await this.prisma.productPrice.upsert({
        where: { productId_currency: { productId, currency: p.currency } },
        update: { amount: p.amount, regularAmount: null },
        create: { orgId: this.tenant.orgId(), productId, currency: p.currency, amount: p.amount },
      });
    }
  }

  private dtoById(id: string): Promise<ProductDto> {
    return this.catalog.dtoById(id);
  }
}
