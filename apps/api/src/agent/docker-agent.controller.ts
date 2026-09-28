import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { IDockerPullStats, IScanRequest, IScanResult } from '@registry-vault/shared';
import { Role } from '@registry-vault/shared/enums';

import { AgentPullStatsService } from './agent-pull-stats.service';
import { AgentScanService } from './agent-scan.service';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * Docker routes that need an agent: pull statistics and vulnerability scans.
 * They sit beside DockerController rather than inside it so the Docker module
 * keeps no dependency on the agent.
 */
@Controller('api/docker')
export class DockerAgentController {
  constructor(
    private readonly pullStats: AgentPullStatsService,
    private readonly scans: AgentScanService,
  ) {}

  @Get('repositories/:repoId/pulls')
  async getPullStats(
    @Param('repoId') repoId: string,
    @Query('days') days?: string,
  ): Promise<IDockerPullStats> {
    return this.pullStats.getPullStats(repoId, days === undefined ? undefined : Number(days));
  }

  /** Queueing a scan is maintainer work, like deleting a tag. */
  @Post('repositories/:repoId/tags/:tag/scan')
  @HttpCode(202)
  @Roles(Role.Admin, Role.Maintainer)
  async requestScan(
    @Param('repoId') repoId: string,
    @Param('tag') tag: string,
    @Body() body: IScanRequest,
  ): Promise<IScanResult> {
    return this.scans.requestScan(repoId, tag, body?.platform);
  }

  @Get('repositories/:repoId/tags/:tag/scan')
  async getScan(
    @Param('repoId') repoId: string,
    @Param('tag') tag: string,
  ): Promise<IScanResult | null> {
    return this.scans.getLatestScan(repoId, tag);
  }
}
