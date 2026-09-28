import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IDockerPullStats } from '@registry-vault/shared';

import {
  DockerPullStatEntity,
  REPOSITORY_TOTAL_TAG,
} from '../docker/entities/docker-pull-stat.entity';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
/** Enough tags for the chart's legend; a repository with more is not a useful breakdown. */
const MAX_TAG_ROWS = 100;

/** Pull statistics for a repository, from the daily aggregates the poller writes. */
@Injectable()
export class AgentPullStatsService {
  constructor(
    @InjectRepository(DockerRepositoryEntity)
    private readonly dockerRepoRepo: Repository<DockerRepositoryEntity>,
    @InjectRepository(DockerTagEntity)
    private readonly dockerTagRepo: Repository<DockerTagEntity>,
    @InjectRepository(DockerPullStatEntity)
    private readonly pullStatRepo: Repository<DockerPullStatEntity>,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
  ) {}

  async getPullStats(repositoryId: string, days?: number): Promise<IDockerPullStats> {
    const repo = await this.dockerRepoRepo.findOne({ where: { id: repositoryId } });
    if (!repo) {
      throw new NotFoundException(`Docker repository with id "${repositoryId}" not found`);
    }

    const window = clampDays(days);
    const dates = recentDates(window);
    const since = dates[0];

    // The repository-total rows, not the per-tag ones: a pull by digest is
    // credited to every matching tag, so summing tags would count it twice.
    const aggregated = await this.pullStatRepo
      .createQueryBuilder('stat')
      .select('stat.date', 'date')
      .addSelect('SUM(stat.pulls)', 'pulls')
      .where('stat.repositoryId = :repositoryId', { repositoryId })
      .andWhere('stat.tag = :tag', { tag: REPOSITORY_TOTAL_TAG })
      .andWhere('stat.date >= :since', { since })
      .groupBy('stat.date')
      .getRawMany<{ date: string; pulls: string | number }>();

    const byDate = new Map(aggregated.map((row) => [row.date, Number(row.pulls)]));
    const daily = dates.map((date) => ({ date, pulls: byDate.get(date) ?? 0 }));

    const tagRows = await this.dockerTagRepo.find({
      where: { repositoryId },
      order: { pullCount: 'DESC' },
      take: MAX_TAG_ROWS,
      select: { name: true, pullCount: true, lastPulledAt: true },
    });

    const connection = repo.registryConnectionId
      ? await this.connectionRepo.findOne({ where: { id: repo.registryConnectionId } })
      : null;

    return {
      totalPulls: Number(repo.totalPulls),
      lastPulledAt: repo.lastPulledAt,
      daily,
      tags: tagRows.map((tag) => ({
        tag: tag.name,
        pulls: Number(tag.pullCount),
        lastPulledAt: tag.lastPulledAt,
      })),
      incomplete: connection?.eventsIncomplete === true,
    };
  }
}

function clampDays(days?: number): number {
  const requested = Math.trunc(Number(days));
  if (!Number.isFinite(requested) || requested < 1) return DEFAULT_DAYS;
  return Math.min(requested, MAX_DAYS);
}

/** The last `days` calendar days in UTC, oldest first, as `YYYY-MM-DD`. */
function recentDates(days: number): string[] {
  const today = Date.now();
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(new Date(today - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return dates;
}
