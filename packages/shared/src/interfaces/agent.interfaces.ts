/**
 * Registry agent, as Registry Vault's own API exposes it to the web app.
 *
 * The agent (agent/, Go) runs next to a Docker registry and does what the
 * Registry HTTP API cannot. Its wire contract is agent/API.md; the Vault API
 * relays it under `/api/registries/:connectionId/agent/...` so the browser
 * never sees the agent's key. Every route below is relative to that prefix
 * unless it says otherwise, and answers 404 when the connection has no agent
 * configured and 502 (`{ message }`) when the agent cannot be reached.
 */

export type AgentFeature =
  | 'gc'
  | 'storage'
  | 'repositories'
  | 'uploads'
  | 'maintenance'
  | 'logs'
  | 'users'
  | 'events'
  | 'scan';

export type AgentStatus = 'online' | 'offline' | 'unauthorized';

/** Agent block on IRegistryConnection. Absent when no agent is configured. */
export interface IRegistryAgentSummary {
  url: string;
  status: AgentStatus;
  version?: string;
  registryVersion?: string;
  features: AgentFeature[];
  /** Last time Vault reached the agent successfully. */
  lastSeenAt?: string;
}

/**
 * `POST /api/settings/registries/agent/test` — probe an agent before the
 * connection exists (body: url + apiKey, both required).
 * `POST /api/settings/registries/:id/agent/test` — probe a saved connection,
 * with the saved values unless url/apiKey are given.
 * Both answer IAgentInfo, or 502 `{ message }` when unreachable/unauthorized.
 */
export interface IAgentTestRequest {
  url?: string;
  apiKey?: string;
}

export interface IAgentInfo {
  version: string;
  registryVersion: string;
  features: AgentFeature[];
  auth: 'htpasswd' | 'none';
  storageRoot: string;
}

export interface IAgentProcess {
  running: boolean;
  pid?: number;
  startedAt?: string;
  restarts: number;
  lastExit: { code: number; at: string } | null;
}

export interface IAgentDisk {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface IAgentMaintenance {
  readOnly: boolean;
  reason: string | null;
  since: string | null;
}

/** `GET health` */
export interface IAgentHealth {
  registry: IAgentProcess;
  extra: IAgentProcess | null;
  maintenance: IAgentMaintenance;
  gc: { state: AgentJobState | 'idle' };
  disk: IAgentDisk;
  /** Added by Vault: disk.usedPercent >= the connection's lowDiskWarningPercent. */
  lowDisk: boolean;
}

/** `GET storage?refresh=true|false` */
export interface IAgentStorage {
  computedAt: string;
  disk: IAgentDisk;
  registry: {
    totalBytes: number;
    blobBytes: number;
    uploadBytes: number;
    repositoryCount: number;
  };
  repositories: IAgentRepositoryStorage[];
}

export interface IAgentRepositoryStorage {
  name: string;
  /** Vault's repository id when Vault mirrors this repository (for linking). */
  repositoryId?: string;
  /** Freed by deleting this repository and running GC. */
  exclusiveBytes: number;
  /** Also used by other repositories. */
  sharedBytes: number;
  layerCount: number;
  manifestCount: number;
}

export type AgentJobState = 'queued' | 'running' | 'succeeded' | 'failed';

/** `POST gc` body. */
export interface IStartGcRequest {
  dryRun?: boolean;
}

/** `POST gc` → job; `GET gc` → current/latest job or null; `GET gc/history` → last 20. */
export interface IAgentGcJob {
  id: string;
  state: AgentJobState;
  dryRun: boolean;
  startedAt?: string;
  finishedAt?: string;
  usedBytesBefore?: number;
  usedBytesAfter?: number;
  freedBytes?: number;
  blobsDeleted?: number;
  manifestsDeleted?: number;
  error: string | null;
  output: string[];
}

/**
 * `POST repositories/remove` — remove a repository's directory from storage so
 * the registry stops listing it; also drops Vault's mirror rows. `force` is
 * required while it still has tags. Space returns on the next GC.
 * Deleting a whole repository from the Docker UI calls this automatically
 * when an agent is configured.
 */
export interface IRemoveRepositoryRequest {
  name: string;
  force?: boolean;
}

/** `GET uploads?olderThanHours=24` */
export interface IAgentUploads {
  totalBytes: number;
  uploads: { repository: string; id: string; startedAt: string; bytes: number }[];
}

/** `POST uploads/purge` body; response `{ purged, freedBytes }`. */
export interface IPurgeUploadsRequest {
  olderThanHours: number;
}

export interface IPurgeUploadsResult {
  purged: number;
  freedBytes: number;
}

/** `GET maintenance` / `PUT maintenance` (body: IUpdateMaintenanceRequest). */
export interface IUpdateMaintenanceRequest {
  readOnly: boolean;
  reason?: string;
}

/** `GET logs?source=registry|agent|extra&lines=200`; `POST registry/restart` → `{ restarting: true }`. */
export type AgentLogSource = 'registry' | 'agent' | 'extra';

export interface IAgentLogs {
  source: AgentLogSource;
  lines: string[];
}

// ---- Registry users (docker login accounts, not Vault users) ----

export type RegistryUserRole = 'pull' | 'push' | 'admin';

/** `GET users` → `IRegistryUser[]` */
export interface IRegistryUser {
  username: string;
  role: RegistryUserRole;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

/** `POST users` */
export interface ICreateRegistryUserRequest {
  username: string;
  role: RegistryUserRole;
  /** Omit to have one generated; it is returned once. */
  password?: string;
}

/** `PATCH users/:username` */
export interface IUpdateRegistryUserRequest {
  role?: RegistryUserRole;
  password?: string;
  resetPassword?: boolean;
}

/** Response of create / update. `password` only when the agent generated one — show it once. */
export interface IRegistryUserResult {
  user: IRegistryUser;
  password?: string;
}

// ---- Per-connection agent settings (stored by Vault) ----

/** `GET settings` / `PUT settings` */
export interface IAgentSettings {
  /** Scheduled garbage collection. */
  gcSchedule: 'off' | 'daily' | 'weekly';
  /** Hour of day (0-23, server local time) for scheduled GC. */
  gcHour: number;
  /** Day for weekly GC: 0 = Sunday … 6 = Saturday. Ignored unless weekly. */
  gcWeekday: number;
  /** Run GC right after a retention policy deletes anything on this registry. */
  gcAfterRetention: boolean;
  /** Dashboard and connection show a warning at or above this disk usage. */
  lowDiskWarningPercent: number;
  /** Scan every newly pushed tag with Trivy. */
  autoScanOnPush: boolean;
}

// ---- Overview for the dashboard ----

/** `GET /api/registries/agents/overview` — one row per connection with an agent. */
export interface IAgentOverviewItem {
  connectionId: string;
  connectionName: string;
  status: AgentStatus;
  lastSeenAt?: string;
  disk?: IAgentDisk;
  lowDisk: boolean;
  maintenance?: IAgentMaintenance;
  gc?: { state: AgentJobState | 'idle' };
}

// ---- Vulnerability scans (Docker tags) ----

export type ScanState = AgentJobState;

/**
 * `POST /api/docker/repositories/:repoId/tags/:tag/scan` (body `{ platform? }`)
 * → the queued scan. Vault follows it to completion and stores the result on
 * the tag (`IDockerTag.vulnerabilitySummary`).
 * `GET /api/docker/repositories/:repoId/tags/:tag/scan` → latest stored scan
 * with findings, or null.
 */
export interface IScanRequest {
  platform?: string;
}

export interface IScanResult {
  id: string;
  state: ScanState;
  digest?: string;
  platform: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error: string | null;
  summary: { critical: number; high: number; medium: number; low: number; unknown: number };
  vulnerabilities: IScanFinding[];
}

export interface IScanFinding {
  id: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  title?: string;
  primaryUrl?: string;
}

// ---- Pull statistics ----

/**
 * `GET /api/docker/repositories/:repoId/pulls?days=30`
 *
 * Attribution: a pull by tag counts for that tag; a pull by digest counts for
 * every tag currently resolving to that digest (the content was pulled).
 * Repository totals and `daily` count each pull once. Platform-manifest
 * fetches that follow an index pull are not pulls.
 */
export interface IDockerPullStats {
  totalPulls: number;
  lastPulledAt?: string;
  /** One point per day, oldest first, zero-filled. */
  daily: { date: string; pulls: number }[];
  /** Per tag, most pulled first. */
  tags: { tag: string; pulls: number; lastPulledAt?: string }[];
  /** True when the agent's event log was pruned before Vault read it. */
  incomplete: boolean;
}
