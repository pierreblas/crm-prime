import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { OrganizationController } from "./organization.controller";
import { OrganizationService } from "./organization.service";
import { SignupVerificationService } from "./signup-verification.service";
import { SystemMailer } from "../auth/system-mailer";

@Module({
  // Solo para firmar el pase tras el alta; el secreto va en cada llamada.
  imports: [JwtModule.register({})],
  controllers: [OrganizationController],
  // El correo del sistema, para el código del alta. Es un proveedor sin estado:
  // AuthModule tiene el suyo, y traerlo de allí sería un ciclo (Auth importa este).
  providers: [OrganizationService, SignupVerificationService, SystemMailer],
  exports: [OrganizationService],
})
export class OrganizationsModule {}
