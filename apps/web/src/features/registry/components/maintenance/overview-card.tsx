import type { ReactNode } from 'react';
import type { IAgentHealth, IAgentProcess, IRegistryAgentSummary } from '@registry-vault/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DiskUsageBar } from '@/components/shared/disk-usage-bar';
import { Notice } from '@/components/shared/notice';
import { formatBytes, formatDateTime, formatRelativeTime, formatRelativeTimeOr } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        running ? 'bg-[hsl(var(--severity-none))]' : 'bg-[hsl(var(--severity-critical))]',
      )}
      aria-hidden="true"
    />
  );
}

function ProcessTile({ label, process }: { label: string; process: IAgentProcess }) {
  const uptime = process.startedAt
    ? formatDistanceToNowStrict(new Date(process.startedAt))
    : null;

  return (
    <Tile label={label}>
      <div className="flex items-center gap-1.5">
        <StatusDot running={process.running} />
        <span className="text-sm font-medium">{process.running ? 'Running' : 'Stopped'}</span>
      </div>
      <div className="space-y-0.5 text-xs text-muted-foreground">
        {(process.pid !== undefined || uptime) && (
          <p>
            {process.pid !== undefined && `pid ${process.pid}`}
            {process.pid !== undefined && uptime && ' · '}
            {uptime && `up ${uptime}`}
          </p>
        )}
        {process.restarts > 0 && <p>{process.restarts} restarts</p>}
        {process.lastExit && (
          <p
            className={cn(
              process.lastExit.code !== 0 && 'text-[hsl(var(--severity-high))]',
            )}
            title={formatDateTime(process.lastExit.at)}
          >
            exited with code {process.lastExit.code}, {formatRelativeTime(process.lastExit.at)}
          </p>
        )}
      </div>
    </Tile>
  );
}

export function OverviewCardSkeleton() {
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16" />
        ))}
      </CardContent>
    </Card>
  );
}

interface OverviewCardProps {
  health?: IAgentHealth;
  /** Falls back to the connection's summary when the agent cannot be reached. */
  agent?: IRegistryAgentSummary;
  isLoading: boolean;
  isUnreachable: boolean;
  /** Set after a restart that never came back. */
  restartStalled?: boolean;
  onViewLogs?: () => void;
}

export function OverviewCard({
  health,
  agent,
  isLoading,
  isUnreachable,
  restartStalled,
  onViewLogs,
}: OverviewCardProps) {
  if (isLoading) return <OverviewCardSkeleton />;

  if (!health) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-sm font-medium">Overview</p>
          <p className="text-sm text-muted-foreground">
            {isUnreachable
              ? `Last reached ${formatRelativeTimeOr(agent?.lastSeenAt, 'never')}`
              : 'No health data.'}
          </p>
          {agent?.url && <p className="font-mono text-xs text-muted-foreground">{agent.url}</p>}
        </CardContent>
      </Card>
    );
  }

  // Without the extra process the grid is three tiles, not three plus a gap.
  const columns = health.extra ? 'lg:grid-cols-4' : 'lg:grid-cols-3';

  return (
    <div className="space-y-4">
      {health.lowDisk && (
        <Notice tone="warning" title="Low disk on the registry's storage">
          {Math.round(health.disk.usedPercent)}% of the disk holding the registry's storage is used —{' '}
          {formatBytes(health.disk.freeBytes)} free of {formatBytes(health.disk.totalBytes)}. Garbage
          collection may free space that deleted tags still occupy.
        </Notice>
      )}

      {restartStalled && (
        <Notice
          tone="danger"
          title="The registry has not come back"
          action={
            onViewLogs ? (
              <button
                type="button"
                onClick={onViewLogs}
                className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                View logs
              </button>
            ) : undefined
          }
        >
          It did not report a new start time within a minute of the restart. Check the logs.
        </Notice>
      )}

      <Card>
        <CardContent className={cn('grid grid-cols-2 gap-4 p-4', columns)}>
          <ProcessTile label="Registry" process={health.registry} />
          {health.extra && <ProcessTile label="Registry Vault (extra)" process={health.extra} />}

          <Tile label="Disk">
            <p className="text-sm font-medium">{formatBytes(health.disk.freeBytes)} free</p>
            <DiskUsageBar disk={health.disk} lowDisk={health.lowDisk} />
            <p className="text-xs text-muted-foreground">
              {Math.round(health.disk.usedPercent)}% used of {formatBytes(health.disk.totalBytes)}
            </p>
          </Tile>

          <Tile label="Maintenance">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  health.maintenance.readOnly
                    ? 'bg-[hsl(var(--severity-medium))]'
                    : 'bg-[hsl(var(--severity-none))]',
                )}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">
                {health.maintenance.readOnly ? 'Read-only' : 'Accepting pushes'}
              </span>
            </div>
            <div className="space-y-0.5 text-xs text-muted-foreground">
              {health.maintenance.readOnly ? (
                <>
                  {health.maintenance.reason && <p>{health.maintenance.reason}</p>}
                  {health.maintenance.since && (
                    <p title={formatDateTime(health.maintenance.since)}>
                      since {formatRelativeTime(health.maintenance.since)}
                    </p>
                  )}
                </>
              ) : (
                <p>—</p>
              )}
            </div>
          </Tile>
        </CardContent>
      </Card>
    </div>
  );
}
