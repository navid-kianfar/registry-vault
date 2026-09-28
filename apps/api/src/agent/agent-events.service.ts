import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { AgentClientService, AgentEvent, VAULT_SERVICE_ACTOR } from './agent-client.service';
import { AgentScanService } from './agent-scan.service';
import {
  DockerPullStatEntity,
  REPOSITORY_TOTAL_TAG,
} from '../docker/entities/docker-pull-stat.entity';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RegistrySyncService } from '../registry-sync/registry-sync.service';

const POLL_INTERVAL_MS = 10_000;
const EVENT_PAGE_SIZE = 500;
/** Pages drained per connection per tick — enough to catch up, bounded so one busy registry cannot starve the others. */
const MAX_PAGES_PER_TICK = 10;
/** A push or delete is followed by more of the same; wait for the burst to settle before re-syncing. */
const RESYNC_DEBOUNCE_MS = 15_000;

const DIGEST_PREFIX = 'sha256:';

/** One day's pull count for one tag, ready to be written. */
interface DailyPullRow {
  readonly repositoryId: string;
  readonly tag: string;
  readonly date: string;
  readonly pulls: number;
}

/** What one batch of events adds to one repository. */
interface RepositoryDelta {
  readonly repo: DockerRepositoryEntity;
  /** tag → day → pulls */
  readonly pullsByTagAndDate: Map<string, Map<string, number>>;
  /** tag → most recent pull time */
  readonly lastPulledByTag: Map<string, string>;
  /** Pull events per day, counted once each, whatever they were credited to. */
  readonly eventsByDate: Map<string, number>;
  totalPulls: number;
  lastPulledAt?: string;
}

/**
 * Reads the registry agent's event log and turns it into pull counts, targeted
 * re-syncs and auto-scans.
 *
 * Vault's own registry traffic is stamped `registry-vault` by the agent and
 * skipped here, so syncing does not look like a pull.
 */
@Injectable()
export class AgentEventsService {
  private readonly logger = new Logger(AgentEventsService.name);

  /** Connections with a poll in flight; one tick per connection at a time. */
  private readonly polling = new Set<string>();

  /** `connectionId::repository` → the time a re-sync is due. */
  private readonly resyncDue = new Map<string, number>();

  /**
   * Tags to scan once their repository has been re-synced. A pushed tag has no
   * row yet when its event arrives, so scanning has to wait for the re-sync.
   */
  private readonly pendingAutoScans = new Map<string, Set<string>>();

  constructor(
    private readonly agentClient: AgentClientService,
    private readonly scans: AgentScanService,
    private readonly registrySync: RegistrySyncService,
    private readonly dataSource: DataSource,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
    @InjectRepository(DockerRepositoryEntity)
    private readonly dockerRepoRepo: Repository<DockerRepositoryEntity>,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async pollAllConnections(): Promise<void> {
    let connections: RegistryConnectionEntity[];
    try {
      connections = await this.connectionRepo.find();
    } catch (error: unknown) {
      this.logger.error(`Could not list registry connections: ${(error as Error).message}`);
      return;
    }

    for (const connection of connections) {
      if (!this.agentClient.hasAgent(connection)) continue;
      if (this.polling.has(connection.id)) continue;

      this.polling.add(connection.id);
      try {
        await this.pollConnection(connection);
      } catch (error: unknown) {
        // An agent that is down must not stop the poller; the cursor stays put.
        this.logger.warn(
          `Event poll for ${connection.name} failed: ${(error as Error).message}`,
        );
      } finally {
        this.polling.delete(connection.id);
      }
    }

    await this.runDueResyncs();
  }

  private async pollConnection(connection: RegistryConnectionEntity): Promise<void> {
    let cursor = Number(connection.agentEventCursor ?? 0);

    for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
      const response = await this.agentClient.getEvents(connection, cursor, EVENT_PAGE_SIZE);

      if (response.gap === true) {
        // Every gap matters, not just the first: each one says the history
        // before now is missing events, so the "trustworthy since" mark moves
        // forward even when the flag is already set.
        const noticedAt = new Date().toISOString();
        connection.eventsIncomplete = true;
        connection.eventsIncompleteSince = noticedAt;
        await this.connectionRepo.update(connection.id, {
          eventsIncomplete: true,
          eventsIncompleteSince: noticedAt,
        });
        this.logger.warn(
          `Agent on ${connection.name} pruned events before seq ${cursor}; pull counts are a lower bound from ${noticedAt}`,
        );
      }

      const events = response.events ?? [];
      const nextCursor = Number(response.nextAfter ?? cursor);

      // The page's counts and the cursor that says "this page is done" move
      // together or not at all. Advancing the cursor separately meant a failure
      // between the two either lost a page or replayed one that had already
      // been counted, and pull counts only ever drift upwards.
      await this.dataSource.transaction(async (manager) => {
        if (events.length > 0) {
          await this.ingest(manager, connection, events);
        }

        if (nextCursor > cursor) {
          await manager.update(RegistryConnectionEntity, connection.id, {
            agentEventCursor: nextCursor,
          });
        }
      });

      if (nextCursor > cursor) {
        cursor = nextCursor;
        connection.agentEventCursor = cursor;
      }

      if (events.length < EVENT_PAGE_SIZE) return;
    }
  }

  /** Turn a page of events into per-repository deltas, then write them. */
  private async ingest(
    manager: EntityManager,
    connection: RegistryConnectionEntity,
    events: readonly AgentEvent[],
  ): Promise<void> {
    const relevant = events.filter((event) => event.actor !== VAULT_SERVICE_ACTOR);
    if (relevant.length === 0) return;

    const repoNames = [...new Set(relevant.map((event) => event.repository))];
    const repos = await manager.find(DockerRepositoryEntity, {
      where: { registryConnectionId: connection.id, name: In(repoNames) },
    });
    const reposByName = new Map(repos.map((repo) => [repo.name, repo]));

    const tagsByRepoId = new Map<string, DockerTagEntity[]>();
    if (repos.length > 0) {
      const tags = await manager.find(DockerTagEntity, {
        where: { repositoryId: In(repos.map((repo) => repo.id)) },
      });
      for (const tag of tags) {
        const bucket = tagsByRepoId.get(tag.repositoryId) ?? [];
        bucket.push(tag);
        tagsByRepoId.set(tag.repositoryId, bucket);
      }
    }

    const deltas = new Map<string, RepositoryDelta>();

    for (const event of relevant) {
      const repo = reposByName.get(event.repository);

      if (event.type === 'push') {
        this.scheduleResync(connection.id, event.repository);
        if (connection.autoScanOnPush && !event.reference.startsWith(DIGEST_PREFIX)) {
          this.scheduleAutoScan(connection.id, event.repository, event.reference);
        }
      }

      // A repository Vault has not mirrored yet has nothing to count against;
      // the re-sync scheduled above brings it in.
      if (!repo) continue;

      const delta = deltas.get(repo.id) ?? emptyDelta(repo);
      deltas.set(repo.id, delta);

      switch (event.type) {
        case 'pull':
          this.attributePull(delta, tagsByRepoId.get(repo.id) ?? [], event);
          break;
        case 'push':
          break;
        case 'delete':
          this.scheduleResync(connection.id, repo.name);
          break;
        default:
          this.logger.warn(`Ignoring unknown agent event type "${event.type}"`);
      }
    }

    for (const delta of deltas.values()) {
      await this.applyDelta(manager, delta);
    }
  }

  /**
   * Credit a pull to the tag it belongs to.
   *
   * A pull by tag counts for that tag. A pull by digest counts for every tag
   * currently resolving to that index digest — the content was pulled, and
   * which of its names the client used is not knowable. The repository total
   * and the daily series still count the event once, so crediting two tags
   * never inflates how many pulls happened.
   *
   * A pull of a digest that only appears as a platform child of a tag is the
   * second half of one `docker pull` of a multi-arch image: the index was
   * already counted, so this one is not counted again.
   */
  private attributePull(
    delta: RepositoryDelta,
    tags: readonly DockerTagEntity[],
    event: AgentEvent,
  ): void {
    const reference = event.reference;
    const date = event.at.slice(0, 10);

    const credited = reference.startsWith(DIGEST_PREFIX)
      ? tags.filter((tag) => tag.digest === reference).map((tag) => tag.name)
      : tags.filter((tag) => tag.name === reference).map((tag) => tag.name);

    if (credited.length === 0) {
      // Either a platform child of a multi-arch tag (already counted through
      // its index) or a reference Vault has not mirrored yet. Neither counts.
      return;
    }

    for (const tagName of credited) {
      const byDate = delta.pullsByTagAndDate.get(tagName) ?? new Map<string, number>();
      byDate.set(date, (byDate.get(date) ?? 0) + 1);
      delta.pullsByTagAndDate.set(tagName, byDate);

      const previous = delta.lastPulledByTag.get(tagName);
      if (!previous || event.at > previous) {
        delta.lastPulledByTag.set(tagName, event.at);
      }
    }

    delta.eventsByDate.set(date, (delta.eventsByDate.get(date) ?? 0) + 1);
    delta.totalPulls += 1;

    if (!delta.lastPulledAt || event.at > delta.lastPulledAt) {
      delta.lastPulledAt = event.at;
    }
  }

  /**
   * Write one repository's deltas.
   *
   * Grouped rather than looped: the old shape ran a statement per tag per day
   * and then two more per tag, so one busy page of events turned into hundreds
   * of round trips inside the transaction that holds everything else up.
   */
  private async applyDelta(manager: EntityManager, delta: RepositoryDelta): Promise<void> {
    if (delta.totalPulls === 0) return;

    const dailyRows: DailyPullRow[] = [];

    for (const [tag, byDate] of delta.pullsByTagAndDate) {
      for (const [date, pulls] of byDate) {
        dailyRows.push({ repositoryId: delta.repo.id, tag, date, pulls });
      }
    }

    for (const [date, pulls] of delta.eventsByDate) {
      dailyRows.push({
        repositoryId: delta.repo.id,
        tag: REPOSITORY_TOTAL_TAG,
        date,
        pulls,
      });
    }

    await this.addDailyPulls(manager, delta.repo.id, dailyRows);
    await this.addTagPulls(manager, delta);

    await manager.increment(
      DockerRepositoryEntity,
      { id: delta.repo.id },
      'totalPulls',
      delta.totalPulls,
    );

    if (delta.lastPulledAt) {
      await manager.update(
        DockerRepositoryEntity,
        { id: delta.repo.id },
        { lastPulledAt: delta.lastPulledAt },
      );
    }
  }

  /**
   * Add to each day's aggregate: one read of the days this batch touches, one
   * insert for the rows that did not exist, and one update per distinct
   * increment (in practice one, since most pages add a single pull per day).
   */
  private async addDailyPulls(
    manager: EntityManager,
    repositoryId: string,
    rows: readonly DailyPullRow[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const existing = await manager.find(DockerPullStatEntity, {
      where: {
        repositoryId,
        tag: In([...new Set(rows.map((row) => row.tag))]),
        date: In([...new Set(rows.map((row) => row.date))]),
      },
    });

    const existingByKey = new Map(
      existing.map((row) => [`${row.tag}\u0000${row.date}`, row]),
    );

    const inserts: DailyPullRow[] = [];
    const idsByIncrement = new Map<number, string[]>();

    for (const row of rows) {
      const match = existingByKey.get(`${row.tag}\u0000${row.date}`);

      if (!match) {
        inserts.push(row);
        continue;
      }

      const ids = idsByIncrement.get(row.pulls) ?? [];
      ids.push(match.id);
      idsByIncrement.set(row.pulls, ids);
    }

    if (inserts.length > 0) {
      await manager.insert(DockerPullStatEntity, inserts);
    }

    for (const [pulls, ids] of idsByIncrement) {
      await manager.increment(DockerPullStatEntity, { id: In(ids) }, 'pulls', pulls);
    }
  }

  /**
   * Bump each tag's counter and last-pull time, grouping tags that share a
   * value so a page touching many tags of one repository is a few statements
   * rather than two per tag.
   */
  private async addTagPulls(manager: EntityManager, delta: RepositoryDelta): Promise<void> {
    const tagsByIncrement = new Map<number, string[]>();

    for (const [tag, byDate] of delta.pullsByTagAndDate) {
      let pulls = 0;
      for (const count of byDate.values()) pulls += count;

      const tags = tagsByIncrement.get(pulls) ?? [];
      tags.push(tag);
      tagsByIncrement.set(pulls, tags);
    }

    for (const [pulls, tags] of tagsByIncrement) {
      await manager.increment(
        DockerTagEntity,
        { repositoryId: delta.repo.id, name: In(tags) },
        'pullCount',
        pulls,
      );
    }

    const tagsByLastPulled = new Map<string, string[]>();
    for (const [tag, lastPulledAt] of delta.lastPulledByTag) {
      const tags = tagsByLastPulled.get(lastPulledAt) ?? [];
      tags.push(tag);
      tagsByLastPulled.set(lastPulledAt, tags);
    }

    for (const [lastPulledAt, tags] of tagsByLastPulled) {
      await manager.update(
        DockerTagEntity,
        { repositoryId: delta.repo.id, name: In(tags) },
        { lastPulledAt },
      );
    }
  }

  private scheduleResync(connectionId: string, repository: string): void {
    this.resyncDue.set(`${connectionId}::${repository}`, Date.now() + RESYNC_DEBOUNCE_MS);
  }

  private scheduleAutoScan(connectionId: string, repository: string, tag: string): void {
    const key = `${connectionId}::${repository}`;
    const tags = this.pendingAutoScans.get(key) ?? new Set<string>();
    tags.add(tag);
    this.pendingAutoScans.set(key, tags);
  }

  /** Re-sync the repositories whose debounce window has passed. */
  private async runDueResyncs(): Promise<void> {
    const now = Date.now();
    const due = [...this.resyncDue.entries()].filter(([, at]) => at <= now);
    if (due.length === 0) return;

    for (const [key] of due) {
      this.resyncDue.delete(key);
    }

    const connectionIds = [...new Set(due.map(([key]) => key.split('::')[0]))];
    const connections = await this.connectionRepo.find({ where: { id: In(connectionIds) } });
    const byId = new Map(connections.map((connection) => [connection.id, connection]));

    for (const [key] of due) {
      const separator = key.indexOf('::');
      const connectionId = key.slice(0, separator);
      const repository = key.slice(separator + 2);
      const connection = byId.get(connectionId);
      if (!connection) continue;

      const autoScanTags = this.pendingAutoScans.get(key) ?? new Set<string>();
      this.pendingAutoScans.delete(key);

      try {
        const stillExists = await this.registrySync.syncDockerRepositoryByName(
          connection,
          repository,
        );
        this.logger.log(
          stillExists
            ? `Re-synced ${repository} on ${connection.name} after a registry event`
            : `Dropped ${repository} on ${connection.name}: the registry no longer has it`,
        );

        if (stillExists && autoScanTags.size > 0) {
          await this.queueAutoScans(connection, repository, autoScanTags);
        }
      } catch (error: unknown) {
        this.logger.error(
          `Re-sync of ${repository} on ${connection.name} failed: ${(error as Error).message}`,
        );
      }
    }
  }
  /** Scan the tags a push brought in, now that they have rows to hang a result on. */
  private async queueAutoScans(
    connection: RegistryConnectionEntity,
    repository: string,
    tags: ReadonlySet<string>,
  ): Promise<void> {
    const repo = await this.dockerRepoRepo.findOne({
      where: { name: repository, registryConnectionId: connection.id },
    });
    if (!repo) return;

    for (const tag of tags) {
      await this.scans.autoScanOnPush(connection, repo, tag);
    }
  }
}

function emptyDelta(repo: DockerRepositoryEntity): RepositoryDelta {
  return {
    repo,
    pullsByTagAndDate: new Map(),
    lastPulledByTag: new Map(),
    eventsByDate: new Map(),
    totalPulls: 0,
  };
}
