import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  AgentFeature,
  AgentLogSource,
  AgentStatus,
  IAgentGcJob,
  IAgentHealth,
  IAgentInfo,
  IAgentLogs,
  IAgentMaintenance,
  IAgentSettings,
  IAgentStorage,
  IAgentUploads,
  ICreateRegistryUserRequest,
  IPurgeUploadsResult,
  IRegistryUser,
  IRegistryUserResult,
  IScanResult,
  IUpdateMaintenanceRequest,
  IUpdateRegistryUserRequest,
} from '@registry-vault/shared';

import { RegistryConnectionEntity } from '../settings/entities/registry-connection.entity';
import { CredentialCryptoService } from '../common/crypto/credential-crypto.service';
import { describeFetchFailure, normalizeRegistryUrl } from '../registry-sync/connectors/registry-url';

/** One agent event as the agent's `/api/v1/events` feed returns it. */
export interface AgentEvent {
  seq: number;
  type: 'pull' | 'push' | 'delete';
  repository: string;
  reference: string;
  digest?: string;
  actor: string;
  remoteAddr?: string;
  userAgent?: string;
  at: string;
}

export interface AgentEventPage {
  events: AgentEvent[];
  nextAfter: number;
  oldestSeq: number;
  /** The agent pruned events before `after`, so what came before is lost. */
  gap?: boolean;
}

/** Actor the agent stamps on Vault's own sync traffic; never counted as a pull. */
export const VAULT_SERVICE_ACTOR = 'registry-vault';

/** Most requests are a local HTTP hop; GC and scans are queued, not awaited. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Walking the whole storage root with `?refresh=true` is I/O bound and can take
 * far longer than a management call on a registry with thousands of blobs.
 */
const STORAGE_TIMEOUT_MS = 60_000;

const API_BASE = '/api/v1';

interface AgentErrorBody {
  error?: string;
  message?: string;
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

/**
 * Typed client for one registry agent (agent/API.md).
 *
 * Every call carries the connection's own bearer key, decrypted in memory only,
 * and refreshes the connection's cached agent status so the UI can show whether
 * the agent answered without probing it separately.
 */
@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);

  constructor(
    @InjectRepository(RegistryConnectionEntity)
    private readonly connectionRepo: Repository<RegistryConnectionEntity>,
    private readonly credentialCrypto: CredentialCryptoService,
  ) {}

  /** True when this connection has an agent configured at all. */
  hasAgent(connection: RegistryConnectionEntity): boolean {
    return Boolean(connection.agentUrl && connection.agentUrl.trim());
  }

  /** The connection, or 404 when it has no agent — the contract's answer for every relay route. */
  async requireAgentConnection(connectionId: string): Promise<RegistryConnectionEntity> {
    const connection = await this.connectionRepo.findOne({ where: { id: connectionId } });
    if (!connection) {
      throw new NotFoundException(`Registry connection "${connectionId}" not found`);
    }
    if (!this.hasAgent(connection)) {
      throw new NotFoundException(
        `Registry connection "${connection.name}" has no agent configured`,
      );
    }
    return connection;
  }

  hasFeature(connection: RegistryConnectionEntity, feature: AgentFeature): boolean {
    return (connection.agentFeatures ?? []).includes(feature);
  }

  // ---- Routes ----

  getInfo(connection: RegistryConnectionEntity): Promise<IAgentInfo> {
    return this.request<IAgentInfo>(connection, 'info');
  }

  getHealth(connection: RegistryConnectionEntity): Promise<IAgentHealth> {
    return this.request<IAgentHealth>(connection, 'health');
  }

  getStorage(connection: RegistryConnectionEntity, refresh: boolean): Promise<IAgentStorage> {
    return this.request<IAgentStorage>(connection, 'storage', {
      query: { refresh },
      timeoutMs: refresh ? STORAGE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
    });
  }

  startGc(connection: RegistryConnectionEntity, dryRun: boolean): Promise<IAgentGcJob> {
    return this.request<IAgentGcJob>(connection, 'gc', {
      method: 'POST',
      body: { dryRun },
    });
  }

  /** The current or latest GC job, or null when none has ever run (the agent answers 404). */
  async getGc(connection: RegistryConnectionEntity): Promise<IAgentGcJob | null> {
    try {
      return await this.request<IAgentGcJob>(connection, 'gc');
    } catch (error: unknown) {
      if (error instanceof NotFoundException && connection.agentUrl) return null;
      throw error;
    }
  }

  async getGcHistory(connection: RegistryConnectionEntity): Promise<IAgentGcJob[]> {
    const response = await this.request<{ jobs?: IAgentGcJob[] }>(connection, 'gc/history');
    return response.jobs ?? [];
  }

  /**
   * Remove a repository's directory from storage. `force` is required while it
   * still holds tags; without it the agent answers 409.
   */
  removeRepository(
    connection: RegistryConnectionEntity,
    name: string,
    force: boolean,
  ): Promise<{ removed: string }> {
    const encoded = encodeURIComponent(name);
    return this.request<{ removed: string }>(connection, `repositories/${encoded}`, {
      method: 'DELETE',
      query: { force },
    });
  }

  getUploads(connection: RegistryConnectionEntity, olderThanHours: number): Promise<IAgentUploads> {
    return this.request<IAgentUploads>(connection, 'uploads', {
      query: { olderThanHours },
    });
  }

  purgeUploads(
    connection: RegistryConnectionEntity,
    olderThanHours: number,
  ): Promise<IPurgeUploadsResult> {
    return this.request<IPurgeUploadsResult>(connection, 'uploads/purge', {
      method: 'POST',
      body: { olderThanHours },
    });
  }

  getMaintenance(connection: RegistryConnectionEntity): Promise<IAgentMaintenance> {
    return this.request<IAgentMaintenance>(connection, 'maintenance');
  }

  setMaintenance(
    connection: RegistryConnectionEntity,
    request: IUpdateMaintenanceRequest,
  ): Promise<IAgentMaintenance> {
    return this.request<IAgentMaintenance>(connection, 'maintenance', {
      method: 'PUT',
      body: { readOnly: request.readOnly, reason: request.reason },
    });
  }

  getLogs(
    connection: RegistryConnectionEntity,
    source: AgentLogSource,
    lines: number,
  ): Promise<IAgentLogs> {
    return this.request<IAgentLogs>(connection, 'logs', { query: { source, lines } });
  }

  restartRegistry(connection: RegistryConnectionEntity): Promise<{ restarting: boolean }> {
    return this.request<{ restarting: boolean }>(connection, 'registry/restart', {
      method: 'POST',
    });
  }

  async listUsers(connection: RegistryConnectionEntity): Promise<IRegistryUser[]> {
    const response = await this.request<{ users?: IRegistryUser[] }>(connection, 'users');
    return response.users ?? [];
  }

  createUser(
    connection: RegistryConnectionEntity,
    request: ICreateRegistryUserRequest,
  ): Promise<IRegistryUserResult> {
    return this.request<IRegistryUserResult>(connection, 'users', {
      method: 'POST',
      body: request,
    });
  }

  updateUser(
    connection: RegistryConnectionEntity,
    username: string,
    request: IUpdateRegistryUserRequest,
  ): Promise<IRegistryUserResult> {
    const encoded = encodeURIComponent(username);
    return this.request<IRegistryUserResult>(connection, `users/${encoded}`, {
      method: 'PATCH',
      body: request,
    });
  }

  async deleteUser(connection: RegistryConnectionEntity, username: string): Promise<void> {
    const encoded = encodeURIComponent(username);
    await this.request<void>(connection, `users/${encoded}`, { method: 'DELETE' });
  }

  getEvents(
    connection: RegistryConnectionEntity,
    after: number,
    limit: number,
  ): Promise<AgentEventPage> {
    return this.request<AgentEventPage>(connection, 'events', { query: { after, limit } });
  }

  async queueScan(
    connection: RegistryConnectionEntity,
    repository: string,
    reference: string,
    platform?: string,
  ): Promise<IScanResult> {
    const response = await this.request<{ scan: IScanResult }>(connection, 'scans', {
      method: 'POST',
      body: { repository, reference, platform },
    });
    return response.scan;
  }

  getScan(connection: RegistryConnectionEntity, scanId: string): Promise<IScanResult> {
    const encoded = encodeURIComponent(scanId);
    return this.request<IScanResult>(connection, `scans/${encoded}`);
  }

  // ---- Probing and status ----

  /**
   * Probe an agent with the given url/key, or the connection's stored ones.
   *
   * The stored key is only ever sent to the stored URL. Testing any other
   * address requires the caller to supply the key too — resolving the two
   * independently meant `{ url: "http://attacker" }` with no key handed the
   * decrypted key straight to that host, which is exactly what the edit form
   * submits when someone types a new URL.
   *
   * A probe of an address the connection does not hold is also treated as a
   * probe of a stranger: it neither caches the agent's version and features on
   * the connection nor touches its status, because that answer describes some
   * other agent.
   */
  async probe(
    connection: RegistryConnectionEntity,
    overrideUrl?: string,
    overrideApiKey?: string,
  ): Promise<IAgentInfo> {
    const requestedUrl = overrideUrl?.trim();
    const url = requestedUrl || connection.agentUrl;
    if (!url) {
      throw new BadRequestException('No agent URL configured for this connection');
    }

    const suppliedKey = overrideApiKey?.trim();
    const isStoredUrl = url === connection.agentUrl;

    if (!isStoredUrl && !suppliedKey) {
      throw new BadRequestException(
        'Testing an agent URL that is not the one saved on this connection requires "apiKey" — Registry Vault will not send the stored key to another address',
      );
    }

    const apiKey = suppliedKey || this.resolveApiKey(connection);

    if (!isStoredUrl) {
      return this.send<IAgentInfo>(null, url, apiKey, 'info', {});
    }

    const info = await this.send<IAgentInfo>(connection, url, apiKey, 'info', {});
    await this.rememberInfo(connection, info);
    return info;
  }

  /**
   * Probe an agent that belongs to no connection yet, so a registry can be
   * checked before it is saved. Nothing is stored and the key is not echoed.
   */
  async probeUnsaved(url: string, apiKey: string): Promise<IAgentInfo> {
    const trimmedUrl = url?.trim();
    const trimmedKey = apiKey?.trim();

    if (!trimmedUrl) throw new BadRequestException('An agent URL is required');
    if (!trimmedKey) throw new BadRequestException('An agent API key is required');

    return this.send<IAgentInfo>(null, trimmedUrl, trimmedKey, 'info', {});
  }

  /** Vault's own view of "the disk is filling up", from the connection's threshold. */
  isLowDisk(connection: RegistryConnectionEntity, usedPercent: number): boolean {
    return usedPercent >= connection.lowDiskWarningPercent;
  }

  private resolveApiKey(connection: RegistryConnectionEntity): string {
    if (!connection.encryptedAgentApiKey) {
      throw new BadRequestException(
        `No agent API key stored for registry connection "${connection.name}"`,
      );
    }
    return this.credentialCrypto.decrypt(connection.encryptedAgentApiKey);
  }

  private async request<T>(
    connection: RegistryConnectionEntity,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    if (!connection.agentUrl) {
      throw new NotFoundException(
        `Registry connection "${connection.name}" has no agent configured`,
      );
    }

    const apiKey = this.resolveApiKey(connection);
    return this.send<T>(connection, connection.agentUrl, apiKey, path, options);
  }

  private async send<T>(
    connection: RegistryConnectionEntity | null,
    agentUrl: string,
    apiKey: string,
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const base = normalizeRegistryUrl(agentUrl);
    const url = new URL(`${base}${API_BASE}/${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }

    const method = options.method ?? 'GET';
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const target = url.toString();

    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const reason = describeFetchFailure(target, error, timeoutMs);
      await this.rememberStatus(connection, 'offline');
      throw new BadGatewayException(
        `Registry agent at ${base} is unreachable — ${reason}`,
      );
    }

    if (!response.ok) {
      throw await this.toException(connection, base, response);
    }

    await this.rememberStatus(connection, 'online');

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /**
   * Map the agent's error envelope onto Nest exceptions, keeping the agent's
   * own message (it is operator-facing and carries no secrets) and never the
   * body of an unexpected response, which could be anything a proxy returned.
   */
  private async toException(
    connection: RegistryConnectionEntity | null,
    base: string,
    response: Response,
  ): Promise<Error> {
    let body: AgentErrorBody = {};
    try {
      const text = await response.text();
      if (text) body = JSON.parse(text) as AgentErrorBody;
    } catch {
      body = {};
    }
    const message = body.message ?? body.error;

    switch (response.status) {
      case 401:
      case 403:
        await this.rememberStatus(connection, 'unauthorized');
        return new BadGatewayException(
          `Registry agent at ${base} rejected the API key`,
        );
      case 404:
        await this.rememberStatus(connection, 'online');
        return new NotFoundException(message ?? 'The registry agent found no such resource');
      case 409:
        await this.rememberStatus(connection, 'online');
        return new ConflictException(message ?? 'The registry agent refused: another job is running');
      case 400:
        await this.rememberStatus(connection, 'online');
        return new BadRequestException(message ?? 'The registry agent rejected the request');
      case 503:
        await this.rememberStatus(connection, 'online');
        return new ServiceUnavailableException(
          message ?? 'The registry agent is temporarily unavailable',
        );
      default:
        await this.rememberStatus(connection, 'offline');
        return new BadGatewayException(
          `Registry agent at ${base} answered ${response.status}${message ? ` — ${message}` : ''}`,
        );
    }
  }

  /** Cache the status on the connection row so the UI need not probe the agent. */
  private async rememberStatus(
    connection: RegistryConnectionEntity | null,
    status: AgentStatus,
  ): Promise<void> {
    if (!connection) return;

    const seenAt = status === 'online' ? new Date().toISOString() : connection.agentLastSeenAt;
    if (connection.agentStatus === status && connection.agentLastSeenAt === seenAt) return;

    connection.agentStatus = status;
    connection.agentLastSeenAt = seenAt;

    try {
      await this.connectionRepo.update(connection.id, {
        agentStatus: status,
        agentLastSeenAt: seenAt,
      });
    } catch (error: unknown) {
      // A status cache that cannot be written must not fail the call it describes.
      this.logger.warn(
        `Could not cache agent status for ${connection.name}: ${(error as Error).message}`,
      );
    }
  }

  private async rememberInfo(
    connection: RegistryConnectionEntity,
    info: IAgentInfo,
  ): Promise<void> {
    connection.agentVersion = info.version;
    connection.agentRegistryVersion = info.registryVersion;
    connection.agentFeatures = info.features;

    await this.connectionRepo.update(connection.id, {
      agentVersion: info.version,
      agentRegistryVersion: info.registryVersion,
      agentFeatures: info.features,
    });
  }
}
