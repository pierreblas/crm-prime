import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { dashboardPeriods, type AccessTokenClaims, type DashboardDto, type DashboardPeriod } from "@crm/shared";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsService } from "../permissions/permissions.service";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly perms: PermissionsService,
  ) {}

  @Get()
  async get(
    @CurrentUser() user: AccessTokenClaims,
    @Query("period") period?: string,
    @Query("tz") tz?: string,
    @Query("pipelineId") pipelineId?: string,
  ): Promise<DashboardDto> {
    await this.perms.assertSection(user.sub, "dashboard");
    const p = (dashboardPeriods as readonly string[]).includes(period ?? "") ? (period as DashboardPeriod) : "30d";
    return this.dashboard.get(p, tz, pipelineId || undefined);
  }
}
