import {
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
} from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TenantService } from "./tenant.service";
import { TENANT_MIDDLEWARE_ROUTES, TenantMiddleware } from "./tenant.middleware";
import { TenantInterceptor } from "./tenant.interceptor";

@Global()
@Module({
  providers: [
    TenantService,
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
  exports: [TenantService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes(TENANT_MIDDLEWARE_ROUTES);
  }
}
