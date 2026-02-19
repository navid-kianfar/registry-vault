import type {
  IGeneralSettings,
  IRegistryConnection,
  IRetentionPolicy,
  IWebhook,
} from '@registryvault/shared';
import { RegistryType, StorageBackend, WebhookEvent } from '@registryvault/shared';

export const generalSettings: IGeneralSettings = {
  instanceName: 'RegistryVault Production',
  instanceUrl: 'https://registry.myorg.io',
  allowSelfRegistration: false,
  defaultRole: 2,
  sessionTimeoutMinutes: 480,
  maintenanceMode: false,
};

export const registryConnections: IRegistryConnection[] = [
  {
    id: 'conn-1',
    registryType: RegistryType.Docker,
    name: 'Primary Docker Registry',
    url: 'https://registry.myorg.io/v2/',
    isDefault: true,
    isConnected: true,
    username: 'registry-admin',
  },
  {
    id: 'conn-2',
    registryType: RegistryType.NuGet,
    name: 'Internal NuGet Feed',
    url: 'https://nuget.myorg.io/v3/index.json',
    isDefault: true,
    isConnected: true,
    username: 'nuget-service',
  },
  {
    id: 'conn-3',
    registryType: RegistryType.NPM,
    name: 'Private NPM Registry',
    url: 'https://npm.myorg.io/',
    isDefault: true,
    isConnected: true,
    username: 'npm-service',
  },
  {
    id: 'conn-4',
    registryType: RegistryType.Docker,
    name: 'Staging Docker Registry',
    url: 'https://staging-registry.myorg.io/v2/',
    isDefault: false,
    isConnected: true,
    username: 'staging-admin',
  },
  {
    id: 'conn-5',
    registryType: RegistryType.NPM,
    name: 'Public NPM Mirror',
    url: 'https://npm-mirror.myorg.io/',
    isDefault: false,
    isConnected: true,
    username: 'npm-mirror-svc',
  },
];

export const retentionPolicies: IRetentionPolicy[] = [
  {
    id: 'retention-1',
    registryType: RegistryType.Docker,
    name: 'Docker Image Cleanup',
    enabled: true,
    keepLastN: 10,
    olderThanDays: 90,
    tagPatternExclude: '^(latest|v\\d+\\.\\d+\\.\\d+)$',
  },
  {
    id: 'retention-2',
    registryType: RegistryType.NuGet,
    name: 'NuGet Package Retention',
    enabled: true,
    keepLastN: 5,
    olderThanDays: 180,
    tagPatternExclude: '^\\d+\\.\\d+\\.\\d+$',
  },
  {
    id: 'retention-3',
    registryType: RegistryType.NPM,
    name: 'NPM Package Cleanup',
    enabled: false,
    keepLastN: 20,
    olderThanDays: 365,
  },
];

export const webhooks: IWebhook[] = [
  {
    id: 'webhook-1',
    name: 'Slack Notifications',
    url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXX',
    events: [WebhookEvent.Push, WebhookEvent.Delete, WebhookEvent.SecurityScan],
    isActive: true,
    secret: '••••••••',
    lastTriggeredAt: '2026-02-19T08:15:00Z',
    lastStatusCode: 200,
  },
  {
    id: 'webhook-2',
    name: 'CI/CD Pipeline Trigger',
    url: 'https://ci.myorg.io/api/webhooks/registry',
    events: [WebhookEvent.Push],
    registryType: RegistryType.Docker,
    isActive: true,
    secret: '••••••••',
    lastTriggeredAt: '2026-02-19T08:15:00Z',
    lastStatusCode: 200,
  },
  {
    id: 'webhook-3',
    name: 'Security Scanner',
    url: 'https://security.myorg.io/api/scan/trigger',
    events: [WebhookEvent.Push, WebhookEvent.SecurityScan],
    isActive: true,
    secret: '••••••••',
    lastTriggeredAt: '2026-02-18T22:30:00Z',
    lastStatusCode: 200,
  },
  {
    id: 'webhook-4',
    name: 'Audit Log Exporter',
    url: 'https://logs.myorg.io/api/ingest/registry',
    events: [WebhookEvent.Push, WebhookEvent.Pull, WebhookEvent.Delete],
    isActive: false,
    lastTriggeredAt: '2026-01-15T10:00:00Z',
    lastStatusCode: 503,
  },
];
