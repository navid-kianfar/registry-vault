import { Controller, Get, Query } from '@nestjs/common';
import type { IAnalyticsSummary } from '@registry-vault/shared';
import { RegistryType } from '@registry-vault/shared';
import { AnalyticsService } from './analytics.service';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('summary')
  async getAnalyticsSummary(
    @Query('registryTypes') registryTypes?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ): Promise<IAnalyticsSummary> {
    const parsedRegistryTypes = registryTypes
      ? registryTypes
          .split(',')
          .map((t) => parseInt(t))
          .filter((t) => !isNaN(t)) as RegistryType[]
      : undefined;

    return this.analyticsService.getAnalyticsSummary({
      registryTypes: parsedRegistryTypes,
      dateRange: {
        from: from || undefined,
        to: to || undefined,
      },
      granularity: (granularity as 'day' | 'week' | 'month') || 'day',
    });
  }
}
