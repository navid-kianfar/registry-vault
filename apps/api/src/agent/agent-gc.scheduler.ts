import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@registry-vault/shared/enums';

import { AgentClientService } from './agent-client.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';

/**
 * Scheduled garbage collection, one connection at a time.
 *
 * The check runs hourly and fires when the local hour matches the connection's
 * `gcHour`; `lastScheduledGcAt` keeps a restart inside the same hour from
 * starting a second collection.
 */
@Injectable()
export class AgentGcScheduler {
  private readonly logger = new Logger(AgentGcScheduler.name);

  constructor(
    private readonly agentClient: AgentClientService,
    private readonly auditLogs: AuditLogsService,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runScheduledGc(): Promise<void> {
    const now = new Date();

    let connections: RegistryConnectionEntity[];
    try {
      connections = await this.connectionRepo.find();
    } catch (error: unknown) {
      this.logger.error(
        `Could not list registry connections for scheduled GC: ${(error as Error).message}`,
      );
      return;
    }

    for (const connection of connections) {
      if (!this.isDue(connection, now)) continue;

      try {
        const job = await this.agentClient.startGc(connection, false);
        await this.connectionRepo.update(connection.id, {
          lastScheduledGcAt: now.toISOString(),
        });

        this.logger.log(
          `Scheduled garbage collection started on ${connection.name} (job ${job.id})`,
        );

        await this.auditLogs.log({
          action: AuditAction.ImageDelete,
          actorId: 'system',
          actorUsername: 'system',
          registryType: connection.registryType,
          resourceType: 'registry-gc',
          resourceName: connection.name,
          details: `Scheduled ${connection.gcSchedule} garbage collection started (job ${job.id})`,
          ipAddress: 'system',
          success: true,
        });
      } catch (error: unknown) {
        // A GC that cannot start is a warning, not a crash of the scheduler.
        this.logger.warn(
          `Scheduled garbage collection on ${connection.name} did not start: ${(error as Error).message}`,
        );
      }
    }
  }

  private isDue(connection: RegistryConnectionEntity, now: Date): boolean {
    if (!this.agentClient.hasAgent(connection)) return false;

    switch (connection.gcSchedule) {
      case 'off':
        return false;
      case 'daily':
        break;
      case 'weekly':
        if (now.getDay() !== (connection.gcWeekday ?? 0)) return false;
        break;
      default:
        this.logger.warn(
          `Connection ${connection.name} has an unknown GC schedule "${connection.gcSchedule}"`,
        );
        return false;
    }

    if (now.getHours() !== connection.gcHour) return false;

    return !this.alreadyRanThisHour(connection, now);
  }

  private alreadyRanThisHour(connection: RegistryConnectionEntity, now: Date): boolean {
    if (!connection.lastScheduledGcAt) return false;

    const last = new Date(connection.lastScheduledGcAt);
    if (Number.isNaN(last.getTime())) return false;

    return (
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate() &&
      last.getHours() === now.getHours()
    );
  }
}
