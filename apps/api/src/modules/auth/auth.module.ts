import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordResetService } from "./password-reset.service";
import { SystemMailer } from "./system-mailer";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { OrganizationsModule } from "../organizations/organizations.module";

@Module({
  imports: [PassportModule, JwtModule.register({}), OrganizationsModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PasswordResetService, SystemMailer],
  // Equipo (administrador) y consola (operador) generan enlaces para cambiar la contraseña.
  exports: [AuthService, PasswordResetService],
})
export class AuthModule {}
