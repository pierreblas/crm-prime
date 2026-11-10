import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller";
import { ProductFieldsController } from "./product-fields.controller";
import { ProductSourcesController } from "./product-sources.controller";
import { ProductSourceHooksController } from "./product-source-hooks.controller";
import { ProductSourceOAuthController } from "./product-source-oauth.controller";
import { MercadoLibreConnectService } from "./mercadolibre-connect.service";
import { MercadoLibreClient } from "./connectors/mercadolibre.client";
import { ProductSourceService } from "./product-source.service";
import { ProductSyncService } from "./product-sync.service";
import { ProductSyncProcessor } from "./product-sync.processor";

@Module({
  controllers: [ProductsController, ProductFieldsController, ProductSourcesController, ProductSourceHooksController, ProductSourceOAuthController],
  providers: [ProductSyncService, ProductSourceService, ProductSyncProcessor, MercadoLibreClient, MercadoLibreConnectService],
  exports: [ProductSourceService, ProductSyncService],
})
export class ProductsModule {}
