import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  IGeneralSettings,
  IRegistryConnection,
  ICreateRegistryConnectionRequest,
  IUpdateRegistryConnectionRequest,
  IRetentionPolicy,
  ICreateRetentionPolicyRequest,
  IUpdateRetentionPolicyRequest,
  IWebhook,
  ICreateWebhookRequest,
  IUpdateWebhookRequest,
  IRegistryCredential,
  ICreateCredentialRequest,
  IUpdateCredentialRequest,
} from '@registry-vault/shared';
import { GeneralSettingsEntity } from './entities/general-settings.entity';
import { RegistryConnectionEntity } from './entities/registry-connection.entity';
import { RegistryCredentialEntity } from './entities/registry-credential.entity';
import { RetentionPolicyEntity } from './entities/retention-policy.entity';
import { WebhookEntity } from './entities/webhook.entity';
import { DockerTagEntity } from '../docker/entities/docker-tag.entity';
import { NpmPackageVersionEntity } from '../npm/entities/npm-package-version.entity';
import { NuGetPackageVersionEntity } from '../nuget/entities/nuget-package-version.entity';
import { RegistryType } from '@registry-vault/shared';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(GeneralSettingsEntity)
    private readonly generalSettingsRepository: Repository<GeneralSettingsEntity>,
    @InjectRepository(RegistryConnectionEntity)
    private readonly registryConnectionRepository: Repository<RegistryConnectionEntity>,
    @InjectRepository(RegistryCredentialEntity)
    private readonly registryCredentialRepository: Repository<RegistryCredentialEntity>,
    @InjectRepository(RetentionPolicyEntity)
    private readonly retentionPolicyRepository: Repository<RetentionPolicyEntity>,
    @InjectRepository(WebhookEntity)
    private readonly webhookRepository: Repository<WebhookEntity>,
    @InjectRepository(DockerTagEntity)
    private readonly dockerTagRepository: Repository<DockerTagEntity>,
    @InjectRepository(NpmPackageVersionEntity)
    private readonly npmVersionRepository: Repository<NpmPackageVersionEntity>,
    @InjectRepository(NuGetPackageVersionEntity)
    private readonly nugetVersionRepository: Repository<NuGetPackageVersionEntity>,
  ) {}

  async getGeneralSettings(): Promise<IGeneralSettings> {
    const entity = await this.generalSettingsRepository.findOne({ where: {} });

    if (!entity) {
      return {
        instanceName: 'Registry Vault',
        instanceUrl: 'http://localhost:3001',
        allowSelfRegistration: false,
        defaultRole: 2,
        sessionTimeoutMinutes: 60,
        maintenanceMode: false,
      };
    }

    return {
      instanceName: entity.instanceName,
      instanceUrl: entity.instanceUrl,
      allowSelfRegistration: entity.allowSelfRegistration,
      defaultRole: entity.defaultRole,
      sessionTimeoutMinutes: entity.sessionTimeoutMinutes,
      maintenanceMode: entity.maintenanceMode,
    };
  }

  async updateGeneralSettings(
    partial: Partial<IGeneralSettings>,
  ): Promise<IGeneralSettings> {
    let entity = await this.generalSettingsRepository.findOne({ where: {} });

    if (!entity) {
      entity = this.generalSettingsRepository.create();
    }

    if (partial.instanceName !== undefined) entity.instanceName = partial.instanceName;
    if (partial.instanceUrl !== undefined) entity.instanceUrl = partial.instanceUrl;
    if (partial.allowSelfRegistration !== undefined)
      entity.allowSelfRegistration = partial.allowSelfRegistration;
    if (partial.defaultRole !== undefined) entity.defaultRole = partial.defaultRole;
    if (partial.sessionTimeoutMinutes !== undefined)
      entity.sessionTimeoutMinutes = partial.sessionTimeoutMinutes;
    if (partial.maintenanceMode !== undefined)
      entity.maintenanceMode = partial.maintenanceMode;

    const saved = await this.generalSettingsRepository.save(entity);

    return {
      instanceName: saved.instanceName,
      instanceUrl: saved.instanceUrl,
      allowSelfRegistration: saved.allowSelfRegistration,
      defaultRole: saved.defaultRole,
      sessionTimeoutMinutes: saved.sessionTimeoutMinutes,
      maintenanceMode: saved.maintenanceMode,
    };
  }

  async getRegistryConnections(): Promise<IRegistryConnection[]> {
    const entities = await this.registryConnectionRepository.find();
    return entities.map((e) => this.mapConnection(e));
  }

  private mapConnection(entity: RegistryConnectionEntity): IRegistryConnection {
    return {
      id: entity.id,
      registryType: entity.registryType,
      name: entity.name,
      url: entity.url,
      isDefault: entity.isDefault,
      isConnected: entity.isConnected,
      username: entity.username,
    };
  }

  async createRegistryConnection(request: ICreateRegistryConnectionRequest): Promise<IRegistryConnection> {
    const existing = await this.registryConnectionRepository.findOne({
      where: { name: request.name },
    });
    if (existing) {
      throw new BadRequestException(`A registry connection named "${request.name}" already exists`);
    }

    const entity = this.registryConnectionRepository.create({
      registryType: request.registryType,
      name: request.name,
      url: request.url,
      isDefault: request.isDefault ?? false,
      isConnected: false,
      username: request.username,
    });

    const saved = await this.registryConnectionRepository.save(entity);
    return this.mapConnection(saved);
  }

  async updateRegistryConnection(id: string, request: IUpdateRegistryConnectionRequest): Promise<IRegistryConnection> {
    const entity = await this.registryConnectionRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Registry connection with id "${id}" not found`);
    }

    if (request.name !== undefined) entity.name = request.name;
    if (request.url !== undefined) entity.url = request.url;
    if (request.isDefault !== undefined) entity.isDefault = request.isDefault;
    if (request.username !== undefined) entity.username = request.username;

    const saved = await this.registryConnectionRepository.save(entity);
    return this.mapConnection(saved);
  }

  async deleteRegistryConnection(id: string): Promise<void> {
    const entity = await this.registryConnectionRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Registry connection with id "${id}" not found`);
    }
    await this.registryConnectionRepository.remove(entity);
  }

  private mapPolicy(entity: RetentionPolicyEntity): IRetentionPolicy {
    return {
      id: entity.id,
      registryType: entity.registryType,
      name: entity.name,
      enabled: entity.enabled,
      keepLastN: entity.keepLastN,
      olderThanDays: entity.olderThanDays,
      tagPatternExclude: entity.tagPatternExclude,
    };
  }

  async getRetentionPolicies(): Promise<IRetentionPolicy[]> {
    const entities = await this.retentionPolicyRepository.find();
    return entities.map((e) => this.mapPolicy(e));
  }

  async createRetentionPolicy(request: ICreateRetentionPolicyRequest): Promise<IRetentionPolicy> {
    const entity = this.retentionPolicyRepository.create({
      registryType: request.registryType,
      name: request.name,
      enabled: request.enabled ?? false,
      keepLastN: request.keepLastN,
      olderThanDays: request.olderThanDays,
      tagPatternExclude: request.tagPatternExclude,
    });
    const saved = await this.retentionPolicyRepository.save(entity);
    return this.mapPolicy(saved);
  }

  async updateRetentionPolicy(id: string, request: IUpdateRetentionPolicyRequest): Promise<IRetentionPolicy> {
    const entity = await this.retentionPolicyRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Retention policy with id "${id}" not found`);

    if (request.name !== undefined) entity.name = request.name;
    if (request.enabled !== undefined) entity.enabled = request.enabled;
    if (request.keepLastN !== undefined) entity.keepLastN = request.keepLastN;
    if (request.olderThanDays !== undefined) entity.olderThanDays = request.olderThanDays;
    if (request.tagPatternExclude !== undefined) entity.tagPatternExclude = request.tagPatternExclude;

    const saved = await this.retentionPolicyRepository.save(entity);
    return this.mapPolicy(saved);
  }

  async deleteRetentionPolicy(id: string): Promise<void> {
    const entity = await this.retentionPolicyRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Retention policy with id "${id}" not found`);
    await this.retentionPolicyRepository.remove(entity);
  }

  async runRetentionPolicy(id: string): Promise<{ deleted: number }> {
    const policy = await this.retentionPolicyRepository.findOne({ where: { id } });
    if (!policy) throw new NotFoundException(`Retention policy with id "${id}" not found`);

    const olderThanDate = policy.olderThanDays
      ? new Date(Date.now() - policy.olderThanDays * 24 * 60 * 60 * 1000)
      : undefined;

    let deleted = 0;

    if (policy.registryType === RegistryType.Docker) {
      const repoIds: { repositoryId: string }[] = await this.dockerTagRepository
        .createQueryBuilder('tag')
        .select('DISTINCT tag.repositoryId', 'repositoryId')
        .getRawMany();

      for (const { repositoryId } of repoIds) {
        const tags = await this.dockerTagRepository.find({
          where: { repositoryId },
          order: { pushedAt: 'DESC' },
        });
        const toDelete = this.selectForCleanup(tags, policy.keepLastN, olderThanDate, (t) => new Date(t.pushedAt));
        if (toDelete.length > 0) {
          await this.dockerTagRepository.remove(toDelete);
          deleted += toDelete.length;
        }
      }
    } else if (policy.registryType === RegistryType.NPM) {
      const packageIds: { packageId: string }[] = await this.npmVersionRepository
        .createQueryBuilder('v')
        .select('DISTINCT v.packageId', 'packageId')
        .getRawMany();

      for (const { packageId } of packageIds) {
        const versions = await this.npmVersionRepository.find({
          where: { packageId },
          order: { publishedAt: 'DESC' },
        });
        const toDelete = this.selectForCleanup(versions, policy.keepLastN, olderThanDate, (v) => new Date(v.publishedAt));
        if (toDelete.length > 0) {
          await this.npmVersionRepository.remove(toDelete);
          deleted += toDelete.length;
        }
      }
    } else if (policy.registryType === RegistryType.NuGet) {
      const packageIds: { nugetPackageId: string }[] = await this.nugetVersionRepository
        .createQueryBuilder('v')
        .select('DISTINCT v.nugetPackageId', 'nugetPackageId')
        .getRawMany();

      for (const { nugetPackageId } of packageIds) {
        const versions = await this.nugetVersionRepository.find({
          where: { nugetPackageId },
          order: { publishedAt: 'DESC' },
        });
        const toDelete = this.selectForCleanup(versions, policy.keepLastN, olderThanDate, (v) => new Date(v.publishedAt));
        if (toDelete.length > 0) {
          await this.nugetVersionRepository.remove(toDelete);
          deleted += toDelete.length;
        }
      }
    }

    return { deleted };
  }

  private selectForCleanup<T>(items: T[], keepLastN: number | undefined, olderThan: Date | undefined, getDate: (item: T) => Date): T[] {
    let candidates = keepLastN !== undefined ? items.slice(keepLastN) : [...items];
    if (olderThan) {
      candidates = candidates.filter((item) => getDate(item) < olderThan);
    }
    return candidates;
  }

  private mapWebhook(entity: WebhookEntity): IWebhook {
    return {
      id: entity.id,
      name: entity.name,
      url: entity.url,
      events: entity.events ?? [],
      registryType: entity.registryType ?? undefined,
      isActive: entity.isActive,
      secret: entity.secret,
      lastTriggeredAt: entity.lastTriggeredAt ?? undefined,
      lastStatusCode: entity.lastStatusCode ?? undefined,
    };
  }

  async getWebhooks(): Promise<IWebhook[]> {
    const entities = await this.webhookRepository.find();
    return entities.map((e) => this.mapWebhook(e));
  }

  async createWebhook(request: ICreateWebhookRequest): Promise<IWebhook> {
    const entity = this.webhookRepository.create({
      name: request.name,
      url: request.url,
      events: request.events,
      registryType: request.registryType,
      isActive: request.isActive ?? true,
      secret: request.secret,
    });
    const saved = await this.webhookRepository.save(entity);
    return this.mapWebhook(saved);
  }

  async updateWebhook(id: string, request: IUpdateWebhookRequest): Promise<IWebhook> {
    const entity = await this.webhookRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Webhook with id "${id}" not found`);

    if (request.name !== undefined) entity.name = request.name;
    if (request.url !== undefined) entity.url = request.url;
    if (request.events !== undefined) entity.events = request.events;
    if (request.registryType !== undefined) entity.registryType = request.registryType;
    if (request.isActive !== undefined) entity.isActive = request.isActive;
    if (request.secret !== undefined) entity.secret = request.secret;

    const saved = await this.webhookRepository.save(entity);
    return this.mapWebhook(saved);
  }

  async deleteWebhook(id: string): Promise<void> {
    const entity = await this.webhookRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Webhook with id "${id}" not found`);
    await this.webhookRepository.remove(entity);
  }

  async getCredentials(): Promise<IRegistryCredential[]> {
    const entities = await this.registryCredentialRepository.find();

    const credentials: IRegistryCredential[] = [];

    for (const entity of entities) {
      const connection = await this.registryConnectionRepository.findOne({
        where: { id: entity.registryConnectionId },
      });

      credentials.push({
        id: entity.id,
        registryConnectionId: entity.registryConnectionId,
        registryName: connection ? connection.name : entity.registryName,
        authType: entity.authType,
        username: entity.username ?? undefined,
        headerName: entity.headerName ?? undefined,
        createdAt: entity.createdAt.toISOString(),
        updatedAt: entity.updatedAt.toISOString(),
        lastUsedAt: entity.lastUsedAt ?? undefined,
      });
    }

    return credentials;
  }

  async createCredential(
    request: ICreateCredentialRequest,
  ): Promise<IRegistryCredential> {
    const connection = await this.registryConnectionRepository.findOne({
      where: { id: request.registryConnectionId },
    });

    const entity = this.registryCredentialRepository.create({
      registryConnectionId: request.registryConnectionId,
      registryName: connection ? connection.name : '',
      authType: request.authType,
      username: request.username,
      encryptedPassword: request.password,
      headerName: request.headerName,
    });

    const saved = await this.registryCredentialRepository.save(entity);

    return {
      id: saved.id,
      registryConnectionId: saved.registryConnectionId,
      registryName: connection ? connection.name : saved.registryName,
      authType: saved.authType,
      username: saved.username ?? undefined,
      headerName: saved.headerName ?? undefined,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
      lastUsedAt: saved.lastUsedAt ?? undefined,
    };
  }

  async updateCredential(
    id: string,
    request: IUpdateCredentialRequest,
  ): Promise<IRegistryCredential> {
    const entity = await this.registryCredentialRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(`Credential with id "${id}" not found`);
    }

    if (request.authType !== undefined) entity.authType = request.authType;
    if (request.username !== undefined) entity.username = request.username;
    if (request.password !== undefined) entity.encryptedPassword = request.password;
    if (request.headerName !== undefined) entity.headerName = request.headerName;

    const saved = await this.registryCredentialRepository.save(entity);

    const connection = await this.registryConnectionRepository.findOne({
      where: { id: saved.registryConnectionId },
    });

    return {
      id: saved.id,
      registryConnectionId: saved.registryConnectionId,
      registryName: connection ? connection.name : saved.registryName,
      authType: saved.authType,
      username: saved.username ?? undefined,
      headerName: saved.headerName ?? undefined,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
      lastUsedAt: saved.lastUsedAt ?? undefined,
    };
  }

  async deleteCredential(id: string): Promise<void> {
    const entity = await this.registryCredentialRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(`Credential with id "${id}" not found`);
    }

    await this.registryCredentialRepository.remove(entity);
  }
}
