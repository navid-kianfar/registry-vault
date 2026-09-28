import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type {
  IBulkDeleteRequest,
  IBulkDeleteResult,
  IBulkDeleteFailure,
  ICleanupVersionsRequest,
  IRegistryRepairRequest,
  IRegistryRepairResult,
  IRetentionRunResult,
} from '@registry-vault/shared';
import { RegistryType, CredentialAuthType } from '@registry-vault/shared';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { DockerImageDetailEntity } from '../docker/entities/docker-image-detail.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NpmPackageVersionEntity } from '../npm/entities/npm-package-version.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';
import { NuGetPackageVersionEntity } from '../nuget/entities/nuget-package-version.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RegistryCredentialEntity } from '../settings/entities/registry-credential.entity';
import { CredentialCryptoService } from '../common/crypto/credential-crypto.service';
import { DockerRegistryConnector } from '../registry-sync/connectors/docker-registry.connector';
import { NpmRegistryConnector } from '../registry-sync/connectors/npm-registry.connector';
import { NuGetRegistryConnector } from '../registry-sync/connectors/nuget-registry.connector';

@Injectable()
export class BulkService {
  private readonly logger = new Logger(BulkService.name);

  constructor(
    @InjectRepository(DockerRepositoryEntity)
    private readonly dockerRepoRepository: Repository<DockerRepositoryEntity>,
    @InjectRepository(DockerTagEntity)
    private readonly dockerTagRepository: Repository<DockerTagEntity>,
    @InjectRepository(DockerImageDetailEntity)
    private readonly dockerImageDetailRepository: Repository<DockerImageDetailEntity>,
    @InjectRepository(NpmPackageEntity)
    private readonly npmPackageRepository: Repository<NpmPackageEntity>,
    @InjectRepository(NpmPackageVersionEntity)
    private readonly npmVersionRepository: Repository<NpmPackageVersionEntity>,
    @InjectRepository(NuGetPackageEntity)
    private readonly nugetPackageRepository: Repository<NuGetPackageEntity>,
    @InjectRepository(NuGetPackageVersionEntity)
    private readonly nugetVersionRepository: Repository<NuGetPackageVersionEntity>,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepository: Repository<RegistryConnectionEntity>,
    @InjectRepository(RegistryCredentialEntity)
    private readonly credentialRepository: Repository<RegistryCredentialEntity>,
    private readonly dockerConnector: DockerRegistryConnector,
    private readonly npmConnector: NpmRegistryConnector,
    private readonly nugetConnector: NuGetRegistryConnector,
    private readonly credentialCrypto: CredentialCryptoService,
  ) {}

  // Resolve auth parameters from a credential entity
  private resolveAuth(cred?: RegistryCredentialEntity | null) {
    if (!cred) return { username: undefined, password: undefined, token: undefined, apiKey: undefined, apiKeyHeader: undefined };
    const isBasic = cred.authType === CredentialAuthType.BasicAuth;
    const isBearer = cred.authType === CredentialAuthType.BearerToken;
    const isApiKey = cred.authType === CredentialAuthType.ApiKey;
    return {
      username: isBasic ? cred.username : undefined,
      password: isBasic ? cred.encryptedPassword : undefined,
      token: isBearer ? cred.encryptedPassword : undefined,
      apiKey: (isApiKey || isBearer) ? cred.encryptedPassword : (isBasic ? cred.username : undefined),
      apiKeyHeader: isBearer ? 'Authorization' : cred.headerName,
    };
  }

  private async getConnectionAndCred(registryConnectionId?: string) {
    if (!registryConnectionId) return { connection: null, cred: null };
    const connection = await this.connectionRepository.findOne({ where: { id: registryConnectionId } });
    const cred = connection
      ? await this.credentialCrypto.prepareForUse(
          await this.credentialRepository.findOne({ where: { registryConnectionId: connection.id } }),
        )
      : null;
    return { connection, cred };
  }

  /**
   * Find and optionally finish tags left half-deleted on a Docker registry.
   *
   * A partial delete leaves the tag and its index in place while the platform
   * manifests underneath are gone: the repository keeps listing the tag and
   * every pull fails with `manifest unknown`. Repairing means deleting the tag
   * manifest itself, which is what the delete should have removed.
   *
   * Defaults to a dry run — nothing is deleted unless `apply` is true.
   */
  async repairDockerRegistry(
    request: IRegistryRepairRequest,
  ): Promise<IRegistryRepairResult> {
    const { connection, cred } = await this.getConnectionAndCred(request.registryConnectionId);
    if (!connection) {
      throw new NotFoundException(
        `Registry connection "${request.registryConnectionId}" not found`,
      );
    }

    const auth = this.resolveAuth(cred);
    const password = auth.password ?? auth.token;
    const apply = request.apply === true;

    const allRepos = await this.dockerConnector.listRepositories(
      connection.url, auth.username, password,
    );
    const repositories = request.repositories?.length
      ? allRepos.filter((name) => request.repositories?.includes(name))
      : allRepos;

    const result: IRegistryRepairResult = {
      applied: apply,
      scannedRepositories: repositories.length,
      danglingTags: 0,
      repairedTags: 0,
      repositories: [],
      failures: [],
    };

    for (const repoName of repositories) {
      const dangling = await this.dockerConnector.findDanglingTags(
        connection.url, repoName, auth.username, password,
      );

      if (dangling.length === 0) continue;

      result.danglingTags += dangling.length;
      const repaired: string[] = [];

      if (apply) {
        for (const entry of dangling) {
          const deleteResult = await this.dockerConnector.deleteTagByName(
            connection.url, repoName, entry.tag, auth.username, password,
          );

          if (deleteResult.ok) {
            repaired.push(...deleteResult.removedTags);
            result.repairedTags += deleteResult.removedTags.length;
          } else {
            result.failures.push({
              repository: repoName,
              tag: entry.tag,
              reason: deleteResult.reason,
            });
          }
        }

        // Drop the local mirror rows for whatever actually went away.
        const repoEntity = await this.dockerRepoRepository.findOne({
          where: { name: repoName, registryConnectionId: connection.id },
        });
        if (repoEntity && repaired.length > 0) {
          await this.dockerTagRepository.delete({
            repositoryId: repoEntity.id,
            name: In(repaired),
          });
          await this.dockerImageDetailRepository.delete({
            repositoryId: repoEntity.id,
            tag: In(repaired),
          });

          const remaining = await this.dockerConnector.listTags(
            connection.url, repoName, undefined, auth.username, password,
          );
          if (remaining.length === 0) {
            await this.dockerRepoRepository.remove(repoEntity);
          } else {
            await this.refreshDockerTagCount(repoEntity.id);
          }
        }
      }

      result.repositories.push({
        repository: repoName,
        danglingTags: dangling.map((d) => ({
          tag: d.tag,
          digest: d.digest,
          missing: d.missing,
        })),
        repairedTags: repaired,
      });
    }

    return result;
  }

  /** Keep the denormalised tag count on a repository row truthful. */
  private async refreshDockerTagCount(repositoryId: string): Promise<void> {
    const repo = await this.dockerRepoRepository.findOne({ where: { id: repositoryId } });
    if (!repo) return;
    repo.tagCount = await this.dockerTagRepository.count({ where: { repositoryId } });
    await this.dockerRepoRepository.save(repo);
  }

  /**
   * Delete tags of one repository from the registry and the local mirror.
   *
   * Local rows are dropped only for what the registry actually removed —
   * hiding a live tag is what made deletes look successful while the image
   * stayed behind. A manifest delete takes every tag sharing that digest, so
   * those siblings are dropped too.
   */
  private async deleteDockerTags(
    repositoryId: string,
    tagNames: string[],
    protectTags?: string[],
  ): Promise<{ deleted: number; failures: IBulkDeleteFailure[] }> {
    const failures: IBulkDeleteFailure[] = [];
    const fail = (tag: string, reason: string) =>
      failures.push({ packageIdentifier: repositoryId, versionIdentifier: tag, reason });

    try {
      const known = new Set(
        (await this.dockerTagRepository.find({
          where: { repositoryId, name: In(tagNames) },
          select: { name: true },
        })).map((t) => t.name),
      );
      tagNames.filter((tag) => !known.has(tag)).forEach((tag) => fail(tag, 'Resource not found'));
      const targets = tagNames.filter((tag) => known.has(tag));
      if (targets.length === 0) return { deleted: 0, failures };

      let removedTags = targets;
      const repo = await this.dockerRepoRepository.findOne({ where: { id: repositoryId } });
      const { connection, cred } = await this.getConnectionAndCred(repo?.registryConnectionId);

      if (repo && connection) {
        const auth = this.resolveAuth(cred);
        const result = await this.dockerConnector.deleteTags(
          connection.url, repo.name, targets, auth.username, auth.password ?? auth.token,
          { protectTags },
        );
        result.failures.forEach((f) => fail(f.tag, f.reason));
        removedTags = result.removedTags;
      }

      if (removedTags.length > 0) {
        await this.dockerTagRepository.delete({ repositoryId, name: In(removedTags) });
        await this.dockerImageDetailRepository.delete({ repositoryId, tag: In(removedTags) });
      }
      if (repo) {
        await this.refreshDockerTagCount(repo.id);
      }

      const removed = new Set(removedTags);
      return { deleted: targets.filter((tag) => removed.has(tag)).length, failures };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      const reported = new Set(failures.map((f) => f.versionIdentifier));
      tagNames.filter((tag) => !reported.has(tag)).forEach((tag) => fail(tag, reason));
      return { deleted: 0, failures };
    }
  }

  async bulkDelete(request: IBulkDeleteRequest): Promise<IBulkDeleteResult> {
    const totalRequested = request.items.length;
    let successCount = 0;
    const failures: IBulkDeleteFailure[] = [];

    // Docker tags are deleted per repository in one pass: resolving the
    // repository's digests once per tag is what made large cleanups hang.
    const dockerTagItems = request.registryType === RegistryType.Docker
      ? request.items.filter((item) => item.versionIdentifier)
      : [];
    const batchedItems = new Set(dockerTagItems);
    const tagsByRepo = new Map<string, string[]>();
    for (const item of dockerTagItems) {
      tagsByRepo.set(item.packageIdentifier, [
        ...(tagsByRepo.get(item.packageIdentifier) ?? []),
        item.versionIdentifier!,
      ]);
    }
    for (const [repositoryId, tagNames] of tagsByRepo) {
      const outcome = await this.deleteDockerTags(repositoryId, tagNames, request.protectTags);
      successCount += outcome.deleted;
      failures.push(...outcome.failures);
    }

    for (const item of request.items) {
      if (batchedItems.has(item)) continue;
      try {
        let deleted = false;

        switch (request.registryType) {
          case RegistryType.Docker: {
            // Delete the whole repository — every tag — from registry + local DB
            const repo = await this.dockerRepoRepository.findOne({ where: { id: item.packageIdentifier } });
            if (repo) {
              const { connection, cred } = await this.getConnectionAndCred(repo.registryConnectionId);
              if (connection) {
                const auth = this.resolveAuth(cred);
                const outcome = await this.dockerConnector.deleteRepository(
                  connection.url, repo.name, auth.username, auth.password ?? auth.token,
                );
                if (outcome.failures.length > 0) {
                  const detail = outcome.failures
                    .slice(0, 3)
                    .map((f) => `${f.tag}: ${f.reason}`)
                    .join('; ');
                  throw new Error(
                    `${outcome.deleted}/${outcome.requested} tags deleted, ${outcome.failures.length} failed — ${detail}`,
                  );
                }
              }
              await this.dockerTagRepository.delete({ repositoryId: repo.id });
              await this.dockerImageDetailRepository.delete({ repositoryId: repo.id });
              await this.dockerRepoRepository.remove(repo);
              deleted = true;
            }
            break;
          }

          case RegistryType.NPM: {
            if (item.versionIdentifier) {
              // Delete specific version from registry + local DB
              const version = await this.npmVersionRepository.findOne({
                where: { packageId: item.packageIdentifier, version: item.versionIdentifier },
              });
              if (version) {
                const pkg = await this.npmPackageRepository.findOne({ where: { id: item.packageIdentifier } });
                if (pkg) {
                  const { connection, cred } = await this.getConnectionAndCred(pkg.registryConnectionId);
                  if (connection) {
                    const auth = this.resolveAuth(cred);
                    const ok = await this.npmConnector.unpublishVersion(
                      connection.url, pkg.name, item.versionIdentifier, auth.token, auth.username, auth.password,
                    );
                    if (!ok) {
                      throw new Error(
                        `Registry refused to unpublish ${pkg.name}@${item.versionIdentifier}; local record kept so the two stay in sync`,
                      );
                    }
                  }
                }
                await this.npmVersionRepository.remove(version);
                deleted = true;
              }
            } else {
              // Delete entire package from registry + local DB
              const pkg = await this.npmPackageRepository.findOne({ where: { id: item.packageIdentifier } });
              if (pkg) {
                const { connection, cred } = await this.getConnectionAndCred(pkg.registryConnectionId);
                if (connection) {
                  const auth = this.resolveAuth(cred);
                  const ok = await this.npmConnector.unpublishPackage(
                    connection.url, pkg.name, auth.token, auth.username, auth.password,
                  );
                  if (!ok) {
                    throw new Error(
                      `Registry refused to unpublish ${pkg.name}; local record kept so the two stay in sync`,
                    );
                  }
                }
                await this.npmPackageRepository.remove(pkg);
                deleted = true;
              }
            }
            break;
          }

          case RegistryType.NuGet: {
            if (item.versionIdentifier) {
              // Delete specific version from registry + local DB
              const version = await this.nugetVersionRepository.findOne({
                where: { nugetPackageId: item.packageIdentifier, version: item.versionIdentifier },
              });
              if (version) {
                const pkg = await this.nugetPackageRepository.findOne({ where: { id: item.packageIdentifier } });
                if (pkg) {
                  const { connection, cred } = await this.getConnectionAndCred(pkg.registryConnectionId);
                  if (connection) {
                    const auth = this.resolveAuth(cred);
                    const ok = await this.nugetConnector.deletePackageVersion(
                      connection.url, pkg.packageId, item.versionIdentifier, auth.apiKey, auth.password, auth.apiKeyHeader,
                    );
                    if (!ok) {
                      throw new Error(
                        `Registry refused to delete ${pkg.packageId}@${item.versionIdentifier}; local record kept so the two stay in sync`,
                      );
                    }
                  }
                }
                await this.nugetVersionRepository.remove(version);
                deleted = true;
              }
            } else {
              // Delete all versions from registry then remove package from local DB
              const pkg = await this.nugetPackageRepository.findOne({ where: { id: item.packageIdentifier } });
              if (pkg) {
                const { connection, cred } = await this.getConnectionAndCred(pkg.registryConnectionId);
                if (connection) {
                  const auth = this.resolveAuth(cred);
                  const versions = await this.nugetVersionRepository.find({ where: { nugetPackageId: pkg.id } });
                  const failed: string[] = [];
                  for (const v of versions) {
                    const ok = await this.nugetConnector.deletePackageVersion(
                      connection.url, pkg.packageId, v.version, auth.apiKey, auth.password, auth.apiKeyHeader,
                    );
                    if (!ok) failed.push(v.version);
                  }
                  if (failed.length > 0) {
                    throw new Error(
                      `Registry refused to delete ${failed.length}/${versions.length} versions of ${pkg.packageId} (${failed.slice(0, 3).join(', ')}); package kept`,
                    );
                  }
                }
                await this.nugetPackageRepository.remove(pkg);
                deleted = true;
              }
            }
            break;
          }
        }

        if (deleted) {
          successCount++;
        } else {
          failures.push({
            packageIdentifier: item.packageIdentifier,
            versionIdentifier: item.versionIdentifier,
            reason: 'Resource not found',
          });
        }
      } catch (error) {
        failures.push({
          packageIdentifier: item.packageIdentifier,
          versionIdentifier: item.versionIdentifier,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      totalRequested,
      successCount,
      failureCount: failures.length,
      failures,
    };
  }

  /**
   * Delete the versions a retention rule selects.
   *
   * The selection happens here; the deletion goes through `bulkDelete` so
   * cleanup removes content from the registry as well as the local mirror.
   * Dropping only the local rows made a cleanup look successful while every
   * version stayed on the registry and came back on the next sync.
   *
   * `excludePatterns` (comma-separated globs such as `latest, v*`) name
   * versions that are never deleted and do not count towards `keepCount`.
   */
  async cleanupVersions(
    request: ICleanupVersionsRequest,
    excludePatterns?: string,
  ): Promise<IBulkDeleteResult> {
    try {
      const { toDelete, toKeep } = await this.selectCleanupTargets(request, excludePatterns);

      if (toDelete.length === 0) {
        return { totalRequested: 0, successCount: 0, failureCount: 0, failures: [] };
      }

      return await this.bulkDelete({
        registryType: request.registryType,
        items: toDelete.map((versionIdentifier) => ({
          packageIdentifier: request.packageIdentifier,
          versionIdentifier,
        })),
        // Retention must never take a kept tag along via a shared manifest.
        protectTags: toKeep,
      });
    } catch (error) {
      const failure: IBulkDeleteFailure = {
        packageIdentifier: request.packageIdentifier,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
      return { totalRequested: 1, successCount: 0, failureCount: 1, failures: [failure] };
    }
  }

  /**
   * Apply a retention policy to every package of its registry type, deleting
   * from the registry itself — not just the local mirror, which only hid the
   * versions until the next sync brought them back and freed no space.
   */
  async runRetention(policy: {
    registryType: RegistryType;
    keepLastN?: number | null;
    olderThanDays?: number | null;
    tagPatternExclude?: string | null;
  }): Promise<IRetentionRunResult> {
    if (!policy.keepLastN && !policy.olderThanDays) {
      throw new BadRequestException(
        'This policy sets neither "keep last N" nor "older than"; refusing to delete every version',
      );
    }

    const olderThanDate = policy.olderThanDays
      ? new Date(Date.now() - policy.olderThanDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const packageIds = policy.registryType === RegistryType.Docker
      ? (await this.dockerRepoRepository.find({ select: { id: true } })).map((r) => r.id)
      : policy.registryType === RegistryType.NPM
        ? (await this.npmPackageRepository.find({ select: { id: true } })).map((p) => p.id)
        : (await this.nugetPackageRepository.find({ select: { id: true } })).map((p) => p.id);

    const result: IRetentionRunResult = { deleted: 0, failed: 0, failures: [] };

    for (const packageIdentifier of packageIds) {
      const outcome = await this.cleanupVersions(
        {
          registryType: policy.registryType,
          packageIdentifier,
          keepCount: policy.keepLastN ?? undefined,
          olderThanDate,
        },
        policy.tagPatternExclude ?? undefined,
      );
      result.deleted += outcome.successCount;
      result.failed += outcome.failureCount;
      result.failures.push(...outcome.failures);
    }

    return result;
  }

  /**
   * Split a package's versions into the ones a retention rule deletes and the
   * ones it keeps. The keep list matters for Docker, where deleting a tag can
   * take other tags on the same manifest with it.
   *
   * A rule with neither a keep count nor a cut-off date selects nothing: it
   * used to select every version.
   */
  private async selectCleanupTargets(
    request: ICleanupVersionsRequest,
    excludePatterns?: string,
  ): Promise<{ toDelete: string[]; toKeep: string[] }> {
    const hasKeepCount = request.keepCount !== undefined && request.keepCount > 0;
    if (!hasKeepCount && !request.olderThanDate) {
      return { toDelete: [], toKeep: [] };
    }

    const isExcluded = compileTagPatterns(excludePatterns);

    const split = <T>(items: T[], name: (item: T) => string, date: (item: T) => string) => {
      const candidates = items.filter((item) => !isExcluded(name(item)));
      const toDelete = this.selectVersionsForCleanup(
        candidates,
        request.keepCount,
        request.olderThanDate,
        date,
      );
      const deleted = new Set(toDelete.map(name));
      return {
        toDelete: toDelete.map(name),
        toKeep: items.map(name).filter((n) => !deleted.has(n)),
      };
    };

    switch (request.registryType) {
      case RegistryType.Docker: {
        const tags = await this.dockerTagRepository.find({
          where: { repositoryId: request.packageIdentifier },
          order: { pushedAt: 'DESC' },
        });
        return split(tags, (t) => t.name, (t) => t.pushedAt);
      }

      case RegistryType.NPM: {
        const versions = await this.npmVersionRepository.find({
          where: { packageId: request.packageIdentifier },
          order: { publishedAt: 'DESC' },
        });
        return split(versions, (v) => v.version, (v) => v.publishedAt);
      }

      case RegistryType.NuGet: {
        const versions = await this.nugetVersionRepository.find({
          where: { nugetPackageId: request.packageIdentifier },
          order: { publishedAt: 'DESC' },
        });
        return split(versions, (v) => v.version, (v) => v.publishedAt);
      }

      default:
        return { toDelete: [], toKeep: [] };
    }
  }

  private selectVersionsForCleanup<T>(
    items: T[],
    keepCount?: number,
    olderThanDate?: string,
    getDate?: (item: T) => string,
  ): T[] {
    let toDelete: T[] = [];

    if (keepCount !== undefined && keepCount > 0) {
      // Items are already sorted DESC by date, keep the first N
      toDelete = items.slice(keepCount);
    } else {
      toDelete = [...items];
    }

    if (olderThanDate && getDate) {
      const cutoff = new Date(olderThanDate);
      toDelete = toDelete.filter((item) => {
        const itemDate = new Date(getDate(item));
        return itemDate < cutoff;
      });
    }

    return toDelete;
  }
}

/**
 * Compile comma-separated glob patterns (`latest, stable, v*`) into a matcher.
 * `*` matches any run of characters and `?` a single one; everything else is
 * literal. An empty or missing list matches nothing.
 */
export function compileTagPatterns(patterns?: string): (name: string) => boolean {
  const regexes = (patterns ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new RegExp(
      `^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
    ));
  return (name) => regexes.some((re) => re.test(name));
}
