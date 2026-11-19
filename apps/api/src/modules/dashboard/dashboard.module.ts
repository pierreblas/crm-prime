import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { AdSalesService } from "./ad-sales.service";

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, AdSalesService],
})
export class DashboardModule {}
