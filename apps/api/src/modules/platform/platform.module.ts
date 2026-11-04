import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";
import { ImplementationsController } from "./implementations.controller";
import { ImplementationsService } from "./implementations.service";

@Module({
  // El secreto se pasa en cada firma/verificación, como en el resto de la API.
  imports: [JwtModule.register({})],
  controllers: [PlatformController, ImplementationsController],
  providers: [PlatformService, ImplementationsService, PlatformAdminGuard],
})
export class PlatformModule {}
