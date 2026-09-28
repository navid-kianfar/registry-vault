import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import type {
  IAgentGcJob,
  IAgentHealth,
  IAgentLogs,
  IAgentMaintenance,
  IAgentOverviewItem,
  IAgentSettings,
  IAgentStorage,
  IAgentUploads,
  ICreateRegistryUserRequest,
  IPurgeUploadsRequest,
  IPurgeUploadsResult,
  IRegistryUser,
  IRegistryUserResult,
  IRemoveRepositoryRequest,
  IStartGcRequest,
  IUpdateMaintenanceRequest,
  IUpdateRegistryUserRequest,
} from '@registry-vault/shared';
import { Role } from '@registry-vault/shared/enums';

import { AgentActor, AgentRelayService } from './agent-relay.service';
import { Roles } from '../common/decorators/roles.decorator';

interface JwtRequest {
  user: { userId: string; username: string; role: Role };
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

const DEFAULT_UPLOAD_AGE_HOURS = 24;
const DEFAULT_LOG_LINES = 200;

function actorOf(request: JwtRequest): AgentActor {
  const userAgent = request.headers?.['user-agent'];
  return {
    userId: request.user.userId,
    username: request.user.username,
    ipAddress: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
  };
}

/**
 * The agent, as the browser sees it. Vault holds the agent's key; nothing here
 * ever returns it. Destructive operations need an administrator, the same bar
 * the rest of Settings is held to.
 */
@Controller('api/registries')
export class AgentController {
  constructor(private readonly relay: AgentRelayService) {}

  /** Declared before the `:connectionId` routes so "agents" is never read as an id. */
  @Get('agents/overview')
  async getOverview(): Promise<IAgentOverviewItem[]> {
    return this.relay.getOverview();
  }

  @Get(':connectionId/agent/health')
  async getHealth(@Param('connectionId') connectionId: string): Promise<IAgentHealth> {
    return this.relay.getHealth(connectionId);
  }

  @Get(':connectionId/agent/storage')
  async getStorage(
    @Param('connectionId') connectionId: string,
    @Query('refresh') refresh?: string,
  ): Promise<IAgentStorage> {
    return this.relay.getStorage(connectionId, refresh === 'true');
  }

  /** Reclaiming space is maintainer work; it deletes no tag anyone can see. */
  @Post(':connectionId/agent/gc')
  @HttpCode(202)
  @Roles(Role.Admin, Role.Maintainer)
  async startGc(
    @Param('connectionId') connectionId: string,
    @Body() body: IStartGcRequest,
    @Request() request: JwtRequest,
  ): Promise<IAgentGcJob> {
    return this.relay.startGc(connectionId, body?.dryRun === true, actorOf(request));
  }

  @Get(':connectionId/agent/gc')
  async getGc(@Param('connectionId') connectionId: string): Promise<IAgentGcJob | null> {
    return this.relay.getGc(connectionId);
  }

  @Get(':connectionId/agent/gc/history')
  async getGcHistory(@Param('connectionId') connectionId: string): Promise<IAgentGcJob[]> {
    return this.relay.getGcHistory(connectionId);
  }

  @Post(':connectionId/agent/repositories/remove')
  @HttpCode(200)
  @Roles(Role.Admin)
  async removeRepository(
    @Param('connectionId') connectionId: string,
    @Body() body: IRemoveRepositoryRequest,
    @Request() request: JwtRequest,
  ): Promise<{ removed: string }> {
    return this.relay.removeRepository(
      connectionId,
      body?.name,
      body?.force === true,
      actorOf(request),
    );
  }

  @Get(':connectionId/agent/uploads')
  async getUploads(
    @Param('connectionId') connectionId: string,
    @Query('olderThanHours') olderThanHours?: string,
  ): Promise<IAgentUploads> {
    const hours = Number(olderThanHours);
    return this.relay.getUploads(
      connectionId,
      Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_UPLOAD_AGE_HOURS,
    );
  }

  /** Stale uploads are abandoned push attempts, not content; maintainers may clear them. */
  @Post(':connectionId/agent/uploads/purge')
  @HttpCode(200)
  @Roles(Role.Admin, Role.Maintainer)
  async purgeUploads(
    @Param('connectionId') connectionId: string,
    @Body() body: IPurgeUploadsRequest,
    @Request() request: JwtRequest,
  ): Promise<IPurgeUploadsResult> {
    return this.relay.purgeUploads(
      connectionId,
      Number(body?.olderThanHours),
      actorOf(request),
    );
  }

  @Get(':connectionId/agent/maintenance')
  async getMaintenance(@Param('connectionId') connectionId: string): Promise<IAgentMaintenance> {
    return this.relay.getMaintenance(connectionId);
  }

  @Put(':connectionId/agent/maintenance')
  @Roles(Role.Admin)
  async setMaintenance(
    @Param('connectionId') connectionId: string,
    @Body() body: IUpdateMaintenanceRequest,
    @Request() request: JwtRequest,
  ): Promise<IAgentMaintenance> {
    return this.relay.setMaintenance(connectionId, body, actorOf(request));
  }

  /** Admin-only: process output can carry anything the registry or the app logged. */
  @Get(':connectionId/agent/logs')
  @Roles(Role.Admin)
  async getLogs(
    @Param('connectionId') connectionId: string,
    @Query('source') source?: string,
    @Query('lines') lines?: string,
  ): Promise<IAgentLogs> {
    return this.relay.getLogs(
      connectionId,
      source ?? 'registry',
      Number(lines) || DEFAULT_LOG_LINES,
    );
  }

  @Post(':connectionId/agent/registry/restart')
  @HttpCode(202)
  @Roles(Role.Admin)
  async restartRegistry(
    @Param('connectionId') connectionId: string,
    @Request() request: JwtRequest,
  ): Promise<{ restarting: boolean }> {
    return this.relay.restartRegistry(connectionId, actorOf(request));
  }

  /** Admin-only: this is the registry's credential roster, not application users. */
  @Get(':connectionId/agent/users')
  @Roles(Role.Admin)
  async listUsers(@Param('connectionId') connectionId: string): Promise<IRegistryUser[]> {
    return this.relay.listUsers(connectionId);
  }

  @Post(':connectionId/agent/users')
  @Roles(Role.Admin)
  async createUser(
    @Param('connectionId') connectionId: string,
    @Body() body: ICreateRegistryUserRequest,
    @Request() request: JwtRequest,
  ): Promise<IRegistryUserResult> {
    return this.relay.createUser(connectionId, body, actorOf(request));
  }

  @Patch(':connectionId/agent/users/:username')
  @Roles(Role.Admin)
  async updateUser(
    @Param('connectionId') connectionId: string,
    @Param('username') username: string,
    @Body() body: IUpdateRegistryUserRequest,
    @Request() request: JwtRequest,
  ): Promise<IRegistryUserResult> {
    return this.relay.updateUser(connectionId, username, body, actorOf(request));
  }

  @Delete(':connectionId/agent/users/:username')
  @HttpCode(204)
  @Roles(Role.Admin)
  async deleteUser(
    @Param('connectionId') connectionId: string,
    @Param('username') username: string,
    @Request() request: JwtRequest,
  ): Promise<void> {
    return this.relay.deleteUser(connectionId, username, actorOf(request));
  }

  @Get(':connectionId/agent/settings')
  async getSettings(@Param('connectionId') connectionId: string): Promise<IAgentSettings> {
    return this.relay.getSettings(connectionId);
  }

  @Put(':connectionId/agent/settings')
  @Roles(Role.Admin)
  async updateSettings(
    @Param('connectionId') connectionId: string,
    @Body() body: Partial<IAgentSettings>,
    @Request() request: JwtRequest,
  ): Promise<IAgentSettings> {
    return this.relay.updateSettings(connectionId, body, actorOf(request));
  }
}
