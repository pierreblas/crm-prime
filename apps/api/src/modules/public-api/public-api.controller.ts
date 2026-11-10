import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  bulkPublicProductsSchema,
  createPublicProductSchema,
  listProductsQuerySchema,
  updatePublicProductSchema,
  type BulkPublicProductsInput,
  type CreatePublicProductInput,
  type ListProductsQuery,
  type UpdatePublicProductInput,
  createPublicContactSchema,
  createPublicDealSchema,
  listContactsQuerySchema,
  movePublicDealSchema,
  pageQuerySchema,
  sendPublicMessageSchema,
  statsQuerySchema,
  updatePublicContactSchema,
  type CreatePublicContactInput,
  type CreatePublicDealInput,
  type ListContactsQuery,
  type MovePublicDealInput,
  type SendPublicMessageInput,
  type StatsQuery,
  type UpdatePublicContactInput,
} from "@crm/shared";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiKeyGuard } from "../../common/guards/api-key.guard";
import { Scopes } from "../../common/decorators/scopes.decorator";
import type { AuthenticatedApiKey } from "../api-keys/api-key.service";
import { PublicApiService } from "./public-api.service";
import { PublicProductsService } from "./public-products.service";

/**
 * API pública para integraciones (`/api/public/v1`).
 *
 * Autenticación con clave de API por cabecera `Authorization: Bearer crm_…`;
 * cada endpoint declara el ámbito que exige, así que una clave de una landing
 * puede crear contactos sin poder leer la base entera.
 *
 * La ruta lleva versión para poder evolucionar sin romper integraciones
 * existentes: `v2` convivirá con `v1` cuando haga falta.
 */
@ApiTags("API pública")
@ApiBearerAuth("apiKey")
@Controller("api/public/v1")
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  constructor(
    private readonly api: PublicApiService,
    private readonly products: PublicProductsService,
  ) {}

  // ── Contactos ───────────────────────────────────────────────
  @Get("contacts")
  @ApiOperation({ summary: "Lista contactos, paginados por cursor" })
  @Scopes("contacts:read")
  listContacts(
    @Query(new ZodValidationPipe(listContactsQuerySchema))
    query: ListContactsQuery,
  ) {
    return this.api.listContacts(query);
  }

  @Get("contacts/:id")
  @ApiOperation({ summary: "Un contacto por su id" })
  @Scopes("contacts:read")
  getContact(@Param("id") id: string) {
    return this.api.getContact(id);
  }

  @Post("contacts")
  @ApiOperation({ summary: "Crea un contacto" })
  @Scopes("contacts:write")
  createContact(
    @Body(new ZodValidationPipe(createPublicContactSchema))
    body: CreatePublicContactInput,
    @Req() req: { apiKey?: AuthenticatedApiKey | null },
  ) {
    // La procedencia la pone la clave, no el cuerpo: es lo verificable.
    return this.api.createContact(body, req.apiKey?.name ?? null);
  }

  @Patch("contacts/:id")
  @ApiOperation({ summary: "Actualiza un contacto" })
  @Scopes("contacts:write")
  updateContact(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePublicContactSchema))
    body: UpdatePublicContactInput,
  ) {
    return this.api.updateContact(id, body);
  }

  // ── Oportunidades ───────────────────────────────────────────
  @Post("deals")
  @ApiOperation({ summary: "Crea una oportunidad (crea el contacto si no existe)" })
  @Scopes("deals:write")
  createDeal(
    @Body(new ZodValidationPipe(createPublicDealSchema))
    body: CreatePublicDealInput,
  ) {
    return this.api.createDeal(body);
  }

  @Patch("deals/:id/stage")
  @ApiOperation({ summary: "Mueve una oportunidad de etapa, por nombre" })
  @Scopes("deals:write")
  moveDeal(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(movePublicDealSchema))
    body: MovePublicDealInput,
  ) {
    return this.api.moveDeal(id, body.stage);
  }

  // ── Mensajes ────────────────────────────────────────────────
  @Post("messages")
  @ApiOperation({ summary: "Envía un mensaje de WhatsApp" })
  @Scopes("messages:send")
  sendMessage(
    @Body(new ZodValidationPipe(sendPublicMessageSchema))
    body: SendPublicMessageInput,
  ) {
    return this.api.sendMessage(body);
  }

  // ── Catálogo ────────────────────────────────────────────────
  @Get("products")
  @ApiOperation({ summary: "Lista productos, paginados por cursor" })
  @Scopes("products:read")
  listProducts(@Query(new ZodValidationPipe(listProductsQuerySchema)) query: ListProductsQuery) {
    return this.products.list(query);
  }

  @Get("products/:id")
  @ApiOperation({ summary: "Un producto por su id" })
  @Scopes("products:read")
  getProduct(@Param("id") id: string) {
    return this.products.get(id);
  }

  @Post("products")
  @ApiOperation({ summary: "Crea un producto" })
  @Scopes("products:write")
  createProduct(
    @Body(new ZodValidationPipe(createPublicProductSchema)) body: CreatePublicProductInput,
    @Req() req: { apiKey?: AuthenticatedApiKey | null },
  ) {
    return this.products.create(body, req.apiKey?.name ?? "api");
  }

  @Put("products/bulk")
  @ApiOperation({ summary: "Carga el catálogo en bloque: crea o actualiza por SKU" })
  @Scopes("products:write")
  bulkProducts(
    @Body(new ZodValidationPipe(bulkPublicProductsSchema)) body: BulkPublicProductsInput,
    @Req() req: { apiKey?: AuthenticatedApiKey | null },
  ) {
    return this.products.bulk(body, req.apiKey?.name ?? "api");
  }

  @Patch("products/:id")
  @ApiOperation({ summary: "Actualiza un producto" })
  @Scopes("products:write")
  updateProduct(@Param("id") id: string, @Body(new ZodValidationPipe(updatePublicProductSchema)) body: UpdatePublicProductInput) {
    return this.products.update(id, body);
  }

  @Delete("products/:id")
  @ApiOperation({ summary: "Elimina un producto" })
  @Scopes("products:write")
  deleteProduct(@Param("id") id: string) {
    return this.products.remove(id);
  }

  // ── Métricas ────────────────────────────────────────────────
  @Get("stats/summary")
  @ApiOperation({ summary: "Métricas agregadas del periodo" })
  @Scopes("analytics:read")
  summary(
    @Query(new ZodValidationPipe(statsQuerySchema)) query: StatsQuery,
  ) {
    return this.api.summary(query.days);
  }

  @Get("stats/funnel")
  @ApiOperation({ summary: "Embudo: oportunidades y valor por etapa" })
  @Scopes("analytics:read")
  funnel() {
    return this.api.funnel();
  }

  @Get("stats/sellers")
  @ApiOperation({ summary: "Rendimiento por vendedor" })
  @Scopes("analytics:read")
  sellers() {
    return this.api.sellers();
  }

  // Sonda para que una integración compruebe clave y permisos sin escribir.
  @Get("ping")
  @ApiOperation({ summary: "Comprueba la clave y devuelve sus ámbitos" })
  ping(@Req() req: { apiKey?: AuthenticatedApiKey | null }) {
    return {
      ok: true,
      key: req.apiKey?.name ?? "legacy-token",
      scopes: req.apiKey?.scopes ?? [],
    };
  }
}
