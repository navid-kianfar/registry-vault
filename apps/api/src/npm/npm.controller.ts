import { Controller, Get, Param, Query } from '@nestjs/common';
import { NpmService } from './npm.service';

@Controller('api/npm')
export class NpmController {
  constructor(private readonly npmService: NpmService) {}

  @Get('packages')
  async getPackages(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('query') query?: string,
    @Query('registryConnectionId') registryConnectionId?: string,
  ) {
    return this.npmService.getPackages({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      sortBy,
      sortOrder,
      query,
      registryConnectionId,
    });
  }

  @Get('packages/:name')
  async getPackage(@Param('name') name: string) {
    return this.npmService.getPackage(name);
  }

  @Get('packages/:name/versions')
  async getVersions(@Param('name') name: string) {
    return this.npmService.getVersions(name);
  }
}
