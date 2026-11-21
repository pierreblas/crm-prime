import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Role, enableFormConversionsSchema, type EnableFormConversionsInput } from "@crm/shared";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ConversionsService } from "./conversions.service";

@Controller("conversions")
@UseGuards(JwtAuthGuard)
export class ConversionsController {
  constructor(private readonly conversions: ConversionsService) {}

  @Get()
  overview() {
    return this.conversions.overview();
  }

  @Post("channels/:id/enable")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  enable(@Param("id") id: string) {
    return this.conversions.enable(id);
  }

  @Post("channels/:id/disable")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  disable(@Param("id") id: string) {
    return this.conversions.disable(id);
  }

  // Formularios de Meta: el conjunto de datos (píxel) de cada página.
  @Post("forms/:id/enable")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  enableForm(@Param("id") id: string, @Body(new ZodValidationPipe(enableFormConversionsSchema)) body: EnableFormConversionsInput) {
    return this.conversions.enableForm(id, body);
  }

  @Post("forms/:id/disable")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  disableForm(@Param("id") id: string) {
    return this.conversions.disableForm(id);
  }

  @Post("events/:id/retry")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  retry(@Param("id") id: string) {
    return this.conversions.retry(id);
  }
}
