import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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
  IRetentionRunResult,
  IAgentTestRequest,
  IAgentInfo,
  IRegistryAgentSummary,
} from '@registry-vault/shared';
import { GeneralSettingsEntity } from './entities/general-settings.entity';
import { RegistryConnectionEntity } from './entities/registry-connection.entity';
import { RegistryCredentialEntity } from './entities/registry-credential.entity';
import { RetentionPolicyEntity } from './entities/retention-policy.entity';
import { WebhookEntity } from './entities/webhook.entity';
import { CredentialCryptoService } from '../common/crypto/credential-crypto.service';
import { BulkService } from '../bulk/bulk.service';
import { AgentClientService } from '../agent/agent-client.service';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

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
    private readonly credentialCrypto: CredentialCryptoService,
    private readonly bulkService: BulkService,
    private readonly agentClient: AgentClientService,
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

  /**
   * The connection as the browser sees it. The agent's API key is never part of
   * this — it is write-only, stored encrypted and used only server-side.
   */
  private mapConnection(entity: RegistryConnectionEntity): IRegistryConnection {
    return {
      id: entity.id,
      registryType: entity.registryType,
      name: entity.name,
      url: entity.url,
      isDefault: entity.isDefault,
      isConnected: entity.isConnected,
      username: entity.username ?? undefined,
      agent: mapAgentSummary(entity),
      isEmbedded: entity.isEmbedded ?? false,
    };
  }

  /**
   * Apply the agent fields of a create/update request.
   *
   * An empty `agentUrl` removes the agent, key and cached info alike.
   *
   * Pointing the connection at a *different* agent URL requires the API key in
   * the same request. Vault sends that key as a bearer token to whatever host
   * the URL names, so accepting a new URL on its own would hand the stored key
   * to a server the caller chose — the key leaves with the first health poll.
   * Re-saving the same URL needs no key, so the rest of the form still submits.
   */
  private applyAgentFields(
    entity: RegistryConnectionEntity,
    request: { agentUrl?: string; agentApiKey?: string },
  ): void {
    const apiKey = request.agentApiKey?.trim();

    if (request.agentUrl !== undefined) {
      const url = request.agentUrl.trim();

      if (!url) {
        // null, not undefined: TypeORM's save() skips undefined properties, so
        // clearing the agent with undefined left every value in place.
        entity.agentUrl = null;
        entity.encryptedAgentApiKey = null;
        entity.agentStatus = null;
        entity.agentVersion = null;
        entity.agentRegistryVersion = null;
        entity.agentFeatures = null;
        entity.agentLastSeenAt = null;
        entity.agentConfiguredAt = null;
        return;
      }

      if (url !== entity.agentUrl && !apiKey) {
        throw new BadRequestException(
          'Changing the agent URL requires "agentApiKey" in the same request — Registry Vault will not send the stored key to a new address',
        );
      }

      if (url !== entity.agentUrl) {
        // A different agent is a different event log: its sequence numbers have
        // nothing to do with the old one's, and its cached info is not ours.
        entity.agentEventCursor = 0;
        entity.eventsIncomplete = false;
        entity.agentStatus = null;
        entity.agentVersion = null;
        entity.agentRegistryVersion = null;
        entity.agentFeatures = null;
        entity.agentLastSeenAt = null;
      }

      entity.agentUrl = url;
      if (!entity.agentConfiguredAt) {
        // Pull tracking starts now; retention by "not pulled for N days" must
        // not count the time before there was anything watching.
        entity.agentConfiguredAt = new Date().toISOString();
      }
    }

    if (apiKey) {
      entity.encryptedAgentApiKey = this.credentialCrypto.encrypt(apiKey);
    }
  }

  /**
   * Forget the secret of every credential attached to a connection.
   *
   * Called when the connection's registry URL changes: the stored password or
   * token was issued by the old registry, and the next sync would send it to
   * whatever host the new URL names. The credential row, its username and its
   * auth type survive, so the operator only has to re-enter the secret.
   */
  private async forgetCredentialSecrets(connectionId: string): Promise<void> {
    const result = await this.registryCredentialRepository.update(
      { registryConnectionId: connectionId },
      { encryptedPassword: null },
    );

    if ((result.affected ?? 0) > 0) {
      this.logger.warn(
        `Registry URL changed on connection ${connectionId}: cleared ${result.affected} stored credential secret(s); they must be re-entered`,
      );
    }
  }

  /**
   * Probe the agent of a connection, optionally with a url and key that have
   * not been saved yet, so the UI can check before committing them.
   */
  async testRegistryAgent(id: string, request: IAgentTestRequest): Promise<IAgentInfo> {
    const entity = await this.registryConnectionRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Registry connection with id "${id}" not found`);
    }

    const url = request.url?.trim() || entity.agentUrl;
    if (!url) {
      throw new BadRequestException(
        'No agent URL to test — set one on the connection or pass it with the request',
      );
    }

    return this.agentClient.probe(entity, url, request.apiKey);
  }

  /**
   * Probe an agent before its connection exists, so the Settings form can check
   * a URL and key the user is still typing. Nothing is stored.
   */
  async testUnsavedRegistryAgent(request: IAgentTestRequest): Promise<IAgentInfo> {
    if (!request.url?.trim() || !request.apiKey?.trim()) {
      throw new BadRequestException(
        'Both "url" and "apiKey" are required to test an agent that is not saved yet',
      );
    }

    return this.agentClient.probeUnsaved(request.url, request.apiKey);
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

    this.applyAgentFields(entity, request);

    const saved = await this.registryConnectionRepository.save(entity);
    return this.mapConnection(saved);
  }

  async updateRegistryConnection(id: string, request: IUpdateRegistryConnectionRequest): Promise<IRegistryConnection> {
    const entity = await this.registryConnectionRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Registry connection with id "${id}" not found`);
    }

    if (request.name !== undefined) entity.name = request.name;
    if (request.isDefault !== undefined) entity.isDefault = request.isDefault;
    if (request.username !== undefined) entity.username = request.username || null;

    // Whether the registry itself moved; the credential for the old host must
    // not follow it to the new one.
    const url = request.url?.trim();
    const isNewRegistryUrl = url !== undefined && url !== entity.url;

    if (url !== undefined) {
      if (!url) {
        throw new BadRequestException('"url" cannot be empty');
      }
      entity.url = url;
    }

    this.applyAgentFields(entity, request);

    if (isNewRegistryUrl) {
      entity.isConnected = false;
    }

    const saved = await this.registryConnectionRepository.save(entity);

    if (isNewRegistryUrl) {
      await this.forgetCredentialSecrets(saved.id);
    }

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
      notPulledForDays: entity.notPulledForDays,
      runGcAfter: entity.runGcAfter ?? false,
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
      notPulledForDays: request.notPulledForDays,
      runGcAfter: request.runGcAfter ?? false,
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
    if (request.notPulledForDays !== undefined) entity.notPulledForDays = request.notPulledForDays;
    if (request.runGcAfter !== undefined) entity.runGcAfter = request.runGcAfter;

    const saved = await this.retentionPolicyRepository.save(entity);
    return this.mapPolicy(saved);
  }

  async deleteRetentionPolicy(id: string): Promise<void> {
    const entity = await this.retentionPolicyRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Retention policy with id "${id}" not found`);
    await this.retentionPolicyRepository.remove(entity);
  }

  /**
   * Run a retention policy now. Deletes from the registry itself through the
   * same path as a manual cleanup; removing only the local rows freed nothing
   * and the next sync brought every version back.
   */
  async runRetentionPolicy(id: string): Promise<IRetentionRunResult> {
    const policy = await this.retentionPolicyRepository.findOne({ where: { id } });
    if (!policy) throw new NotFoundException(`Retention policy with id "${id}" not found`);

    return this.bulkService.runRetention(policy);
  }

  private mapWebhook(entity: WebhookEntity): IWebhook {
    return {
      id: entity.id,
      name: entity.name,
      url: entity.url,
      events: entity.events ?? [],
      registryType: entity.registryType ?? undefined,
      isActive: entity.isActive,
      secret: entity.secret ?? undefined,
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
    // An empty secret means "no secret", not a secret that is the empty string.
    if (request.secret !== undefined) entity.secret = request.secret || null;

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
      // Transparently upgrade legacy plaintext rows to encrypted storage
      await this.credentialCrypto.migrateAtRest(entity);

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
      encryptedPassword: request.password
        ? this.credentialCrypto.encrypt(request.password)
        : null,
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

    // A secret belongs to the scheme it was entered for: a Basic password is not
    // a bearer token. Switching the scheme without supplying a new secret drops
    // the old one rather than sending it under the wrong header.
    const isNewAuthType =
      request.authType !== undefined && request.authType !== entity.authType;

    if (request.authType !== undefined) entity.authType = request.authType;
    if (request.username !== undefined) entity.username = request.username || null;
    if (request.headerName !== undefined) entity.headerName = request.headerName || null;

    // null, not undefined or '': TypeORM's save() skips undefined, and an empty
    // string would sit in the column looking like a stored secret.
    if (request.password !== undefined) {
      entity.encryptedPassword = request.password
        ? this.credentialCrypto.encrypt(request.password)
        : null;
    } else if (isNewAuthType) {
      entity.encryptedPassword = null;
      this.logger.warn(
        `Credential ${entity.id} changed auth type without a new secret; the stored one was cleared`,
      );
    }

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

/**
 * The agent block of a connection, or undefined when none is configured.
 * `status` falls back to offline: an agent Vault has never reached is not
 * reported as online just because a URL is stored.
 */
function mapAgentSummary(
  entity: RegistryConnectionEntity,
): IRegistryAgentSummary | undefined {
  if (!entity.agentUrl) return undefined;

  return {
    url: entity.agentUrl,
    status: entity.agentStatus ?? 'offline',
    version: entity.agentVersion ?? undefined,
    registryVersion: entity.agentRegistryVersion ?? undefined,
    features: entity.agentFeatures ?? [],
    lastSeenAt: entity.agentLastSeenAt ?? undefined,
  };
}
