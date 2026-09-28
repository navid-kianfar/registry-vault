import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/shared/notice';
import { formatDateTime, formatRelativeTime } from '@/lib/formatters';
import { isJobActive, useAgentHealth } from '@/services/queries/agent.queries';

/**
 * The two states an operator must not discover by a failing push: garbage
 * collection running, and read-only mode on. Shown on the registry page and on
 * every repository detail page of the connection; the health query is shared,
 * so this costs no extra request.
 */
export function AgentPageNotices({
  connectionId,
  enabled = true,
  showMaintenanceLink = true,
}: {
  connectionId: string | undefined;
  enabled?: boolean;
  showMaintenanceLink?: boolean;
}) {
  const { data: health } = useAgentHealth(connectionId, enabled);
  if (!health) return null;

  const isGcRunning = isJobActive(health.gc.state);
  const { readOnly, reason, since } = health.maintenance;
  if (!isGcRunning && !readOnly) return null;

  const action =
    showMaintenanceLink && connectionId ? (
      <Button asChild variant="outline" size="sm">
        <Link to={`/registry/${connectionId}/maintenance`}>View maintenance</Link>
      </Button>
    ) : undefined;

  return (
    <div className="space-y-3">
      {isGcRunning && (
        <Notice tone="warning" title="Garbage collection is running" action={action}>
          Pushes to this registry are rejected with 503 until it finishes. Pulls are unaffected.
        </Notice>
      )}
      {readOnly && (
        <Notice tone="warning" title="This registry is in read-only mode" action={action}>
          Pushes are rejected with 503.
          {reason ? ` Reason: ${reason}.` : ''}
          {since ? (
            <>
              {' '}
              On since <span title={formatDateTime(since)}>{formatRelativeTime(since)}</span>.
            </>
          ) : null}
        </Notice>
      )}
    </div>
  );
}
