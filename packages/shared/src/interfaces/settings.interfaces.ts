import { RegistryType, StorageBackend, WebhookEvent } from '../enums';
import type { IRegistryAgentSummary } from './agent.interfaces';

export interface IRegistryConnection {
  id: string;
  registryType: RegistryType;
  name: string;
  url: string;
  isDefault: boolean;
  isConnected: boolean;
  username?: string;
  /** Docker only: the registry agent beside this registry, when configured. */
  agent?: IRegistryAgentSummary;
  /** True for the registry embedded in the all-in-one image (created from env). */
  isEmbedded?: boolean;
}

export interface ICreateRegistryConnectionRequest {
  registryType: RegistryType;
  name: string;
  url: string;
  isDefault?: boolean;
  username?: string;
  /** Docker only. Management API of the registry agent, e.g. http://registry:5080 */
  agentUrl?: string;
  /** Write-only; stored encrypted, never returned. */
  agentApiKey?: string;
}

export interface IUpdateRegistryConnectionRequest {
  name?: string;
  url?: string;
  isDefault?: boolean;
  username?: string;
  /** Empty string removes the agent. */
  agentUrl?: string;
  /** Write-only. Omit to keep the stored key. */
  agentApiKey?: string;
}

export interface IStorageConfig {
  backend: StorageBackend;
  path?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
}

export interface IRetentionPolicy {
  id: string;
  registryType: RegistryType;
  name: string;
  enabled: boolean;
  keepLastN?: number;
  olderThanDays?: number;
  tagPatternExclude?: string;
  /**
   * Docker only: delete tags nobody pulled for this many days. Repositories on
   * connections without an agent have no pull data and are SKIPPED by such a
   * policy (never treated as "not pulled").
   */
  notPulledForDays?: number;
  /** Docker only: run garbage collection afterwards on registries with an agent. */
  runGcAfter?: boolean;
}

export interface ICreateRetentionPolicyRequest {
  registryType: RegistryType;
  name: string;
  enabled?: boolean;
  keepLastN?: number;
  olderThanDays?: number;
  tagPatternExclude?: string;
  /**
   * Docker only: delete tags nobody pulled for this many days. Repositories on
   * connections without an agent have no pull data and are SKIPPED by such a
   * policy (never treated as "not pulled").
   */
  notPulledForDays?: number;
  /** Docker only: run garbage collection afterwards on registries with an agent. */
  runGcAfter?: boolean;
}

export interface IUpdateRetentionPolicyRequest {
  name?: string;
  enabled?: boolean;
  keepLastN?: number;
  olderThanDays?: number;
  tagPatternExclude?: string;
  /**
   * Docker only: delete tags nobody pulled for this many days. Repositories on
   * connections without an agent have no pull data and are SKIPPED by such a
   * policy (never treated as "not pulled").
   */
  notPulledForDays?: number;
  /** Docker only: run garbage collection afterwards on registries with an agent. */
  runGcAfter?: boolean;
}

export interface IWebhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  registryType?: RegistryType;
  isActive: boolean;
  secret?: string;
  lastTriggeredAt?: string;
  lastStatusCode?: number;
}

export interface ICreateWebhookRequest {
  name: string;
  url: string;
  events: WebhookEvent[];
  registryType?: RegistryType;
  isActive?: boolean;
  secret?: string;
}

export interface IUpdateWebhookRequest {
  name?: string;
  url?: string;
  events?: WebhookEvent[];
  registryType?: RegistryType;
  isActive?: boolean;
  secret?: string;
}

export interface IGeneralSettings {
  instanceName: string;
  instanceUrl: string;
  allowSelfRegistration: boolean;
  defaultRole: number;
  sessionTimeoutMinutes: number;
  maintenanceMode: boolean;
}

/**
 * Outcome of a registry sync. `synced` is false when any connection failed, so
 * the UI can report the failure instead of assuming success.
 */
export interface IRegistrySyncResult {
  synced: boolean;
  /** Connections attempted. */
  attempted: number;
  /** Connections that failed. */
  failed: number;
  /** One human-readable message per failed connection. */
  errors: string[];
}
