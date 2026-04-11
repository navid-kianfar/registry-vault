import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegistryType, CredentialAuthType, AuditAction } from '@registry-vault/shared/enums';

import { DockerRegistryConnector, DockerImageConfig, DockerManifest } from './connectors/docker-registry.connector';
import { NpmRegistryConnector } from './connectors/npm-registry.connector';
import { NuGetRegistryConnector } from './connectors/nuget-registry.connector';

import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RegistryCredentialEntity } from '../settings/entities/registry-credential.entity';
import { DockerRepositoryEntity } from '../docker/entities/docker-repository.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { DockerImageDetailEntity } from '../docker/entities/docker-image-detail.entity';
import { NpmPackageEntity } from '../npm/entities/npm-package.entity';
import { NpmPackageVersionEntity } from '../npm/entities/npm-package-version.entity';
import { NuGetPackageEntity } from '../nuget/entities/nuget-package.entity';
import { NuGetPackageVersionEntity } from '../nuget/entities/nuget-package-version.entity';
import { AuditLogEntity } from '../audit-logs/entities/audit-log.entity';

@Injectable()
export class RegistrySyncService {
  private readonly logger = new Logger(RegistrySyncService.name);

  constructor(
    private readonly dockerConnector: DockerRegistryConnector,
    private readonly npmConnector: NpmRegistryConnector,
    private readonly nugetConnector: NuGetRegistryConnector,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
    @InjectRepository(RegistryCredentialEntity)
    private readonly credentialRepo: Repository<RegistryCredentialEntity>,
    @InjectRepository(DockerRepositoryEntity)
    private readonly dockerRepoRepo: Repository<DockerRepositoryEntity>,
    @InjectRepository(DockerTagEntity)
    private readonly dockerTagRepo: Repository<DockerTagEntity>,
    @InjectRepository(DockerImageDetailEntity)
    private readonly dockerImageRepo: Repository<DockerImageDetailEntity>,
    @InjectRepository(NpmPackageEntity)
    private readonly npmPackageRepo: Repository<NpmPackageEntity>,
    @InjectRepository(NpmPackageVersionEntity)
    private readonly npmVersionRepo: Repository<NpmPackageVersionEntity>,
    @InjectRepository(NuGetPackageEntity)
    private readonly nugetPackageRepo: Repository<NuGetPackageEntity>,
    @InjectRepository(NuGetPackageVersionEntity)
    private readonly nugetVersionRepo: Repository<NuGetPackageVersionEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepo: Repository<AuditLogEntity>,
  ) {}

  /**
   * Automatically sync all registries every 30 minutes.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledSync(): Promise<void> {
    this.logger.log('Scheduled sync triggered');
    await this.syncAll();
  }

  /**
   * Sync all registry connections.
   * Called by schedule or manually.
   */
  async syncAll(): Promise<void> {
    this.logger.log('Starting sync for all registry connections');
    const connections = await this.connectionRepo.find();

    for (const conn of connections) {
      try {
        await this.syncConnection(conn);
      } catch (error: unknown) {
        this.logger.error(`Failed to sync ${conn.name}: ${(error as Error).message}`);
      }
    }

    this.logger.log('Completed sync for all registry connections');
  }

  /**
   * Sync a single registry connection by ID.
   */
  async syncConnectionById(id: string): Promise<void> {
    const connection = await this.connectionRepo.findOne({ where: { id } });
    if (!connection) {
      this.logger.warn(`Connection ${id} not found for sync`);
      return;
    }
    await this.syncConnection(connection);
  }

  /**
   * Build HTTP auth headers from a credential entity based on its authType.
   */
  private buildAuthHeaders(credential: RegistryCredentialEntity): Record<string, string> {
    const headers: Record<string, string> = {};
    switch (credential.authType) {
      case CredentialAuthType.BasicAuth:
        if (credential.username && credential.encryptedPassword) {
          headers['Authorization'] = `Basic ${Buffer.from(`${credential.username}:${credential.encryptedPassword}`).toString('base64')}`;
        }
        break;
      case CredentialAuthType.ApiKey: {
        const headerName = credential.headerName || 'X-Api-Key';
        if (credential.encryptedPassword) {
          headers[headerName] = credential.encryptedPassword;
        }
        break;
      }
      case CredentialAuthType.BearerToken:
        if (credential.encryptedPassword) {
          headers['Authorization'] = `Bearer ${credential.encryptedPassword}`;
        }
        break;
    }
    return headers;
  }

  /**
   * Sync a single registry connection based on its type.
   */
  async syncConnection(connection: RegistryConnectionEntity): Promise<void> {
    this.logger.log(
      `Syncing connection: ${connection.name} (type=${connection.registryType})`,
    );

    const credential = await this.credentialRepo.findOne({
      where: { registryConnectionId: connection.id },
    });

    switch (connection.registryType) {
      case RegistryType.Docker:
        await this.syncDocker(connection, credential ?? undefined);
        break;
      case RegistryType.NuGet:
        await this.syncNuGet(connection, credential ?? undefined);
        break;
      case RegistryType.NPM:
        await this.syncNpm(connection, credential ?? undefined);
        break;
      default:
        this.logger.warn(
          `Unknown registry type: ${connection.registryType} for connection ${connection.name}`,
        );
    }
  }

  /**
   * Sync Docker registry: list repos, tags, manifests, and image configs.
   */
  async syncDocker(
    connection: RegistryConnectionEntity,
    credential?: RegistryCredentialEntity,
  ): Promise<void> {
    const url = connection.url;
    // For Docker, BasicAuth maps to username+password for the token flow.
    // BearerToken means a pre-configured token (passed as password param).
    const username = credential?.authType === CredentialAuthType.BasicAuth ? credential?.username : undefined;
    const password = credential?.authType === CredentialAuthType.BasicAuth
      ? credential?.encryptedPassword
      : credential?.authType === CredentialAuthType.BearerToken
        ? credential?.encryptedPassword
        : undefined;

    // 1. List repositories from registry
    const repoNames = await this.dockerConnector.listRepositories(
      url,
      username,
      password,
    );
    this.logger.log(
      `Found ${repoNames.length} repositories in ${connection.name}`,
    );

    for (const repoName of repoNames) {
      try {
        // Upsert DockerRepository
        let repoEntity = await this.dockerRepoRepo.findOne({
          where: { name: repoName, registryConnectionId: connection.id },
        });

        if (!repoEntity) {
          repoEntity = await this.dockerRepoRepo.save(
            this.dockerRepoRepo.create({
              name: repoName,
              registryConnectionId: connection.id,
              tagCount: 0,
              totalPulls: 0,
              totalSize: 0,
              isPublic: false,
            }),
          );
        }

        // 2. Get a token scoped for this repository
        const token = await this.dockerConnector.getToken(
          url,
          username,
          password,
          `repository:${repoName}:pull`,
        );

        // 3. List tags for this repository
        const tags = await this.dockerConnector.listTags(url, repoName, token ?? undefined, username, password);
        repoEntity.tagCount = tags.length;

        let totalRepoSize = 0;
        let latestImageCreatedAt: string | undefined;

        for (const tagName of tags) {
          try {
            // 4. Get manifest for each tag
            const manifest: DockerManifest | null = await this.dockerConnector.getManifest(
              url,
              repoName,
              tagName,
              token ?? undefined,
              username,
              password,
            );

            if (!manifest) continue;

            const manifestDigest =
              manifest._digest ?? manifest.config?.digest ?? '';
            const layerSizes: number[] = (manifest.layers ?? []).map(
              (l) => l.size ?? 0,
            );
            const totalTagSize = layerSizes.reduce(
              (sum: number, s: number) => sum + s,
              0,
            );
            totalRepoSize += totalTagSize;

            // 5. Get image config for architecture/os info
            let architecture = 'amd64';
            let os = 'linux';
            let imageConfig: DockerImageConfig | null = null;

            if (manifest.config?.digest) {
              imageConfig = await this.dockerConnector.getImageConfig(
                url,
                repoName,
                manifest.config.digest,
                token ?? undefined,
                username,
                password,
              );

              if (imageConfig) {
                architecture = imageConfig.architecture ?? 'amd64';
                os = imageConfig.os ?? 'linux';
              }
            }

            // Upsert DockerTag
            let tagEntity = await this.dockerTagRepo.findOne({
              where: { repositoryId: repoEntity.id, name: tagName },
            });

            const tagPushedAt = imageConfig?.created ?? new Date().toISOString();

            // Track latest image date for the repository's lastPushedAt
            if (!latestImageCreatedAt || tagPushedAt > latestImageCreatedAt) {
              latestImageCreatedAt = tagPushedAt;
            }

            if (!tagEntity) {
              tagEntity = this.dockerTagRepo.create({
                repositoryId: repoEntity.id,
                name: tagName,
                digest: manifestDigest,
                sizeBytes: totalTagSize,
                architecture,
                os,
                pushedAt: tagPushedAt,
                vulnerabilitySummary: {
                  critical: 0,
                  high: 0,
                  medium: 0,
                  low: 0,
                  none: 0,
                },
              });
            } else {
              tagEntity.digest = manifestDigest;
              tagEntity.sizeBytes = totalTagSize;
              tagEntity.architecture = architecture;
              tagEntity.os = os;
              tagEntity.pushedAt = tagPushedAt;
            }

            // Save tag
            tagEntity = await this.dockerTagRepo.save(tagEntity);

            // Upsert DockerImageDetail
            if (imageConfig) {
              let imageDetail = await this.dockerImageRepo.findOne({
                where: { repositoryId: repoEntity.id, tag: tagName },
              });

              const layers = (imageConfig.history ?? []).map(
                (h, idx) => ({
                  digest: manifest.layers?.[idx]?.digest ?? '',
                  sizeBytes: manifest.layers?.[idx]?.size ?? 0,
                  command: h.created_by ?? '',
                  createdAt: h.created ?? new Date().toISOString(),
                }),
              );

              const labels = imageConfig.config?.Labels ?? {};
              const exposedPorts = imageConfig.config?.ExposedPorts
                ? Object.keys(imageConfig.config.ExposedPorts)
                : undefined;
              const entrypoint = imageConfig.config?.Entrypoint ?? undefined;
              const cmd = imageConfig.config?.Cmd ?? undefined;
              const env = imageConfig.config?.Env ?? undefined;

              if (!imageDetail) {
                imageDetail = this.dockerImageRepo.create({
                  repositoryId: repoEntity.id,
                  tag: tagName,
                  digest: manifestDigest,
                  architecture,
                  os,
                  sizeBytes: totalTagSize,
                  layers,
                  labels,
                  exposedPorts,
                  entrypoint,
                  cmd,
                  env,
                  imageCreatedAt:
                    imageConfig.created ?? new Date().toISOString(),
                });
              } else {
                imageDetail.digest = manifestDigest;
                imageDetail.architecture = architecture;
                imageDetail.os = os;
                imageDetail.sizeBytes = totalTagSize;
                imageDetail.layers = layers;
                imageDetail.labels = labels;
                imageDetail.exposedPorts = exposedPorts;
                imageDetail.entrypoint = entrypoint;
                imageDetail.cmd = cmd;
                imageDetail.env = env;
                imageDetail.imageCreatedAt =
                  imageConfig.created ?? new Date().toISOString();
              }

              await this.dockerImageRepo.save(imageDetail);
            }
          } catch (tagError: unknown) {
            this.logger.error(
              `Failed to sync tag ${repoName}:${tagName}: ${(tagError as Error).message}`,
            );
          }
        }

        repoEntity.totalSize = totalRepoSize;
        // Use the most recent image creation date across all tags as lastPushedAt
        repoEntity.lastPushedAt = latestImageCreatedAt ?? repoEntity.lastPushedAt ?? new Date().toISOString();
        await this.dockerRepoRepo.save(repoEntity);
      } catch (repoError: unknown) {
        this.logger.error(
          `Failed to sync repo ${repoName}: ${(repoError as Error).message}`,
        );
      }
    }

    // Update connection status
    connection.isConnected = true;
    await this.connectionRepo.save(connection);

    await this.auditLogRepo.save(this.auditLogRepo.create({
      action: AuditAction.SettingsUpdate,
      actorId: 'system',
      actorUsername: 'system',
      registryType: connection.registryType,
      resourceType: 'registry',
      resourceName: connection.name,
      details: `Synced ${repoNames.length} Docker repositories`,
      ipAddress: 'system',
      success: true,
    }));
  }

  /**
   * Sync NPM registry: search packages, get metadata, upsert to database.
   */
  async syncNpm(
    connection: RegistryConnectionEntity,
    credential?: RegistryCredentialEntity,
  ): Promise<void> {
    const url = connection.url;
    // NPM: BearerToken/ApiKey → token in Authorization header; BasicAuth → username+password
    const token = credential?.authType === CredentialAuthType.BearerToken || credential?.authType === CredentialAuthType.ApiKey
      ? credential?.encryptedPassword
      : undefined;
    const username = credential?.authType === CredentialAuthType.BasicAuth ? credential?.username : undefined;
    const password = credential?.authType === CredentialAuthType.BasicAuth ? credential?.encryptedPassword : undefined;

    // 1. Search packages
    const searchResults = await this.npmConnector.searchPackages(
      url,
      token,
      undefined,
      username,
      password,
    );
    this.logger.log(
      `Found ${searchResults.length} NPM packages in ${connection.name}`,
    );

    for (const result of searchResults) {
      try {
        const packageName = result.package?.name;
        if (!packageName) continue;

        // 2. Get full package metadata
        const metadata = await this.npmConnector.getPackageMetadata(
          url,
          packageName,
          token,
          username,
          password,
        );

        if (!metadata) continue;

        // 3. Upsert NpmPackage
        let pkgEntity = await this.npmPackageRepo.findOne({
          where: { name: packageName, registryConnectionId: connection.id },
        });

        const distTags = metadata['dist-tags'] ?? {};
        const latestVersion =
          distTags.latest ?? result.package?.version ?? '0.0.0';
        const author =
          typeof metadata.author === 'string'
            ? metadata.author
            : metadata.author?.name ?? result.package?.author?.name;

        if (!pkgEntity) {
          pkgEntity = this.npmPackageRepo.create({
            name: packageName,
            description:
              metadata.description ?? result.package?.description ?? '',
            latestVersion,
            author,
            license: metadata.license ?? result.package?.license ?? undefined,
            totalDownloads: 0,
            keywords: metadata.keywords ?? result.package?.keywords ?? [],
            repository:
              typeof metadata.repository === 'string'
                ? metadata.repository
                : metadata.repository?.url ?? undefined,
            homepage: metadata.homepage ?? result.package?.links?.homepage,
            readmeContent: metadata.readme ?? undefined,
            distTags,
            registryConnectionId: connection.id,
          });
        } else {
          pkgEntity.description =
            metadata.description ?? result.package?.description ?? '';
          pkgEntity.latestVersion = latestVersion;
          pkgEntity.author = author;
          pkgEntity.license =
            metadata.license ?? result.package?.license ?? undefined;
          pkgEntity.keywords =
            metadata.keywords ?? result.package?.keywords ?? [];
          pkgEntity.repository =
            typeof metadata.repository === 'string'
              ? metadata.repository
              : metadata.repository?.url ?? undefined;
          pkgEntity.homepage =
            metadata.homepage ?? result.package?.links?.homepage;
          pkgEntity.readmeContent = metadata.readme ?? undefined;
          pkgEntity.distTags = distTags;
        }

        pkgEntity = await this.npmPackageRepo.save(pkgEntity);

        // 4. Upsert versions
        const versions = metadata.versions ?? {};
        for (const [versionKey, ver] of Object.entries(versions)) {
          try {
            let versionEntity = await this.npmVersionRepo.findOne({
              where: { packageId: pkgEntity.id, version: versionKey },
            });

            const dist = ver.dist ?? {};
            const publishTime = metadata.time?.[versionKey];

            if (!versionEntity) {
              versionEntity = this.npmVersionRepo.create({
                packageId: pkgEntity.id,
                version: versionKey,
                publishedAt: publishTime ?? new Date().toISOString(),
                downloads: 0,
                sizeBytes: dist.size ?? 0,
                unpackedSizeBytes: dist.unpackedSize ?? 0,
                shasum: dist.shasum ?? '',
                integrity: dist.integrity ?? '',
                nodeEngine: ver.engines?.node ?? undefined,
                dependencies: ver.dependencies ?? {},
                devDependencies: ver.devDependencies ?? {},
                peerDependencies: ver.peerDependencies ?? {},
              });
            } else {
              versionEntity.publishedAt =
                publishTime ?? versionEntity.publishedAt;
              versionEntity.sizeBytes = dist.size ?? versionEntity.sizeBytes;
              versionEntity.unpackedSizeBytes =
                dist.unpackedSize ?? versionEntity.unpackedSizeBytes;
              versionEntity.shasum = dist.shasum ?? versionEntity.shasum;
              versionEntity.integrity =
                dist.integrity ?? versionEntity.integrity;
              versionEntity.nodeEngine = ver.engines?.node ?? undefined;
              versionEntity.dependencies = ver.dependencies ?? {};
              versionEntity.devDependencies = ver.devDependencies ?? {};
              versionEntity.peerDependencies = ver.peerDependencies ?? {};
            }

            await this.npmVersionRepo.save(versionEntity);
          } catch (versionError: unknown) {
            this.logger.error(
              `Failed to sync NPM version ${packageName}@${versionKey}: ${(versionError as Error).message}`,
            );
          }
        }
      } catch (pkgError: unknown) {
        this.logger.error(
          `Failed to sync NPM package ${result.package?.name}: ${(pkgError as Error).message}`,
        );
      }
    }

    // Update connection status
    connection.isConnected = true;
    await this.connectionRepo.save(connection);

    await this.auditLogRepo.save(this.auditLogRepo.create({
      action: AuditAction.SettingsUpdate,
      actorId: 'system',
      actorUsername: 'system',
      registryType: connection.registryType,
      resourceType: 'registry',
      resourceName: connection.name,
      details: `Synced ${searchResults.length} NPM packages`,
      ipAddress: 'system',
      success: true,
    }));
  }

  /**
   * Sync NuGet registry: get service index, search packages, get versions.
   */
  async syncNuGet(
    connection: RegistryConnectionEntity,
    credential?: RegistryCredentialEntity,
  ): Promise<void> {
    const url = connection.url;
    // NuGet: ApiKey → sends X-NuGet-ApiKey (or credential.headerName) header with encryptedPassword as value
    //        BasicAuth → sends Authorization: Basic (username:encryptedPassword)
    //        BearerToken → sends Authorization: Bearer encryptedPassword (via apiKey param, no password)
    const apiKey = credential?.authType === CredentialAuthType.ApiKey || credential?.authType === CredentialAuthType.BearerToken
      ? credential?.encryptedPassword
      : credential?.authType === CredentialAuthType.BasicAuth
        ? credential?.username
        : undefined;
    const password = credential?.authType === CredentialAuthType.BasicAuth ? credential?.encryptedPassword : undefined;
    const apiKeyHeader = credential?.authType === CredentialAuthType.BearerToken
      ? 'Authorization'
      : credential?.headerName;

    // 1. Search packages
    const searchResults = await this.nugetConnector.searchPackages(
      url,
      apiKey,
      undefined,
      password,
      apiKeyHeader,
    );
    this.logger.log(
      `Found ${searchResults.length} NuGet packages in ${connection.name}`,
    );

    for (const result of searchResults) {
      try {
        const packageId = result.id ?? result.packageId;
        if (!packageId) continue;

        // 2. Upsert NuGetPackage
        let pkgEntity = await this.nugetPackageRepo.findOne({
          where: { packageId, registryConnectionId: connection.id },
        });

        const latestVersion =
          result.version ?? result.versions?.[result.versions.length - 1]?.version ?? '0.0.0';
        const isPrerelease = latestVersion.includes('-');

        if (!pkgEntity) {
          pkgEntity = this.nugetPackageRepo.create({
            packageId,
            title: result.title ?? packageId,
            authors: result.authors
              ? Array.isArray(result.authors)
                ? result.authors
                : [result.authors]
              : [],
            description: result.description ?? '',
            latestVersion,
            totalDownloads: result.totalDownloads ?? 0,
            isPrerelease,
            tags: result.tags ?? [],
            projectUrl: result.projectUrl ?? undefined,
            licenseExpression: result.licenseExpression ?? undefined,
            iconUrl: result.iconUrl ?? undefined,
            registryConnectionId: connection.id,
          });
        } else {
          pkgEntity.title = result.title ?? packageId;
          pkgEntity.authors = result.authors
            ? Array.isArray(result.authors)
              ? result.authors
              : [result.authors]
            : [];
          pkgEntity.description = result.description ?? '';
          pkgEntity.latestVersion = latestVersion;
          pkgEntity.totalDownloads = result.totalDownloads ?? 0;
          pkgEntity.isPrerelease = isPrerelease;
          pkgEntity.tags = result.tags ?? [];
          pkgEntity.projectUrl = result.projectUrl ?? undefined;
          pkgEntity.licenseExpression = result.licenseExpression ?? undefined;
          pkgEntity.iconUrl = result.iconUrl ?? undefined;
        }

        pkgEntity = await this.nugetPackageRepo.save(pkgEntity);

        // 3. Get package versions from registration endpoint
        const versionData = await this.nugetConnector.getPackageVersions(
          url,
          packageId,
          apiKey,
          password,
          apiKeyHeader,
        );

        if (versionData?.items) {
          for (const page of versionData.items) {
            const entries = page.items ?? [];
            for (const entry of entries) {
              try {
                const catalogEntry = entry.catalogEntry ?? entry;
                const version = catalogEntry.version;
                if (!version) continue;

                let versionEntity = await this.nugetVersionRepo.findOne({
                  where: { nugetPackageId: pkgEntity.id, version },
                });

                const versionIsPrerelease = version.includes('-');
                const dependencyGroups = (
                  catalogEntry.dependencyGroups ?? []
                ).map((group) => ({
                  targetFramework: group.targetFramework ?? '',
                  dependencies: (group.dependencies ?? []).map((dep) => ({
                    id: dep.id ?? '',
                    versionRange: dep.range ?? dep.version ?? '',
                  })),
                }));

                if (!versionEntity) {
                  versionEntity = this.nugetVersionRepo.create({
                    nugetPackageId: pkgEntity.id,
                    version,
                    downloads: catalogEntry.downloads ?? 0,
                    publishedAt:
                      catalogEntry.published ?? new Date().toISOString(),
                    isPrerelease: versionIsPrerelease,
                    isListed: catalogEntry.listed !== false,
                    dependencies: dependencyGroups,
                    sizeBytes: catalogEntry.packageSize ?? 0,
                    packageHash: catalogEntry.packageHash ?? '',
                    packageHashAlgorithm:
                      catalogEntry.packageHashAlgorithm ?? 'SHA512',
                  });
                } else {
                  versionEntity.downloads =
                    catalogEntry.downloads ?? versionEntity.downloads;
                  versionEntity.publishedAt =
                    catalogEntry.published ?? versionEntity.publishedAt;
                  versionEntity.isPrerelease = versionIsPrerelease;
                  versionEntity.isListed = catalogEntry.listed !== false;
                  versionEntity.dependencies = dependencyGroups;
                  versionEntity.sizeBytes =
                    catalogEntry.packageSize ?? versionEntity.sizeBytes;
                  versionEntity.packageHash =
                    catalogEntry.packageHash ?? versionEntity.packageHash;
                  versionEntity.packageHashAlgorithm =
                    catalogEntry.packageHashAlgorithm ??
                    versionEntity.packageHashAlgorithm;
                }

                await this.nugetVersionRepo.save(versionEntity);
              } catch (versionError: unknown) {
                this.logger.error(
                  `Failed to sync NuGet version: ${(versionError as Error).message}`,
                );
              }
            }
          }
        }
      } catch (pkgError: unknown) {
        this.logger.error(
          `Failed to sync NuGet package ${result.id}: ${(pkgError as Error).message}`,
        );
      }
    }

    // Update connection status
    connection.isConnected = true;
    await this.connectionRepo.save(connection);

    await this.auditLogRepo.save(this.auditLogRepo.create({
      action: AuditAction.SettingsUpdate,
      actorId: 'system',
      actorUsername: 'system',
      registryType: connection.registryType,
      resourceType: 'registry',
      resourceName: connection.name,
      details: `Synced ${searchResults.length} NuGet packages`,
      ipAddress: 'system',
      success: true,
    }));
  }

  /**
   * Test connectivity to a specific registry connection.
   */
  async testConnection(connectionId: string): Promise<boolean> {
    const connection = await this.connectionRepo.findOne({
      where: { id: connectionId },
    });

    if (!connection) {
      this.logger.warn(`Connection ${connectionId} not found`);
      return false;
    }

    const credential = await this.credentialRepo.findOne({
      where: { registryConnectionId: connectionId },
    });

    let result = false;

    switch (connection.registryType) {
      case RegistryType.Docker:
        result = await this.dockerConnector.testConnection(
          connection.url,
          credential?.authType === CredentialAuthType.BasicAuth ? credential?.username : undefined,
          credential?.encryptedPassword,
        );
        break;
      case RegistryType.NuGet: {
        const nugetApiKey = credential?.authType === CredentialAuthType.ApiKey || credential?.authType === CredentialAuthType.BearerToken
          ? credential?.encryptedPassword
          : credential?.username;
        const nugetPassword = credential?.authType === CredentialAuthType.BasicAuth ? credential?.encryptedPassword : undefined;
        const nugetHeader = credential?.authType === CredentialAuthType.BearerToken ? 'Authorization' : credential?.headerName;
        result = await this.nugetConnector.testConnection(connection.url, nugetApiKey, nugetPassword, nugetHeader);
        break;
      }
      case RegistryType.NPM: {
        const npmToken = credential?.authType === CredentialAuthType.BearerToken || credential?.authType === CredentialAuthType.ApiKey ? credential?.encryptedPassword : undefined;
        const npmUsername = credential?.authType === CredentialAuthType.BasicAuth ? credential?.username : undefined;
        const npmPassword = credential?.authType === CredentialAuthType.BasicAuth ? credential?.encryptedPassword : undefined;
        result = await this.npmConnector.testConnection(connection.url, npmToken, npmUsername, npmPassword);
        break;
      }
      default:
        this.logger.warn(
          `Unknown registry type: ${connection.registryType}`,
        );
        return false;
    }

    // Update connection status
    connection.isConnected = result;
    await this.connectionRepo.save(connection);

    return result;
  }
}
