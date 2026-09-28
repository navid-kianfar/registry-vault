import { Link } from 'react-router-dom';
import { Info, ServerCog } from 'lucide-react';
import type { AgentFeature, IRegistryConnection } from '@registry-vault/shared';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { Notice } from '@/components/shared/notice';

/** Why a section is inert, in the operator's terms rather than the API's. */
const FEATURE_REASON: Record<AgentFeature, string> = {
  users:
    'Registry logins are managed elsewhere — this registry runs with REGISTRY_AUTH=none, so anyone who can reach it can pull and push.',
  scan: 'Vulnerability scanning is off — Trivy is not installed on the agent host. Set TRIVY_ENABLED and install trivy to enable it.',
  gc: 'Garbage collection is not available on this agent.',
  storage: 'Storage figures are not available on this agent.',
  uploads: 'Stale-upload cleanup is not available on this agent.',
  maintenance: 'Read-only mode is not available on this agent.',
  logs: 'Log access is not available on this agent.',
  events: "Pull counts need the agent's event log, which this agent does not expose.",
  repositories: 'Repository operations are not available on this agent.',
};

export function featureReason(feature: AgentFeature): string {
  return FEATURE_REASON[feature];
}

export function hasFeature(connection: IRegistryConnection | undefined, feature: AgentFeature): boolean {
  return connection?.agent?.features.includes(feature) ?? false;
}

/** The deep link every "Set up an agent" action uses. */
export function editConnectionPath(connectionId: string): string {
  return `/settings/registries?edit=${encodeURIComponent(connectionId)}`;
}

/** An inline row inside a card — not a banner, which would overstate it. */
export function FeatureUnavailable({ feature }: { feature: AgentFeature }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{FEATURE_REASON[feature]}</span>
    </div>
  );
}

export function NoAgentEmptyState({ connectionId }: { connectionId: string }) {
  return (
    <EmptyState
      icon={<ServerCog className="h-6 w-6 text-muted-foreground" />}
      title="No registry agent on this connection"
      description="A registry agent runs next to your Docker registry and unlocks what the registry API cannot do on its own: reclaiming disk space with garbage collection, per-repository storage figures, pull counts, stale-upload cleanup, read-only mode, logs, docker login accounts and vulnerability scans."
      action={
        <Button asChild>
          <Link to={editConnectionPath(connectionId)}>Set up an agent</Link>
        </Button>
      }
    />
  );
}

/** One-sentence variant, for a card that is only part of a page. */
export function NoAgentInline({ connectionId, sentence }: { connectionId: string; sentence: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      <span>{sentence}</span>
      <Link
        to={editConnectionPath(connectionId)}
        className="w-fit text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Set up an agent
      </Link>
    </div>
  );
}

export function AgentOfflineNotice({
  agentUrl,
  message,
  onRetry,
}: {
  agentUrl?: string;
  message?: string;
  onRetry: () => void;
}) {
  return (
    <Notice
      tone="danger"
      title="Agent unreachable"
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <p>
        Registry Vault could not reach the agent at{' '}
        <span className="font-mono text-xs">{agentUrl ?? 'its configured address'}</span>. The
        registry itself may still be serving pulls and pushes — only agent operations are affected.
      </p>
      {message && <p className="mt-1 font-mono text-xs">{message}</p>}
    </Notice>
  );
}

export function AgentUnauthorizedNotice({
  connectionId,
  agentUrl,
}: {
  connectionId: string;
  agentUrl?: string;
}) {
  return (
    <Notice
      tone="danger"
      title="Agent rejected the API key"
      action={
        <Button asChild variant="outline" size="sm">
          <Link to={editConnectionPath(connectionId)}>Edit connection</Link>
        </Button>
      }
    >
      The agent at <span className="font-mono text-xs">{agentUrl ?? 'its configured address'}</span>{' '}
      answered, but the stored key is not accepted. Update the key on the connection.
    </Notice>
  );
}

/** Generic permission gating now lives in components/shared; re-exported here
 *  so the agent screens keep importing their states from one place. */
export {
  DisabledReason,
  GatedControl,
  ADMIN_ONLY_REASON,
  CURATE_ONLY_REASON,
  GC_RUNNING_REASON,
} from '@/components/shared/gated-control';
