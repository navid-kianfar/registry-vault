import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AgentJobState,
  AgentLogSource,
  IAgentGcJob,
  IAgentSettings,
  IAgentTestRequest,
  ICreateRegistryUserRequest,
  IPurgeUploadsRequest,
  IRemoveRepositoryRequest,
  IScanRequest,
  IUpdateMaintenanceRequest,
  IUpdateRegistryUserRequest,
} from '@registry-vault/shared';
import { apiClient } from '../http-api-client';
import { ApiError } from '../http-api-client';
import { queryKeys } from './query-keys';
import { formatBytes } from '@/lib/formatters';

const HEALTH_POLL_MS = 15_000;
const HEALTH_POLL_BUSY_MS = 5_000;
const GC_POLL_MS = 2_000;
const OVERVIEW_POLL_MS = 60_000;
const LOGS_POLL_MS = 5_000;
const SCAN_POLL_MS = 3_000;
const STORAGE_STALE_MS = 5 * 60_000;

/** A tab left open overnight must not poll the API forever. */
export const GC_POLL_TIMEOUT_MS = 30 * 60_000;
export const SCAN_POLL_TIMEOUT_MS = 10 * 60_000;

const ACTIVE_JOB_STATES: readonly AgentJobState[] = ['queued', 'running'] as const;

export function isJobActive(state?: AgentJobState | 'idle' | null): boolean {
  if (!state || state === 'idle') return false;
  return ACTIVE_JOB_STATES.includes(state);
}

/**
 * How the agent relay's failure should read on screen. 404 is "no agent is
 * configured here", which is a setup step, not an error; 502 is "configured but
 * unreachable", which is an outage.
 */
export type AgentErrorState = 'no-agent' | 'offline' | 'error';

export function agentErrorState(error: unknown): AgentErrorState | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 404) return 'no-agent';
    if (error.status === 502) return 'offline';
  }
  return 'error';
}

export function agentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/** Agent failures are states to render, not transient faults worth retrying. */
const AGENT_QUERY_DEFAULTS = { retry: false } as const;

function invalidateAgent(queryClient: QueryClient, connectionId: string): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.agent.connection(connectionId) });
}

// ---- Health -----------------------------------------------------------------

/**
 * Shared by the maintenance page, the registry page and every repository detail
 * page of the connection, so they cost one request per interval between them.
 */
export function useAgentHealth(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.agent.health(connectionId ?? ''),
    queryFn: () => apiClient.getAgentHealth(connectionId!),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
    refetchInterval: (query) =>
      isJobActive(query.state.data?.data?.gc.state) ? HEALTH_POLL_BUSY_MS : HEALTH_POLL_MS,
  });
}

export function useAgentsOverview(enabled = true) {
  return useQuery({
    queryKey: queryKeys.agent.overview,
    queryFn: () => apiClient.getAgentsOverview(),
    select: (response) => response.data,
    enabled,
    ...AGENT_QUERY_DEFAULTS,
    refetchInterval: OVERVIEW_POLL_MS,
  });
}

// ---- Storage ----------------------------------------------------------------

export function useAgentStorage(connectionId: string | undefined, refresh: boolean, enabled = true) {
  return useQuery({
    queryKey: queryKeys.agent.storage(connectionId ?? '', refresh),
    queryFn: () => apiClient.getAgentStorage(connectionId!, refresh),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
    staleTime: STORAGE_STALE_MS,
  });
}

// ---- Garbage collection -----------------------------------------------------

export function useAgentGcJob(
  connectionId: string | undefined,
  options: { enabled?: boolean; pollDeadline?: number } = {},
) {
  const { enabled = true, pollDeadline } = options;
  return useQuery({
    queryKey: queryKeys.agent.gc(connectionId ?? ''),
    queryFn: () => apiClient.getAgentGcJob(connectionId!),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
    refetchInterval: (query) => {
      if (!isJobActive(query.state.data?.data?.state)) return false;
      if (pollDeadline !== undefined && Date.now() > pollDeadline) return false;
      return GC_POLL_MS;
    },
  });
}

export function useAgentGcHistory(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.agent.gcHistory(connectionId ?? ''),
    queryFn: () => apiClient.getAgentGcHistory(connectionId!),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
  });
}

export function useStartGc(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dryRun: boolean) => apiClient.startAgentGc(connectionId, { dryRun }),
    onSuccess: (response, dryRun) => {
      // Seed the cache with the accepted job so the card switches to RUNNING
      // before the first poll comes back.
      queryClient.setQueryData(queryKeys.agent.gc(connectionId), response);
      if (!dryRun) {
        toast.info('Garbage collection started — pushes are paused until it finishes');
      }
    },
    onError: (error: Error) => {
      if (isConflict(error)) {
        toast.error(error.message || 'Another garbage collection is already running');
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.gc(connectionId) });
        return;
      }
      toast.error(error.message || 'Could not start garbage collection');
    },
  });
}

/**
 * Announce a garbage collection that finished while we were polling, and
 * refresh what it changed. The mutation cannot do this — the job completes
 * minutes after the request that started it returned.
 */
export function useGcCompletionEffects(connectionId: string, job: IAgentGcJob | null | undefined) {
  const queryClient = useQueryClient();
  const previousStateRef = useRef<AgentJobState | null>(null);
  const previousIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!job) return;

    const isSameJob = previousIdRef.current === job.id;
    const previousState = isSameJob ? previousStateRef.current : null;
    previousIdRef.current = job.id;
    previousStateRef.current = job.state;

    // Only report a transition we actually watched happen.
    if (!previousState || !isJobActive(previousState) || isJobActive(job.state)) return;

    if (job.state === 'failed') {
      toast.error(`Garbage collection failed — ${job.error ?? 'see the output below'}`);
      return;
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.agent.connection(connectionId) });
    queryClient.invalidateQueries({ queryKey: ['docker'] });

    const freed = job.freedBytes ?? 0;
    if (job.dryRun) {
      toast.success(
        freed > 0
          ? `Dry run finished — ${formatBytes(freed)} can be freed`
          : 'Dry run finished — nothing to free',
      );
      return;
    }

    toast.success(
      freed > 0
        ? `Garbage collection freed ${formatBytes(freed)}`
        : 'Garbage collection finished — nothing to free',
    );
  }, [job, connectionId, queryClient]);
}

// ---- Repositories -----------------------------------------------------------

export function useRemoveAgentRepository(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: IRemoveRepositoryRequest) =>
      apiClient.removeAgentRepository(connectionId, request),
    onSuccess: (_response, request) => {
      invalidateAgent(queryClient, connectionId);
      queryClient.invalidateQueries({ queryKey: ['docker'] });
      toast.success(`Removed ${request.name}`, {
        description: 'Disk space returns after the next garbage collection.',
      });
    },
    onError: (error: Error) => toast.error(error.message || 'Could not remove the repository'),
  });
}

// ---- Stale uploads ----------------------------------------------------------

export function useAgentUploads(
  connectionId: string | undefined,
  olderThanHours: number,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.agent.uploads(connectionId ?? '', olderThanHours),
    queryFn: () => apiClient.getAgentUploads(connectionId!, olderThanHours),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
  });
}

export function usePurgeUploads(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: IPurgeUploadsRequest) => apiClient.purgeAgentUploads(connectionId, request),
    onSuccess: (response, request) => {
      invalidateAgent(queryClient, connectionId);
      const { purged, freedBytes } = response.data;
      if (purged === 0) {
        toast.info(`Nothing to purge — no uploads older than ${request.olderThanHours} hours`);
        return;
      }
      toast.success(`Purged ${purged} stale uploads — ${formatBytes(freedBytes)} freed`);
    },
    onError: (error: Error) => toast.error(error.message || 'Could not purge uploads'),
  });
}

// ---- Read-only mode ---------------------------------------------------------

export function useAgentMaintenance(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.agent.maintenance(connectionId ?? ''),
    queryFn: () => apiClient.getAgentMaintenance(connectionId!),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
  });
}

export function useUpdateMaintenance(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: IUpdateMaintenanceRequest) =>
      apiClient.updateAgentMaintenance(connectionId, request),
    onSuccess: (response, request) => {
      queryClient.setQueryData(queryKeys.agent.maintenance(connectionId), response);
      queryClient.invalidateQueries({ queryKey: queryKeys.agent.health(connectionId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agent.overview });
      toast.success(
        request.readOnly
          ? 'Read-only mode on — pushes are rejected'
          : 'Read-only mode off — pushes are accepted again',
      );
    },
    onError: (error: Error) => toast.error(error.message || 'Could not change read-only mode'),
  });
}

// ---- Logs -------------------------------------------------------------------

export function useAgentLogs(
  connectionId: string | undefined,
  source: AgentLogSource,
  lines: number,
  options: { enabled?: boolean; auto?: boolean } = {},
) {
  const { enabled = true, auto = false } = options;
  return useQuery({
    queryKey: queryKeys.agent.logs(connectionId ?? '', source, lines),
    queryFn: () => apiClient.getAgentLogs(connectionId!, source, lines),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
    refetchInterval: auto ? LOGS_POLL_MS : false,
  });
}

// ---- Restart ----------------------------------------------------------------

export function useRestartRegistry(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.restartAgentRegistry(connectionId),
    onSuccess: () => {
      toast.info('Restarting the registry…');
      queryClient.invalidateQueries({ queryKey: queryKeys.agent.health(connectionId) });
    },
    onError: (error: Error) => {
      if (isConflict(error)) {
        toast.error(error.message || 'Cannot restart while garbage collection is running');
        return;
      }
      toast.error(error.message || 'Could not restart the registry');
    },
  });
}

// ---- Agent settings ---------------------------------------------------------

export function useAgentSettings(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.agent.settings(connectionId ?? ''),
    queryFn: () => apiClient.getAgentSettings(connectionId!),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
  });
}

/**
 * `PUT settings` replaces the whole object. Both cards that edit part of it
 * must send every field, or saving one silently resets the other.
 */
export function useUpdateAgentSettings(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ settings }: { settings: IAgentSettings; successMessage: string }) =>
      apiClient.updateAgentSettings(connectionId, settings),
    onSuccess: (response, variables) => {
      queryClient.setQueryData(queryKeys.agent.settings(connectionId), response);
      queryClient.invalidateQueries({ queryKey: queryKeys.agent.health(connectionId) });
      toast.success(variables.successMessage);
    },
    onError: (error: Error) => toast.error(error.message || 'Could not save the settings'),
  });
}

// ---- Registry logins --------------------------------------------------------

export function useRegistryUsers(connectionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.agent.users(connectionId ?? ''),
    queryFn: () => apiClient.getRegistryUsers(connectionId!),
    select: (response) => response.data,
    enabled: !!connectionId && enabled,
    ...AGENT_QUERY_DEFAULTS,
  });
}

export function useCreateRegistryUser(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ICreateRegistryUserRequest) =>
      apiClient.createRegistryUser(connectionId, request),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agent.users(connectionId) });
      toast.success(`Created ${response.data.user.username}`);
    },
    // The caller renders the field error (a 409 is a taken username), so no toast here.
  });
}

export function useUpdateRegistryUser(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, request }: { username: string; request: IUpdateRegistryUserRequest }) =>
      apiClient.updateRegistryUser(connectionId, username, request),
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agent.users(connectionId) });
      if (variables.request.resetPassword) {
        toast.success(`New password generated for ${variables.username}`);
        return;
      }
      if (variables.request.role) {
        toast.success(`${variables.username} is now ${variables.request.role}`);
      }
    },
    onError: (error: Error) => toast.error(error.message || 'Could not update the login'),
  });
}

export function useDeleteRegistryUser(connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => apiClient.deleteRegistryUser(connectionId, username),
    onSuccess: (_response, username) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agent.users(connectionId) });
      toast.success(`Deleted ${username}`);
    },
    onError: (error: Error) => toast.error(error.message || 'Could not delete the login'),
  });
}

// ---- Agent probe ------------------------------------------------------------

/**
 * Probes an agent before or after the connection exists. Without a connection
 * id the keyless route takes the url and key straight from the form.
 */
export function useTestAgent() {
  return useMutation({
    mutationFn: ({ connectionId, request }: { connectionId?: string; request: IAgentTestRequest }) =>
      connectionId
        ? apiClient.testConnectionAgent(connectionId, request)
        : apiClient.testAgent(request),
    onSuccess: (response) => {
      const info = response.data;
      toast.success(`Agent reachable — v${info.version}, registry ${info.registryVersion}`);
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 401) {
        toast.error('The agent rejected this API key');
        return;
      }
      toast.error(`Could not reach the agent — ${error.message}`);
    },
  });
}

// ---- Docker pull statistics and scans --------------------------------------

export function useDockerPullStats(repositoryId: string | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.docker.pulls(repositoryId ?? '', days),
    queryFn: () => apiClient.getDockerPullStats(repositoryId!, days),
    select: (response) => response.data,
    enabled: !!repositoryId && enabled,
    ...AGENT_QUERY_DEFAULTS,
  });
}

export function useTagScan(
  repositoryId: string | undefined,
  tagName: string | undefined,
  options: { enabled?: boolean; pollDeadline?: number } = {},
) {
  const { enabled = true, pollDeadline } = options;
  return useQuery({
    queryKey: queryKeys.docker.scan(repositoryId ?? '', tagName ?? ''),
    queryFn: () => apiClient.getTagScan(repositoryId!, tagName!),
    select: (response) => response.data,
    enabled: !!repositoryId && !!tagName && enabled,
    ...AGENT_QUERY_DEFAULTS,
    refetchInterval: (query) => {
      if (!isJobActive(query.state.data?.data?.state)) return false;
      if (pollDeadline !== undefined && Date.now() > pollDeadline) return false;
      return SCAN_POLL_MS;
    },
  });
}

export function useStartTagScan(repositoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tagName, request }: { tagName: string; request: IScanRequest }) =>
      apiClient.startTagScan(repositoryId, tagName, request),
    onSuccess: (response, variables) => {
      queryClient.setQueryData(queryKeys.docker.scan(repositoryId, variables.tagName), response);
      queryClient.invalidateQueries({ queryKey: ['docker', 'tags', repositoryId] });
      toast.info(`Scan queued for ${variables.tagName}`);
    },
    onError: (error: Error) => {
      if (isConflict(error)) {
        toast.error(error.message || 'The scan queue is full (50). Try again in a few minutes');
        return;
      }
      toast.error(`Scan failed — ${error.message}`);
    },
  });
}

/** Announce a scan that finished under polling, the way GC does. */
export function useScanCompletionEffects(
  repositoryId: string | undefined,
  scan: { id: string; state: AgentJobState; error: string | null; summary: { critical: number; high: number } } | null | undefined,
) {
  const queryClient = useQueryClient();
  const previousStateRef = useRef<AgentJobState | null>(null);
  const previousIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scan) return;

    const isSameScan = previousIdRef.current === scan.id;
    const previousState = isSameScan ? previousStateRef.current : null;
    previousIdRef.current = scan.id;
    previousStateRef.current = scan.state;

    if (!previousState || !isJobActive(previousState) || isJobActive(scan.state)) return;

    if (scan.state === 'failed') {
      toast.error(`Scan failed — ${scan.error ?? 'see the agent logs'}`);
      return;
    }

    if (repositoryId) {
      queryClient.invalidateQueries({ queryKey: ['docker', 'tags', repositoryId] });
    }

    const { critical, high } = scan.summary;
    toast.success(
      critical === 0 && high === 0
        ? 'Scan finished — no known vulnerabilities'
        : `Scan finished — ${critical} critical, ${high} high`,
    );
  }, [scan, repositoryId, queryClient]);
}
