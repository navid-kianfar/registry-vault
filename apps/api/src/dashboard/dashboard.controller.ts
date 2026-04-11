import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async getStats() {
    return this.dashboardService.getStats();
  }

  @Get('activity')
  async getActivity(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 15;
    const safeLimit = isNaN(parsedLimit) || parsedLimit < 1 ? 15 : parsedLimit;
    return this.dashboardService.getRecentActivity(safeLimit);
  }
}
