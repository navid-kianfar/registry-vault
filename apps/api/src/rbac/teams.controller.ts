import { Controller, Get, Param, Query } from '@nestjs/common';
import type { ITeam, PaginatedResponse } from '@registry-vault/shared';
import { TeamsService } from './teams.service';

@Controller('api/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  async getTeams(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<PaginatedResponse<ITeam>> {
    return this.teamsService.getTeams({
      page: parseInt(page as string) || 1,
      pageSize: parseInt(pageSize as string) || 20,
    });
  }

  @Get(':id')
  async getTeam(@Param('id') id: string): Promise<ITeam> {
    return this.teamsService.getTeam(id);
  }
}
