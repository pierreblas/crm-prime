import { Module } from "@nestjs/common";
import { MessagingModule } from "../messaging/messaging.module";
import { ProductsModule } from "../products/products.module";
import { PublicApiController } from "./public-api.controller";
import { PublicApiService } from "./public-api.service";
import { PublicProductsService } from "./public-products.service";

@Module({
  imports: [MessagingModule, ProductsModule],
  controllers: [PublicApiController],
  providers: [PublicApiService, PublicProductsService],
})
export class PublicApiModule {}
