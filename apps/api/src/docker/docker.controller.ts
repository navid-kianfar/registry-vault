import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { DockerService } from './docker.service';

@Controller('api/docker')
export class DockerController {
  constructor(private readonly dockerService: DockerService) {}

  @Get('repositories')
  async getRepositories(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('query') query?: string,
    @Query('registryConnectionId') registryConnectionId?: string,
  ) {
    return this.dockerService.getRepositories({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      sortBy,
      sortOrder,
      query,
      registryConnectionId,
    });
  }

  @Get('repositories/:id')
  async getRepository(@Param('id') id: string) {
    return this.dockerService.getRepository(id);
  }

  @Get('repositories/:id/tags')
  async getTags(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.dockerService.getTags(id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('repositories/:id/tags/:tagName')
  async getImageDetail(
    @Param('id') id: string,
    @Param('tagName') tagName: string,
  ) {
    return this.dockerService.getImageDetail(id, tagName);
  }

  @Delete('repositories/:id/tags/:tagName')
  async deleteTag(
    @Param('id') id: string,
    @Param('tagName') tagName: string,
  ) {
    return this.dockerService.deleteTag(id, tagName);
  }
}
