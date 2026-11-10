import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  connectProductSourceSchema,
  Role,
  startMercadoLibreConnectSchema,
  updateProductSourceSchema,
  type AccessTokenClaims,
  type ConnectProductSourceInput,
  type MercadoLibreConfig,
  type ProductSourceDto,
  type RemoveProductSourceMode,
  type StartMercadoLibreConnectInput,
  type SyncProductSourceResult,
  type TestProductSourceResult,
  type UpdateProductSourceInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ProductSourceService } from "./product-source.service";
import { MercadoLibreConnectService } from "./mercadolibre-connect.service";

/**
 * Catálogos conectados (WooCommerce, Shopify, hojas). Verlos puede cualquiera
 * que vea productos; conectar, cambiar y quitar, el administrador.
 */
@Controller("products/sources")
@UseGuards(JwtAuthGuard)
export class ProductSourcesController {
  constructor(
    private readonly sources: ProductSourceService,
    private readonly ml: MercadoLibreConnectService,
  ) {}

  @Get()
  list(): Promise<ProductSourceDto[]> {
    return this.sources.list();
  }

  @Post("test")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  test(@Body(new ZodValidationPipe(connectProductSourceSchema)) body: ConnectProductSourceInput): Promise<TestProductSourceResult> {
    return this.sources.test(body);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  create(@Body(new ZodValidationPipe(connectProductSourceSchema)) body: ConnectProductSourceInput): Promise<ProductSourceDto> {
    return this.sources.create(body);
  }

  // ── Mercado Libre: se conecta autorizando en su web con la app de la plataforma ──
  @Get("mercadolibre/config")
  mercadoLibreConfig(): MercadoLibreConfig {
    return this.ml.config();
  }

  @Post("mercadolibre/start")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  mercadoLibreStart(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(startMercadoLibreConnectSchema)) body: StartMercadoLibreConnectInput,
  ): Promise<{ url: string }> {
    return this.ml.start({ sub: user.sub, org: user.org }, body);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updateProductSourceSchema)) body: UpdateProductSourceInput): Promise<ProductSourceDto> {
    return this.sources.update(id, body);
  }

  @Post(":id/sync")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  sync(@Param("id") id: string): Promise<SyncProductSourceResult> {
    return this.sources.syncNow(id);
  }

  /** Volver a intentar que la tienda registre los webhooks (p. ej. tras dar permiso de escritura a la clave). */
  @Post(":id/webhooks/register")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  registerWebhooks(@Param("id") id: string): Promise<ProductSourceDto> {
    return this.sources.registerWebhooksAgain(id);
  }

  /** `?products=delete` se lleva también sus productos; por defecto se quedan. */
  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param("id") id: string, @Query("products") products?: string): Promise<{ ok: true }> {
    const mode: RemoveProductSourceMode = products === "delete" ? "delete" : "keep";
    return this.sources.remove(id, mode);
  }
}
