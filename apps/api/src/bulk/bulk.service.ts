import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  IBulkDeleteRequest,
  IBulkDeleteResult,
  IBulkDeleteFailure,
  ICleanupVersionsRequest,
} from '@registry-vault/shared';
import { RegistryType, CredentialAuthType } from '@registry-vault/shared';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NpmPackageVersionEntity } from '../npm/entities/npm-package-version.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';
import { NuGetPackageVersionEntity } from '../nuget/entities/nuget-package-version.entity';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RegistryCredentialEntity } from '../settings/entities/registry-credential.entity';
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
      ? await this.credentialRepository.findOne({ where: { registryConnectionId: connection.id } })
      : null;
    return { connection, cred };
  }

  async bulkDelete(request: IBulkDeleteRequest): Promise<IBulkDeleteResult> {
    const totalRequested = request.items.length;
    let successCount = 0;
    const failures: IBulkDeleteFailure[] = [];

    for (const item of request.items) {
      try {
        let deleted = false;

        switch (request.registryType) {
          case RegistryType.Docker: {
            if (item.versionIdentifier) {
              // Delete a single tag from registry + local DB
              const tag = await this.dockerTagRepository.findOne({
                where: { repositoryId: item.packageIdentifier, name: item.versionIdentifier },
              });
              if (tag) {
                const repo = await this.dockerRepoRepository.findOne({ where: { id: item.packageIdentifier } });
                if (repo) {
                  const { connection, cred } = await this.getConnectionAndCred(repo.registryConnectionId);
                  if (connection) {
                    const auth = this.resolveAuth(cred);
                    const ok = await this.dockerConnector.deleteTagByName(
                      connection.url, repo.name, item.versionIdentifier, auth.username, auth.password ?? auth.token,
                    );
                    if (!ok) this.logger.warn(`Registry delete failed for tag ${repo.name}:${item.versionIdentifier}, removing from local DB anyway`);
                  }
                }
                await this.dockerTagRepository.remove(tag);
                deleted = true;
              }
            } else {
              // Delete entire repository from registry + local DB
              const repo = await this.dockerRepoRepository.findOne({ where: { id: item.packageIdentifier } });
              if (repo) {
                const { connection, cred } = await this.getConnectionAndCred(repo.registryConnectionId);
                if (connection) {
                  const auth = this.resolveAuth(cred);
                  await this.dockerConnector.deleteRepository(
                    connection.url, repo.name, auth.username, auth.password ?? auth.token,
                  );
                }
                await this.dockerRepoRepository.remove(repo);
                deleted = true;
              }
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
                    if (!ok) this.logger.warn(`Registry delete failed for ${pkg.name}@${item.versionIdentifier}, removing from local DB anyway`);
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
                  if (!ok) this.logger.warn(`Registry delete failed for NPM package ${pkg.name}, removing from local DB anyway`);
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
                    if (!ok) this.logger.warn(`Registry delete failed for ${pkg.packageId}@${item.versionIdentifier}, removing from local DB anyway`);
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
                  for (const v of versions) {
                    await this.nugetConnector.deletePackageVersion(
                      connection.url, pkg.packageId, v.version, auth.apiKey, auth.password, auth.apiKeyHeader,
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

  async cleanupVersions(
    request: ICleanupVersionsRequest,
  ): Promise<IBulkDeleteResult> {
    let successCount = 0;
    const failures: IBulkDeleteFailure[] = [];

    try {
      switch (request.registryType) {
        case RegistryType.Docker: {
          const tags = await this.dockerTagRepository.find({
            where: { repositoryId: request.packageIdentifier },
            order: { pushedAt: 'DESC' },
          });

          const toDelete = this.selectVersionsForCleanup(
            tags,
            request.keepCount,
            request.olderThanDate,
            (t) => t.pushedAt,
          );

          for (const tag of toDelete) {
            try {
              await this.dockerTagRepository.remove(tag);
              successCount++;
            } catch (error) {
              failures.push({
                packageIdentifier: request.packageIdentifier,
                versionIdentifier: tag.name,
                reason: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
          break;
        }

        case RegistryType.NPM: {
          const versions = await this.npmVersionRepository.find({
            where: { packageId: request.packageIdentifier },
            order: { publishedAt: 'DESC' },
          });

          const toDelete = this.selectVersionsForCleanup(
            versions,
            request.keepCount,
            request.olderThanDate,
            (v) => v.publishedAt,
          );

          for (const version of toDelete) {
            try {
              await this.npmVersionRepository.remove(version);
              successCount++;
            } catch (error) {
              failures.push({
                packageIdentifier: request.packageIdentifier,
                versionIdentifier: version.version,
                reason: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
          break;
        }

        case RegistryType.NuGet: {
          const versions = await this.nugetVersionRepository.find({
            where: { nugetPackageId: request.packageIdentifier },
            order: { publishedAt: 'DESC' },
          });

          const toDelete = this.selectVersionsForCleanup(
            versions,
            request.keepCount,
            request.olderThanDate,
            (v) => v.publishedAt,
          );

          for (const version of toDelete) {
            try {
              await this.nugetVersionRepository.remove(version);
              successCount++;
            } catch (error) {
              failures.push({
                packageIdentifier: request.packageIdentifier,
                versionIdentifier: version.version,
                reason: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
          break;
        }
      }
    } catch (error) {
      failures.push({
        packageIdentifier: request.packageIdentifier,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return {
      totalRequested: successCount + failures.length,
      successCount,
      failureCount: failures.length,
      failures,
    };
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
