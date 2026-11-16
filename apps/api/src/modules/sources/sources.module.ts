import { Module } from "@nestjs/common";
import { SourceService } from "./source.service";
import { SourcesController } from "./sources.controller";
import { AuthModule } from "../auth/auth.module";

@Module({
  // AuthModule: el enlace para que alguien del equipo cambie su contraseña.
  imports: [AuthModule],
  controllers: [SourcesController],
  providers: [SourceService],
  exports: [SourceService],
})
export class SourcesModule {}
