import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type {
  AgentLogSource,
  IAgentGcJob,
  IAgentHealth,
  IAgentLogs,
  IAgentMaintenance,
  IAgentOverviewItem,
  IAgentSettings,
  IAgentStorage,
  IAgentUploads,
  ICreateRegistryUserRequest,
  IPurgeUploadsResult,
  IRegistryUser,
  IRegistryUserResult,
  IUpdateMaintenanceRequest,
  IUpdateRegistryUserRequest,
} from '@registry-vault/shared';
import { AuditAction } from '@registry-vault/shared/enums';

import { AgentClientService } from './agent-client.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DockerImageDetailEntity } from '../docker/entities/docker-image-detail.entity';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';

/** Who asked, for the audit trail. */
export interface AgentActor {
  readonly userId: string;
  readonly username: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

const MAX_LOG_LINES = 2000;
const DEFAULT_LOG_LINES = 200;
const MIN_PURGE_HOURS = 1;
const LOG_SOURCES: readonly AgentLogSource[] = ['registry', 'agent', 'extra'] as const;

/**
 * The browser's side of the agent: Vault holds the key, calls the agent and
 * keeps its own mirror consistent with what the agent did.
 */
@Injectable()
export class AgentRelayService {
  private readonly logger = new Logger(AgentRelayService.name);

  constructor(
    private readonly agentClient: AgentClientService,
    private readonly auditLogs: AuditLogsService,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
    @InjectRepository(DockerRepositoryEntity)
    private readonly dockerRepoRepo: Repository<DockerRepositoryEntity>,
    @InjectRepository(DockerTagEntity)
    private readonly dockerTagRepo: Repository<DockerTagEntity>,
    @InjectRepository(DockerImageDetailEntity)
    private readonly dockerImageRepo: Repository<DockerImageDetailEntity>,
  ) {}

  /** Health with Vault's own low-disk verdict added. */
  async getHealth(connectionId: string): Promise<IAgentHealth> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const health = await this.agentClient.getHealth(connection);
    return {
      ...health,
      lowDisk: this.agentClient.isLowDisk(connection, health.disk?.usedPercent ?? 0),
    };
  }

  /**
   * Storage, with Vault's own repository id filled in where it mirrors the
   * repository, so the UI can link a storage row to its repository page.
   */
  async getStorage(connectionId: string, refresh: boolean): Promise<IAgentStorage> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const storage = await this.agentClient.getStorage(connection, refresh);

    const names = storage.repositories.map((entry) => entry.name);
    if (names.length === 0) return storage;

    const mirrored = await this.dockerRepoRepo.find({
      where: { registryConnectionId: connection.id, name: In(names) },
      select: { id: true, name: true },
    });
    const idByName = new Map(mirrored.map((repo) => [repo.name, repo.id]));

    return {
      ...storage,
      repositories: storage.repositories.map((entry) => ({
        ...entry,
        repositoryId: idByName.get(entry.name),
      })),
    };
  }

  async startGc(connectionId: string, dryRun: boolean, actor: AgentActor): Promise<IAgentGcJob> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const job = await this.agentClient.startGc(connection, dryRun);

    await this.audit(actor, {
      action: AuditAction.ImageDelete,
      connection,
      resourceType: 'registry-gc',
      details: `Started ${dryRun ? 'a dry-run' : 'a'} garbage collection (job ${job.id})`,
    });

    return job;
  }

  async getGc(connectionId: string): Promise<IAgentGcJob | null> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    return this.agentClient.getGc(connection);
  }

  async getGcHistory(connectionId: string): Promise<IAgentGcJob[]> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    return this.agentClient.getGcHistory(connection);
  }

  /**
   * Remove a repository from the registry's storage and from Vault's mirror.
   *
   * Dropping the mirror rows is the point: without it the repository is gone
   * from the catalog while Vault keeps listing it until the next full sync.
   */
  async removeRepository(
    connectionId: string,
    name: string,
    force: boolean,
    actor: AgentActor,
  ): Promise<{ removed: string }> {
    if (!name || !name.trim()) {
      throw new BadRequestException('A repository name is required');
    }

    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const result = await this.agentClient.removeRepository(connection, name.trim(), force);

    await this.dropMirrorRows(connection.id, name.trim());

    await this.audit(actor, {
      action: AuditAction.ImageDelete,
      connection,
      resourceType: 'docker-repository',
      resourceName: name.trim(),
      details: `Removed repository "${name.trim()}" from registry storage${force ? ' (forced)' : ''}`,
    });

    return result;
  }

  /** Drop Vault's rows for a repository the agent removed from storage. */
  async dropMirrorRows(connectionId: string, repositoryName: string): Promise<void> {
    const repo = await this.dockerRepoRepo.findOne({
      where: { name: repositoryName, registryConnectionId: connectionId },
    });
    if (!repo) return;

    await this.dockerTagRepo.delete({ repositoryId: repo.id });
    await this.dockerImageRepo.delete({ repositoryId: repo.id });
    await this.dockerRepoRepo.delete({ id: repo.id });
  }

  async getUploads(connectionId: string, olderThanHours: number): Promise<IAgentUploads> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    return this.agentClient.getUploads(connection, olderThanHours);
  }

  async purgeUploads(
    connectionId: string,
    olderThanHours: number,
    actor: AgentActor,
  ): Promise<IPurgeUploadsResult> {
    if (!Number.isFinite(olderThanHours) || olderThanHours < MIN_PURGE_HOURS) {
      throw new BadRequestException(
        `"olderThanHours" must be at least ${MIN_PURGE_HOURS} — younger uploads may still be in progress`,
      );
    }

    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const result = await this.agentClient.purgeUploads(connection, olderThanHours);

    await this.audit(actor, {
      action: AuditAction.ImageDelete,
      connection,
      resourceType: 'registry-uploads',
      details: `Purged ${result.purged} upload(s) older than ${olderThanHours}h, freeing ${result.freedBytes} bytes`,
    });

    return result;
  }

  async getMaintenance(connectionId: string): Promise<IAgentMaintenance> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    return this.agentClient.getMaintenance(connection);
  }

  async setMaintenance(
    connectionId: string,
    request: IUpdateMaintenanceRequest,
    actor: AgentActor,
  ): Promise<IAgentMaintenance> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const state = await this.agentClient.setMaintenance(connection, request);

    await this.audit(actor, {
      action: AuditAction.SettingsUpdate,
      connection,
      resourceType: 'registry-maintenance',
      details: state.readOnly
        ? `Put the registry into read-only maintenance${state.reason ? `: ${state.reason}` : ''}`
        : 'Took the registry out of maintenance',
    });

    return state;
  }

  async getLogs(connectionId: string, source: string, lines: number): Promise<IAgentLogs> {
    const resolved = LOG_SOURCES.find((candidate) => candidate === source);
    if (!resolved) {
      throw new BadRequestException(
        `"source" must be one of ${LOG_SOURCES.join(', ')}`,
      );
    }

    const bounded = Math.min(Math.max(Math.trunc(lines) || DEFAULT_LOG_LINES, 1), MAX_LOG_LINES);
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    return this.agentClient.getLogs(connection, resolved, bounded);
  }

  async restartRegistry(connectionId: string, actor: AgentActor): Promise<{ restarting: boolean }> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const result = await this.agentClient.restartRegistry(connection);

    await this.audit(actor, {
      action: AuditAction.SettingsUpdate,
      connection,
      resourceType: 'registry-process',
      details: 'Restarted the registry process',
    });

    return result;
  }

  async listUsers(connectionId: string): Promise<IRegistryUser[]> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    return this.agentClient.listUsers(connection);
  }

  async createUser(
    connectionId: string,
    request: ICreateRegistryUserRequest,
    actor: AgentActor,
  ): Promise<IRegistryUserResult> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const result = await this.agentClient.createUser(connection, request);

    // The generated or supplied password never reaches the audit trail.
    await this.audit(actor, {
      action: AuditAction.UserCreate,
      connection,
      resourceType: 'registry-user',
      resourceName: request.username,
      details: `Created registry user "${request.username}" with role ${request.role}`,
    });

    return result;
  }

  async updateUser(
    connectionId: string,
    username: string,
    request: IUpdateRegistryUserRequest,
    actor: AgentActor,
  ): Promise<IRegistryUserResult> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    const result = await this.agentClient.updateUser(connection, username, request);

    const changes: string[] = [];
    if (request.role !== undefined) changes.push(`role to ${request.role}`);
    if (request.password !== undefined || request.resetPassword) changes.push('password');

    await this.audit(actor, {
      action: AuditAction.UserUpdate,
      connection,
      resourceType: 'registry-user',
      resourceName: username,
      details: `Updated registry user "${username}"${changes.length > 0 ? `: ${changes.join(', ')}` : ''}`,
    });

    return result;
  }

  async deleteUser(connectionId: string, username: string, actor: AgentActor): Promise<void> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    await this.agentClient.deleteUser(connection, username);

    await this.audit(actor, {
      action: AuditAction.UserDelete,
      connection,
      resourceType: 'registry-user',
      resourceName: username,
      details: `Deleted registry user "${username}"`,
    });
  }

  /** Per-connection agent settings; Vault stores these, the agent does not. */
  async getSettings(connectionId: string): Promise<IAgentSettings> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);
    return toAgentSettings(connection);
  }

  async updateSettings(
    connectionId: string,
    request: Partial<IAgentSettings>,
    actor: AgentActor,
  ): Promise<IAgentSettings> {
    const connection = await this.agentClient.requireAgentConnection(connectionId);

    if (request.gcSchedule !== undefined) {
      if (!['off', 'daily', 'weekly'].includes(request.gcSchedule)) {
        throw new BadRequestException('"gcSchedule" must be off, daily or weekly');
      }
      connection.gcSchedule = request.gcSchedule;
    }

    if (request.gcHour !== undefined) {
      const hour = Math.trunc(request.gcHour);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
        throw new BadRequestException('"gcHour" must be between 0 and 23');
      }
      connection.gcHour = hour;
    }

    if (request.gcWeekday !== undefined) {
      const weekday = Math.trunc(request.gcWeekday);
      if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) {
        throw new BadRequestException('"gcWeekday" must be between 0 (Sunday) and 6 (Saturday)');
      }
      connection.gcWeekday = weekday;
    }

    if (request.gcAfterRetention !== undefined) {
      connection.gcAfterRetention = request.gcAfterRetention;
    }

    if (request.lowDiskWarningPercent !== undefined) {
      const percent = Math.trunc(request.lowDiskWarningPercent);
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
        throw new BadRequestException('"lowDiskWarningPercent" must be between 1 and 100');
      }
      connection.lowDiskWarningPercent = percent;
    }

    if (request.autoScanOnPush !== undefined) {
      connection.autoScanOnPush = request.autoScanOnPush;
    }

    const saved = await this.connectionRepo.save(connection);

    await this.audit(actor, {
      action: AuditAction.SettingsUpdate,
      connection: saved,
      resourceType: 'registry-agent-settings',
      details: `Updated agent settings (GC ${saved.gcSchedule}${saved.gcSchedule === 'off' ? '' : ` at ${saved.gcHour}:00`}, auto-scan ${saved.autoScanOnPush ? 'on' : 'off'})`,
    });

    return toAgentSettings(saved);
  }

  /**
   * One row per connection with an agent, for the dashboard. An agent that does
   * not answer is reported as offline rather than failing the whole overview.
   */
  async getOverview(): Promise<IAgentOverviewItem[]> {
    const connections = await this.connectionRepo.find();
    const withAgent = connections.filter((connection) => this.agentClient.hasAgent(connection));

    const items: IAgentOverviewItem[] = [];

    for (const connection of withAgent) {
      try {
        const health = await this.agentClient.getHealth(connection);
        items.push({
          connectionId: connection.id,
          connectionName: connection.name,
          status: 'online',
          lastSeenAt: connection.agentLastSeenAt ?? undefined,
          disk: health.disk,
          lowDisk: this.agentClient.isLowDisk(connection, health.disk?.usedPercent ?? 0),
          maintenance: health.maintenance,
          gc: health.gc,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Agent overview: ${connection.name} did not answer — ${(error as Error).message}`,
        );
        items.push({
          connectionId: connection.id,
          connectionName: connection.name,
          status: connection.agentStatus === 'unauthorized' ? 'unauthorized' : 'offline',
          lastSeenAt: connection.agentLastSeenAt ?? undefined,
          lowDisk: false,
        });
      }
    }

    return items;
  }

  private async audit(
    actor: AgentActor,
    entry: {
      action: AuditAction;
      connection: RegistryConnectionEntity;
      resourceType: string;
      resourceName?: string;
      details: string;
    },
  ): Promise<void> {
    await this.auditLogs.log({
      action: entry.action,
      actorId: actor.userId,
      actorUsername: actor.username,
      registryType: entry.connection.registryType,
      resourceType: entry.resourceType,
      resourceName: entry.resourceName ?? entry.connection.name,
      details: entry.details,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      success: true,
    });
  }
}

/** The stored agent settings of one connection, in contract shape. */
export function toAgentSettings(connection: RegistryConnectionEntity): IAgentSettings {
  return {
    gcSchedule: connection.gcSchedule ?? 'off',
    gcHour: connection.gcHour ?? 3,
    gcWeekday: connection.gcWeekday ?? 0,
    gcAfterRetention: connection.gcAfterRetention ?? true,
    lowDiskWarningPercent: connection.lowDiskWarningPercent ?? 85,
    autoScanOnPush: connection.autoScanOnPush ?? false,
  };
}
