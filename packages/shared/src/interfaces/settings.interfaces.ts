import { RegistryType, StorageBackend, WebhookEvent } from '../enums';

export interface IRegistryConnection {
  id: string;
  registryType: RegistryType;
  name: string;
  url: string;
  isDefault: boolean;
  isConnected: boolean;
  username?: string;
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

export interface IGeneralSettings {
  instanceName: string;
  instanceUrl: string;
  allowSelfRegistration: boolean;
  defaultRole: number;
  sessionTimeoutMinutes: number;
  maintenanceMode: boolean;
}
