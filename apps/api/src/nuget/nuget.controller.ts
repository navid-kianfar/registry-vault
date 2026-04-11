import { Controller, Get, Param, Query } from '@nestjs/common';
import { NuGetService } from './nuget.service';

@Controller('api/nuget')
export class NuGetController {
  constructor(private readonly nugetService: NuGetService) {}

  @Get('packages')
  async getPackages(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('query') query?: string,
    @Query('registryConnectionId') registryConnectionId?: string,
  ) {
    return this.nugetService.getPackages({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      sortBy,
      sortOrder,
      query,
      registryConnectionId,
    });
  }

  @Get('packages/:id')
  async getPackage(@Param('id') id: string) {
    return this.nugetService.getPackage(id);
  }

  @Get('packages/:id/versions')
  async getVersions(@Param('id') id: string) {
    return this.nugetService.getVersions(id);
  }
}
