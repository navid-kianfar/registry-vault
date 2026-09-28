import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { IScanResult, ScanState } from '@registry-vault/shared';

import { AgentClientService } from './agent-client.service';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerScanResultEntity } from '../docker/entities/docker-scan-result.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';

const PENDING_STATES: readonly ScanState[] = ['queued', 'running'] as const;
const FOLLOW_INTERVAL_MS = 5_000;

/** A queued scan that never reports back is abandoned rather than followed forever. */
const MAX_FOLLOW_MS = 60 * 60 * 1000;

const EMPTY_SUMMARY = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
} as const;

/**
 * Vulnerability scans, queued on the agent and followed to completion here.
 *
 * Following happens on a timer rather than in a promise left running after the
 * request: a scan survives a restart of Vault that way, and no failure goes
 * unobserved.
 */
@Injectable()
export class AgentScanService {
  private readonly logger = new Logger(AgentScanService.name);
  private isFollowing = false;

  constructor(
    private readonly agentClient: AgentClientService,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
    @InjectRepository(DockerRepositoryEntity)
    private readonly dockerRepoRepo: Repository<DockerRepositoryEntity>,
    @InjectRepository(DockerTagEntity)
    private readonly dockerTagRepo: Repository<DockerTagEntity>,
    @InjectRepository(DockerScanResultEntity)
    private readonly scanRepo: Repository<DockerScanResultEntity>,
  ) {}

  /** Queue a scan for one tag and record it so the follower picks it up. */
  async requestScan(
    repositoryId: string,
    tagName: string,
    platform?: string,
  ): Promise<IScanResult> {
    const repo = await this.dockerRepoRepo.findOne({ where: { id: repositoryId } });
    if (!repo) {
      throw new NotFoundException(`Docker repository with id "${repositoryId}" not found`);
    }

    const tag = await this.dockerTagRepo.findOne({
      where: { repositoryId, name: tagName },
    });
    if (!tag) {
      throw new NotFoundException(
        `Tag "${tagName}" in repository "${repo.name}" not found`,
      );
    }

    const connection = await this.resolveScanningConnection(repo);
    const scan = await this.agentClient.queueScan(connection, repo.name, tagName, platform);

    await this.persistScan(repo, tag, connection.id, scan);
    return scan;
  }

  /** The latest stored scan for a tag, findings included, or null. */
  async getLatestScan(repositoryId: string, tagName: string): Promise<IScanResult | null> {
    const row = await this.scanRepo.findOne({
      where: { repositoryId, tagName },
      order: { queuedAt: 'DESC' },
    });

    return row ? toScanResult(row) : null;
  }

  /**
   * Auto-scan a freshly pushed tag. Anything that goes wrong here is logged:
   * a push must not be held up by a scanner that is busy or missing.
   */
  async autoScanOnPush(
    connection: RegistryConnectionEntity,
    repo: DockerRepositoryEntity,
    tagName: string,
  ): Promise<void> {
    if (!connection.autoScanOnPush) return;
    if (!this.agentClient.hasFeature(connection, 'scan')) return;

    const tag = await this.dockerTagRepo.findOne({
      where: { repositoryId: repo.id, name: tagName },
    });
    if (!tag) return;

    try {
      const scan = await this.agentClient.queueScan(connection, repo.name, tagName);
      await this.persistScan(repo, tag, connection.id, scan);
      this.logger.log(`Auto-scan queued for ${repo.name}:${tagName} (${scan.id})`);
    } catch (error: unknown) {
      this.logger.warn(
        `Auto-scan of ${repo.name}:${tagName} could not be queued: ${(error as Error).message}`,
      );
    }
  }

  /** Follow every scan still queued or running on its agent. */
  @Interval(FOLLOW_INTERVAL_MS)
  async followPendingScans(): Promise<void> {
    if (this.isFollowing) return;
    this.isFollowing = true;

    try {
      const pending = await this.scanRepo.find({
        where: { state: In([...PENDING_STATES]) },
        take: 50,
      });
      if (pending.length === 0) return;

      const connectionIds = [...new Set(pending.map((row) => row.registryConnectionId))];
      const connections = await this.connectionRepo.find({ where: { id: In(connectionIds) } });
      const byId = new Map(connections.map((connection) => [connection.id, connection]));

      for (const row of pending) {
        await this.followOne(row, byId.get(row.registryConnectionId));
      }
    } catch (error: unknown) {
      this.logger.error(`Following scans failed: ${(error as Error).message}`);
    } finally {
      this.isFollowing = false;
    }
  }

  private async followOne(
    row: DockerScanResultEntity,
    connection?: RegistryConnectionEntity,
  ): Promise<void> {
    if (!connection || !this.agentClient.hasAgent(connection)) {
      await this.abandon(row, 'The registry agent that ran this scan is no longer configured');
      return;
    }

    if (Date.now() - new Date(row.queuedAt).getTime() > MAX_FOLLOW_MS) {
      await this.abandon(row, 'The agent did not finish this scan within an hour');
      return;
    }

    let scan: IScanResult;
    try {
      scan = await this.agentClient.getScan(connection, row.scanId);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        await this.abandon(row, 'The agent no longer has this scan');
        return;
      }
      // A transient agent problem: leave the row pending and try again next tick.
      this.logger.warn(
        `Could not read scan ${row.scanId} from ${connection.name}: ${(error as Error).message}`,
      );
      return;
    }

    await this.applyScan(row, scan);
  }

  private async abandon(row: DockerScanResultEntity, reason: string): Promise<void> {
    row.state = 'failed';
    row.error = reason;
    row.finishedAt = new Date().toISOString();
    await this.scanRepo.save(row);
    await this.writeTagSummary(row);
  }

  private async applyScan(row: DockerScanResultEntity, scan: IScanResult): Promise<void> {
    row.state = scan.state;
    row.digest = scan.digest ?? row.digest;
    row.platform = scan.platform ?? row.platform;
    row.startedAt = scan.startedAt ?? row.startedAt;
    row.finishedAt = scan.finishedAt ?? row.finishedAt;
    row.error = scan.error ?? undefined;
    row.summary = { ...EMPTY_SUMMARY, ...(scan.summary ?? {}) };
    row.vulnerabilities = scan.vulnerabilities ?? [];

    await this.scanRepo.save(row);
    await this.writeTagSummary(row);
  }

  /** Mirror the scan's counts onto the tag so a tag listing shows them without a join. */
  private async writeTagSummary(row: DockerScanResultEntity): Promise<void> {
    const tag = await this.dockerTagRepo.findOne({
      where: { repositoryId: row.repositoryId, name: row.tagName },
    });
    if (!tag) return;

    const summary = row.summary ?? EMPTY_SUMMARY;
    const previous = tag.vulnerabilitySummary;

    tag.vulnerabilitySummary = {
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      unknown: summary.unknown,
      none: previous?.none ?? 0,
      lastScannedAt:
        row.state === 'succeeded'
          ? row.finishedAt ?? new Date().toISOString()
          : previous?.lastScannedAt,
      scanState: row.state,
    };

    await this.dockerTagRepo.save(tag);
  }

  private async persistScan(
    repo: DockerRepositoryEntity,
    tag: DockerTagEntity,
    connectionId: string,
    scan: IScanResult,
  ): Promise<void> {
    const row = this.scanRepo.create({
      repositoryId: repo.id,
      tagName: tag.name,
      scanId: scan.id,
      registryConnectionId: connectionId,
      digest: scan.digest,
      platform: scan.platform,
      state: scan.state,
      queuedAt: scan.queuedAt ?? new Date().toISOString(),
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      error: scan.error ?? undefined,
      summary: { ...EMPTY_SUMMARY, ...(scan.summary ?? {}) },
      vulnerabilities: scan.vulnerabilities ?? [],
    });

    const saved = await this.scanRepo.save(row);
    await this.writeTagSummary(saved);
  }

  /** The connection behind a repository, once it is known to be able to scan. */
  private async resolveScanningConnection(
    repo: DockerRepositoryEntity,
  ): Promise<RegistryConnectionEntity> {
    if (!repo.registryConnectionId) {
      throw new ConflictException(
        `Repository "${repo.name}" is not linked to a registry connection, so it cannot be scanned`,
      );
    }

    const connection = await this.connectionRepo.findOne({
      where: { id: repo.registryConnectionId },
    });
    if (!connection || !this.agentClient.hasAgent(connection)) {
      throw new ConflictException(
        'Scanning needs a registry agent — configure one on this registry connection first',
      );
    }

    if (!this.agentClient.hasFeature(connection, 'scan')) {
      throw new ConflictException(
        `The agent on "${connection.name}" has no scanner — Trivy is disabled or missing on that host`,
      );
    }

    return connection;
  }
}

/** A stored scan row, in the shape the contract returns. */
export function toScanResult(row: DockerScanResultEntity): IScanResult {
  return {
    id: row.scanId,
    state: row.state,
    digest: row.digest,
    platform: row.platform,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error ?? null,
    summary: row.summary ?? { ...EMPTY_SUMMARY },
    vulnerabilities: row.vulnerabilities ?? [],
  };
}
