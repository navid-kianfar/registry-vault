import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CredentialAuthType, RegistryType } from '@registry-vault/shared/enums';

import { AgentClientService } from './agent-client.service';
import { CredentialCryptoService } from '../common/crypto/credential-crypto.service';
import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { RegistryCredentialEntity } from '../settings/entities/registry-credential.entity';

const EMBEDDED_CONNECTION_NAME = 'Embedded registry';
/** Used when a connection someone else made already holds the preferred name. */
const EMBEDDED_FALLBACK_NAME = 'Embedded registry (built-in)';
const DEFAULT_AGENT_URL = 'http://127.0.0.1:5080';
const DEFAULT_SERVICE_USER = 'registry-vault';

/**
 * The all-in-one image runs a registry and its agent in the same container.
 * When `EMBEDDED_REGISTRY_URL` is set, that registry is registered as a
 * connection on every start so a rotated `AGENT_API_KEY` takes effect without
 * anyone editing the connection by hand.
 *
 * This is the only place Registry Vault creates a registry connection on its
 * own; without the variable nothing is created.
 */
@Injectable()
export class EmbeddedRegistryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbeddedRegistryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly credentialCrypto: CredentialCryptoService,
    private readonly agentClient: AgentClientService,
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
    @InjectRepository(RegistryCredentialEntity)
    private readonly credentialRepo: Repository<RegistryCredentialEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.register();
  }

  async register(): Promise<void> {
    const registryUrl = this.config.get<string>('EMBEDDED_REGISTRY_URL')?.trim();
    if (!registryUrl) return;

    const apiKey = this.config.get<string>('AGENT_API_KEY')?.trim();
    if (!apiKey) {
      // Fail fast: an all-in-one image without the key cannot talk to its own
      // registry, and a connection saved without one is worse than none.
      throw new Error(
        'EMBEDDED_REGISTRY_URL is set but AGENT_API_KEY is missing — the embedded registry cannot be registered without the agent key.',
      );
    }

    const agentUrl =
      this.config.get<string>('EMBEDDED_AGENT_URL')?.trim() || DEFAULT_AGENT_URL;
    const serviceUser =
      this.config.get<string>('AGENT_SERVICE_USER')?.trim() || DEFAULT_SERVICE_USER;

    const connection = await this.upsertConnection(registryUrl, agentUrl, apiKey);
    await this.upsertCredential(connection, serviceUser, apiKey);

    this.logger.log(
      `Embedded registry registered: ${registryUrl} with its agent at ${agentUrl}`,
    );

    await this.probeAgent(connection);
  }

  /**
   * Find the embedded connection, or make one.
   *
   * Only `isEmbedded` identifies it. Matching on the name as well meant a
   * connection someone had created by hand and called "Embedded registry" was
   * adopted on the next start — its URL rewritten and its credential replaced
   * with the agent key. If that name is taken by a connection we do not own,
   * the embedded one takes a different name and the other is left alone.
   */
  private async upsertConnection(
    registryUrl: string,
    agentUrl: string,
    apiKey: string,
  ): Promise<RegistryConnectionEntity> {
    const existing = await this.connectionRepo.findOne({ where: { isEmbedded: true } });

    const entity = existing ?? this.connectionRepo.create({
      name: await this.resolveFreeName(),
    });

    entity.registryType = RegistryType.Docker;
    entity.url = registryUrl;
    entity.isEmbedded = true;
    entity.agentUrl = agentUrl;
    entity.encryptedAgentApiKey = this.credentialCrypto.encrypt(apiKey);
    if (!entity.agentConfiguredAt) {
      entity.agentConfiguredAt = new Date().toISOString();
    }

    return this.connectionRepo.save(entity);
  }

  /** The embedded connection's name, avoiding one a hand-made connection already uses. */
  private async resolveFreeName(): Promise<string> {
    const clash = await this.connectionRepo.findOne({
      where: { name: EMBEDDED_CONNECTION_NAME },
    });

    if (!clash) return EMBEDDED_CONNECTION_NAME;

    this.logger.warn(
      `A connection named "${EMBEDDED_CONNECTION_NAME}" already exists and is not the built-in one; registering the embedded registry as "${EMBEDDED_FALLBACK_NAME}" instead`,
    );
    return EMBEDDED_FALLBACK_NAME;
  }

  private async upsertCredential(
    connection: RegistryConnectionEntity,
    username: string,
    apiKey: string,
  ): Promise<void> {
    const existing = await this.credentialRepo.findOne({
      where: { registryConnectionId: connection.id },
    });

    const entity =
      existing ?? this.credentialRepo.create({ registryConnectionId: connection.id });

    entity.registryName = connection.name;
    entity.authType = CredentialAuthType.BasicAuth;
    entity.username = username;
    // The agent's service principal authenticates on :5000 with the API key as
    // its password, so rotating the key rotates both at once.
    entity.encryptedPassword = this.credentialCrypto.encrypt(apiKey);

    await this.credentialRepo.save(entity);
  }

  /** Populate the cached agent info, so features (scan, users) are known before first use. */
  private async probeAgent(connection: RegistryConnectionEntity): Promise<void> {
    try {
      const info = await this.agentClient.probe(connection);
      this.logger.log(
        `Embedded agent ${info.version} (registry ${info.registryVersion}) reports features: ${info.features.join(', ')}`,
      );
    } catch (error: unknown) {
      // The agent may still be starting; the poller and the UI will retry.
      this.logger.warn(
        `Embedded agent did not answer on start: ${(error as Error).message}`,
      );
    }
  }
}
