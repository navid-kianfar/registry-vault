import type { AgentStatus, IRegistryAgentSummary } from '@registry-vault/shared';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRelativeTimeOr } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<AgentStatus, string> = {
  online: 'Agent online',
  offline: 'Agent offline',
  unauthorized: 'Agent unauthorized',
};

const STATUS_DOT: Record<AgentStatus, string> = {
  online: 'bg-[hsl(var(--severity-none))]',
  offline: 'bg-[hsl(var(--severity-high))]',
  unauthorized: 'bg-[hsl(var(--severity-critical))]',
};

interface AgentStatusBadgeProps {
  /** Undefined means no agent is configured on the connection. */
  agent?: IRegistryAgentSummary;
  showVersion?: boolean;
  className?: string;
}

/**
 * Status as a dot plus its words — never colour alone, so it survives a
 * greyscale screenshot and a screen reader.
 */
export function AgentStatusBadge({ agent, showVersion, className }: AgentStatusBadgeProps) {
  if (!agent) {
    return (
      <Badge variant="outline" className={cn('gap-1.5 text-muted-foreground', className)}>
        No agent
      </Badge>
    );
  }

  const label = STATUS_LABEL[agent.status];

  const badge = (
    <Badge variant="outline" className={cn('gap-1.5 font-normal', className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[agent.status])} aria-hidden="true" />
      <span>{label}</span>
      {showVersion && agent.version && (
        <span className="text-muted-foreground">· v{agent.version}</span>
      )}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-1">
          <p className="font-mono text-xs">{agent.url}</p>
          {agent.registryVersion && (
            <p className="text-xs text-muted-foreground">Registry {agent.registryVersion}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Last seen {formatRelativeTimeOr(agent.lastSeenAt, 'never')}
          </p>
          {agent.features.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {agent.features.map((feature) => (
                <Badge key={feature} variant="outline" className="px-1 py-0 font-mono text-[10px]">
                  {feature}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
