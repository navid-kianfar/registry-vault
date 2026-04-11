import { Controller, Get, Query } from '@nestjs/common';
import type { IAuditLogEntry, PaginatedResponse } from '@registry-vault/shared';
import { AuditAction, RegistryType } from '@registry-vault/shared';
import { AuditLogsService } from './audit-logs.service';

@Controller('api/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('actions') actions?: string,
    @Query('registryType') registryType?: string,
    @Query('actorUsername') actorUsername?: string,
    @Query('resourceName') resourceName?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('success') success?: string,
  ): Promise<PaginatedResponse<IAuditLogEntry>> {
    const parsedActions = actions
      ? actions.split(',').map((a) => parseInt(a)).filter((a) => !isNaN(a)) as AuditAction[]
      : undefined;

    const parsedRegistryType =
      registryType !== undefined && registryType !== ''
        ? (parseInt(registryType) as RegistryType)
        : undefined;

    const parsedSuccess =
      success !== undefined && success !== ''
        ? success === 'true'
        : undefined;

    return this.auditLogsService.getAuditLogs({
      page: parseInt(page as string) || 1,
      pageSize: parseInt(pageSize as string) || 20,
      sortBy: sortBy || 'createdAt',
      sortOrder: (sortOrder as 'asc' | 'desc') || 'desc',
      actions: parsedActions,
      registryType: parsedRegistryType,
      actorUsername: actorUsername || undefined,
      resourceName: resourceName || undefined,
      from: from || undefined,
      to: to || undefined,
      success: parsedSuccess,
    });
  }
}
