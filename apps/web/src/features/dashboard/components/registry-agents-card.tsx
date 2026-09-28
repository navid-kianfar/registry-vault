import { Link } from 'react-router-dom';
import { ChevronRight, Loader2, ServerCog } from 'lucide-react';
import type { IAgentOverviewItem } from '@registry-vault/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentStatusBadge } from '@/components/shared/agent-status-badge';
import { DiskUsageBar } from '@/components/shared/disk-usage-bar';
import { EmptyState } from '@/components/shared/empty-state';
import { Notice } from '@/components/shared/notice';
import { formatBytes, formatRelativeTimeOr } from '@/lib/formatters';
import { isJobActive } from '@/services/queries/agent.queries';
import { cn } from '@/lib/utils';

const SEVERITY_MEDIUM_CHIP =
  'border-[hsl(var(--severity-medium))]/40 bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))]';

function AgentRow({ item }: { item: IAgentOverviewItem }) {
  const isGcRunning = isJobActive(item.gc?.state);
  const isReadOnly = item.maintenance?.readOnly ?? false;

  return (
    <Link
      to={`/registry/${item.connectionId}/maintenance`}
      className={cn(
        'block rounded-lg border p-3 transition-colors hover:bg-accent/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        item.lowDisk && 'border-[hsl(var(--severity-high))]/40',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.connectionName}</span>
        <AgentStatusBadge
          agent={{ url: '', status: item.status, features: [], lastSeenAt: item.lastSeenAt }}
        />
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
      </div>

      <div className="mt-2 space-y-2">
        {item.status === 'online' ? (
          <>
            {item.disk && (
              <>
                <DiskUsageBar disk={item.disk} lowDisk={item.lowDisk} />
                <p className="text-xs text-muted-foreground">
                  {Math.round(item.disk.usedPercent)}% used · {formatBytes(item.disk.freeBytes)} free
                </p>
              </>
            )}
            {(isReadOnly || isGcRunning) && (
              <div className="flex flex-wrap gap-1.5">
                {isReadOnly && (
                  <Badge variant="outline" className={cn('text-[10px]', SEVERITY_MEDIUM_CHIP)}>
                    Read-only
                  </Badge>
                )}
                {isGcRunning && (
                  <Badge variant="outline" className={cn('gap-1 text-[10px]', SEVERITY_MEDIUM_CHIP)}>
                    <Loader2 className="h-3 w-3 animate-spin" /> GC running
                  </Badge>
                )}
              </div>
            )}
          </>
        ) : item.status === 'unauthorized' ? (
          <p className="text-xs text-muted-foreground">The stored API key was rejected.</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Last reached {formatRelativeTimeOr(item.lastSeenAt, 'never')}
          </p>
        )}
      </div>
    </Link>
  );
}

/**
 * The card renders even with no agents: nothing else in the app mentions the
 * agent, so hiding it would make the whole feature invisible.
 */
export function RegistryAgentsCard({
  items,
  isLoading,
  isError,
  onRetry,
}: {
  items: readonly IAgentOverviewItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ServerCog className="h-4 w-4" /> Registry agents
        </CardTitle>
        <CardDescription>Disk and maintenance state of every registry running an agent.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-16" />)
        ) : isError ? (
          <Notice
            tone="danger"
            title="Could not load registry agents"
            action={
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            }
          >
            The agents overview did not answer.
          </Notice>
        ) : items.length === 0 ? (
          <EmptyState
            className="py-8"
            icon={<ServerCog className="h-6 w-6 text-muted-foreground" />}
            title="No registry agents yet"
            description="An agent runs next to a Docker registry and lets Registry Vault reclaim disk space, count pulls, manage docker login accounts and scan images — none of which the registry API can do on its own."
            action={
              <Button asChild>
                <Link to="/settings/registries">Set up an agent</Link>
              </Button>
            }
          />
        ) : (
          items.map((item) => <AgentRow key={item.connectionId} item={item} />)
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The alarm, above the fold. Deliberately not in AppLayout: a per-connection
 * disk warning on every page of the app is noise an operator learns to ignore.
 */
export function LowDiskBanners({ items }: { items: readonly IAgentOverviewItem[] }) {
  const affected = items.filter((item) => item.lowDisk && item.disk);
  if (affected.length === 0) return null;

  if (affected.length > 2) {
    return (
      <Notice tone="warning" title={`${affected.length} registries are running low on disk`}>
        {affected.map((item) => (
          <p key={item.connectionId}>
            {item.connectionName} — {Math.round(item.disk!.usedPercent)}% used
          </p>
        ))}
      </Notice>
    );
  }

  return (
    <div className="space-y-3">
      {affected.map((item) => (
        <Notice
          key={item.connectionId}
          tone="warning"
          title={`${item.connectionName} is running low on disk`}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={`/registry/${item.connectionId}/maintenance`}>Open maintenance</Link>
            </Button>
          }
        >
          {Math.round(item.disk!.usedPercent)}% of the disk holding the registry's storage is used —{' '}
          {formatBytes(item.disk!.freeBytes)} free of {formatBytes(item.disk!.totalBytes)}. Garbage
          collection may free space that deleted tags still occupy.
        </Notice>
      ))}
    </div>
  );
}
