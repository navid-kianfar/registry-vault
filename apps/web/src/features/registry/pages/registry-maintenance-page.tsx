import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import type { AgentLogSource, IAgentSettings } from '@registry-vault/shared';
import { RegistryType } from '@registry-vault/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/shared/page-header';
import { AgentStatusBadge } from '@/components/shared/agent-status-badge';
import { Notice } from '@/components/shared/notice';
import { useCanCurate, useIsAdmin } from '@/hooks/use-is-admin';
import { useRegistryConnection } from '@/hooks/use-registry-connection';
import { queryKeys } from '@/services/queries/query-keys';
import {
  GC_POLL_TIMEOUT_MS,
  agentErrorState,
  agentErrorMessage,
  isJobActive,
  useAgentGcHistory,
  useAgentGcJob,
  useAgentHealth,
  useAgentLogs,
  useAgentMaintenance,
  useAgentSettings,
  useAgentStorage,
  useAgentUploads,
  useGcCompletionEffects,
  usePurgeUploads,
  useRestartRegistry,
  useStartGc,
  useUpdateAgentSettings,
  useUpdateMaintenance,
} from '@/services/queries/agent.queries';
import { RegistryTabs } from '../components/registry-tabs';
import {
  AgentOfflineNotice,
  AgentUnauthorizedNotice,
  NoAgentEmptyState,
} from '../components/agent-states';
import { OverviewCard } from '../components/maintenance/overview-card';
import { GarbageCollectionCard } from '../components/maintenance/garbage-collection-card';
import { StorageCard } from '../components/maintenance/storage-card';
import { StaleUploadsCard } from '../components/maintenance/stale-uploads-card';
import { ReadOnlyCard } from '../components/maintenance/read-only-card';
import { LogsCard } from '../components/maintenance/logs-card';
import { AgentSettingsCard } from '../components/maintenance/agent-settings-card';
import { RestartCard } from '../components/maintenance/restart-card';

const DEFAULT_UPLOAD_HOURS = 24;
const DEFAULT_LOG_LINES = 200;
const RESTART_POLL_MS = 2000;
const RESTART_TIMEOUT_MS = 60_000;

export default function RegistryMaintenancePage() {
  const { connectionId, connection } = useRegistryConnection();
  const isAdmin = useIsAdmin();
  // Garbage collection and purging stale uploads are housekeeping a maintainer
  // may do; everything else on this page configures the registry.
  const canCurate = useCanCurate();
  const queryClient = useQueryClient();

  const [storageRefresh, setStorageRefresh] = useState(false);
  const [uploadHours, setUploadHours] = useState(DEFAULT_UPLOAD_HOURS);
  const [logSource, setLogSource] = useState<AgentLogSource>('registry');
  const [logLines, setLogLines] = useState(DEFAULT_LOG_LINES);
  const [isLogAuto, setIsLogAuto] = useState(false);
  const [gcPollDeadline, setGcPollDeadline] = useState(() => Date.now() + GC_POLL_TIMEOUT_MS);
  const [restartStartedAt, setRestartStartedAt] = useState<string | null>(null);
  const [isRestartStalled, setIsRestartStalled] = useState(false);
  const logsCardRef = useRef<HTMLDivElement>(null);
  const uploadsCardRef = useRef<HTMLDivElement>(null);

  const hasAgent = connection?.registryType === RegistryType.Docker && !!connection.agent;
  const agentStatus = connection?.agent?.status;
  const isUnauthorized = agentStatus === 'unauthorized';
  // Nothing under the agent can answer while the key is rejected; asking would
  // only produce eight identical failures.
  const canQuery = hasAgent && !isUnauthorized;

  const health = useAgentHealth(connectionId, canQuery);
  const gcJob = useAgentGcJob(connectionId, { enabled: canQuery, pollDeadline: gcPollDeadline });
  const gcHistory = useAgentGcHistory(connectionId, canQuery);
  const storage = useAgentStorage(connectionId, storageRefresh, canQuery);
  const uploads = useAgentUploads(connectionId, uploadHours, canQuery);
  const maintenance = useAgentMaintenance(connectionId, canQuery);
  const settings = useAgentSettings(connectionId, canQuery);
  // Logs can carry process output, so the API serves them to administrators only.
  const logs = useAgentLogs(connectionId, logSource, logLines, {
    enabled: canQuery && isAdmin,
    auto: isLogAuto,
  });

  const startGc = useStartGc(connectionId ?? '');
  const purgeUploads = usePurgeUploads(connectionId ?? '');
  const updateMaintenance = useUpdateMaintenance(connectionId ?? '');
  const updateSettings = useUpdateAgentSettings(connectionId ?? '');
  const restartRegistry = useRestartRegistry(connectionId ?? '');

  useGcCompletionEffects(connectionId ?? '', gcJob.data);

  const healthRefetch = health.refetch;

  // Watch the registry come back after a restart. The 15-second health interval
  // is far too slow to tell an operator whether their restart worked.
  useEffect(() => {
    if (!restartStartedAt) return;

    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    const timer = window.setInterval(() => {
      if (Date.now() > deadline) {
        window.clearInterval(timer);
        setRestartStartedAt(null);
        setIsRestartStalled(true);
        return;
      }
      void healthRefetch();
    }, RESTART_POLL_MS);

    return () => window.clearInterval(timer);
  }, [restartStartedAt, healthRefetch]);

  const currentStartedAt = health.data?.registry.startedAt;
  useEffect(() => {
    if (!restartStartedAt || !currentStartedAt) return;
    if (currentStartedAt === restartStartedAt) return;
    if (!health.data?.registry.running) return;
    setRestartStartedAt(null);
    setIsRestartStalled(false);
    toast.success('The registry is back up');
  }, [restartStartedAt, currentStartedAt, health.data?.registry.running]);

  const handleRefreshAll = useCallback(() => {
    if (!connectionId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.agent.connection(connectionId) });
  }, [connectionId, queryClient]);

  const handleSaveSettings = useCallback(
    (next: IAgentSettings, successMessage: string) => {
      updateSettings.mutate({ settings: next, successMessage });
    },
    [updateSettings],
  );

  if (!connection) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!hasAgent) {
    return (
      <div className="space-y-6">
        <PageHeader title="Maintenance" description={`${connection.name} — registry agent operations`} />
        <NoAgentEmptyState connectionId={connectionId!} />
      </div>
    );
  }

  const healthErrorState = agentErrorState(health.error);
  const isOffline = healthErrorState === 'offline' || agentStatus === 'offline';
  const isUnreachable = isOffline || isUnauthorized;
  const features = connection.agent?.features ?? [];
  const isGcRunning = isJobActive(gcJob.data?.state) || isJobActive(health.data?.gc.state);
  const isReadOnly = health.data?.maintenance.readOnly ?? maintenance.data?.readOnly ?? false;
  const isGcPollTimedOut = isGcRunning && Date.now() > gcPollDeadline;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <RegistryTabs connectionId={connectionId!} connection={connection} />

        <PageHeader title="Maintenance" description={`${connection.name} — registry agent operations`}>
          <AgentStatusBadge agent={connection.agent} showVersion />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRefreshAll}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </PageHeader>

        {!isAdmin && (
          <Notice tone="info">
            {canCurate
              ? 'You can run garbage collection and purge stale uploads. Read-only mode, restarts, the schedule, agent settings and registry logins are administrator-only.'
              : 'You have read-only access. Running garbage collection and purging stale uploads need the maintainer role; read-only mode, restarts and registry logins are administrator-only.'}
          </Notice>
        )}

        {isUnauthorized && (
          <AgentUnauthorizedNotice connectionId={connectionId!} agentUrl={connection.agent?.url} />
        )}

        {!isUnauthorized && isOffline && (
          <AgentOfflineNotice
            agentUrl={connection.agent?.url}
            message={health.error ? agentErrorMessage(health.error) : undefined}
            onRetry={() => void health.refetch()}
          />
        )}

        {isGcRunning && (
          <Notice tone="warning" title="Garbage collection is running">
            Pushes to this registry are rejected with 503 until it finishes. Pulls are unaffected.
          </Notice>
        )}

        {isReadOnly && (
          <Notice tone="warning" title="This registry is in read-only mode">
            Pushes are rejected with 503.
            {maintenance.data?.reason ? ` Reason: ${maintenance.data.reason}.` : ''}
          </Notice>
        )}

        <OverviewCard
          health={health.data}
          agent={connection.agent}
          isLoading={health.isLoading && canQuery}
          isUnreachable={isUnreachable}
          restartStalled={isRestartStalled}
          onViewLogs={() => logsCardRef.current?.scrollIntoView({ behavior: 'smooth' })}
        />

        {!isUnreachable && (
          <>
            <GarbageCollectionCard
              features={features}
              registryVersion={connection.agent?.registryVersion}
              job={gcJob.data}
              history={gcHistory.data ?? []}
              isLoading={gcJob.isLoading}
              canRunGc={canCurate}
              isAdmin={isAdmin}
              isStarting={startGc.isPending}
              connectionName={connection.name}
              settings={settings.data}
              isSettingsLoading={settings.isLoading}
              isSavingSettings={updateSettings.isPending}
              pollTimedOut={isGcPollTimedOut}
              onStart={(dryRun) => {
                setGcPollDeadline(Date.now() + GC_POLL_TIMEOUT_MS);
                startGc.mutate(dryRun);
              }}
              onResumePolling={() => {
                setGcPollDeadline(Date.now() + GC_POLL_TIMEOUT_MS);
                void gcJob.refetch();
              }}
              onSaveSettings={(next) =>
                handleSaveSettings(next, 'Garbage collection schedule saved')
              }
            />

            <StorageCard
              features={features}
              storage={storage.data}
              isLoading={storage.isLoading}
              isRefreshing={storage.isFetching}
              connectionId={connectionId!}
              onRecompute={() => {
                setStorageRefresh(true);
                void storage.refetch();
              }}
              onShowUploads={() =>
                uploadsCardRef.current?.scrollIntoView({ behavior: 'smooth' })
              }
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <div ref={uploadsCardRef}>
                <StaleUploadsCard
                  features={features}
                  uploads={uploads.data}
                  isLoading={uploads.isLoading}
                  isPurging={purgeUploads.isPending}
                  canPurge={canCurate}
                  connectionName={connection.name}
                  olderThanHours={uploadHours}
                  onOlderThanHoursChange={setUploadHours}
                  onPurge={(hours) => purgeUploads.mutate({ olderThanHours: hours })}
                />
              </div>

              <ReadOnlyCard
                features={features}
                maintenance={maintenance.data}
                isLoading={maintenance.isLoading}
                isSaving={updateMaintenance.isPending}
                isAdmin={isAdmin}
                connectionName={connection.name}
                onChange={(readOnly, reason) => updateMaintenance.mutate({ readOnly, reason })}
              />
            </div>

            {isAdmin && (
              <div ref={logsCardRef}>
                <LogsCard
                  features={features}
                  logs={logs.data}
                  isLoading={logs.isLoading}
                  isFetching={logs.isFetching}
                  hasExtraProcess={!!health.data?.extra}
                  source={logSource}
                  lines={logLines}
                  isAuto={isLogAuto}
                  onSourceChange={setLogSource}
                  onLinesChange={setLogLines}
                  onAutoChange={setIsLogAuto}
                  onRefresh={() => void logs.refetch()}
                />
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <AgentSettingsCard
                features={features}
                settings={settings.data}
                isLoading={settings.isLoading}
                isSaving={updateSettings.isPending}
                isAdmin={isAdmin}
                onSave={(next) => handleSaveSettings(next, 'Agent settings saved')}
              />

              <RestartCard
                isAdmin={isAdmin}
                isGcRunning={isGcRunning}
                isRestarting={restartRegistry.isPending || !!restartStartedAt}
                connectionName={connection.name}
                onRestart={() =>
                  restartRegistry.mutate(undefined, {
                    onSuccess: () => {
                      setIsRestartStalled(false);
                      // Remember the start time we are waiting to see change.
                      setRestartStartedAt(health.data?.registry.startedAt ?? 'unknown');
                    },
                  })
                }
              />
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
