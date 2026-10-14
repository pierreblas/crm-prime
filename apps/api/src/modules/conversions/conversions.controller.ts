import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Role } from "@crm/shared";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
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

  @Post("events/:id/retry")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  retry(@Param("id") id: string) {
    return this.conversions.retry(id);
  }
}
