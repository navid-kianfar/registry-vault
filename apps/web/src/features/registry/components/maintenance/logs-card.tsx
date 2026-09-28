import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, ScrollText } from 'lucide-react';
import type { AgentFeature, AgentLogSource, IAgentLogs } from '@registry-vault/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FeatureUnavailable } from '../agent-states';
import { cn } from '@/lib/utils';

const LINE_OPTIONS = [100, 200, 500, 1000, 2000] as const;
const AUTO_SCROLL_THRESHOLD_PX = 40;
const COPY_FEEDBACK_MS = 2000;

interface LogsCardProps {
  features: readonly AgentFeature[];
  logs?: IAgentLogs;
  isLoading: boolean;
  isFetching: boolean;
  /** The third tab only exists when the agent runs a second process. */
  hasExtraProcess: boolean;
  source: AgentLogSource;
  lines: number;
  isAuto: boolean;
  onSourceChange: (source: AgentLogSource) => void;
  onLinesChange: (lines: number) => void;
  onAutoChange: (auto: boolean) => void;
  onRefresh: () => void;
}

export function LogsCard({
  features,
  logs,
  isLoading,
  isFetching,
  hasExtraProcess,
  source,
  lines,
  isAuto,
  onSourceChange,
  onLinesChange,
  onAutoChange,
  onRefresh,
}: LogsCardProps) {
  const viewerRef = useRef<HTMLPreElement>(null);
  const [hasCopied, setHasCopied] = useState(false);
  const logLines = logs?.lines ?? [];

  // Follow the tail only when the reader is already at it — yanking the view
  // away from someone reading older lines is worse than not following.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const distanceFromBottom = viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight;
    if (distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX) {
      viewer.scrollTop = viewer.scrollHeight;
    }
  }, [logLines]);

  async function handleCopy() {
    await navigator.clipboard.writeText(logLines.join('\n'));
    setHasCopied(true);
    window.setTimeout(() => setHasCopied(false), COPY_FEEDBACK_MS);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <ScrollText className="h-4 w-4" /> Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!features.includes('logs') ? (
          <FeatureUnavailable feature="logs" />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Tabs value={source} onValueChange={(value) => onSourceChange(value as AgentLogSource)}>
                <TabsList>
                  <TabsTrigger value="registry">Registry</TabsTrigger>
                  <TabsTrigger value="agent">Agent</TabsTrigger>
                  {hasExtraProcess && <TabsTrigger value="extra">Registry Vault</TabsTrigger>}
                </TabsList>
              </Tabs>

              <div className="flex flex-wrap items-center gap-2">
                <Select value={String(lines)} onValueChange={(value) => onLinesChange(Number(value))}>
                  <SelectTrigger className="h-8 w-[110px]" aria-label="Number of log lines">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option} lines
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-1.5">
                  <Label htmlFor="logsAuto" className="text-xs">
                    Auto
                  </Label>
                  <Switch id="logsAuto" checked={isAuto} onCheckedChange={onAutoChange} />
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onRefresh}
                  aria-label="Refresh logs"
                  title="Refresh logs"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleCopy}
                  aria-label="Copy all log lines"
                  title="Copy all log lines"
                >
                  {hasCopied ? (
                    <Check className="h-3.5 w-3.5 text-[hsl(var(--severity-none))]" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {isLoading ? (
              <Skeleton className="h-[320px] w-full lg:h-[480px]" />
            ) : (
              <pre
                ref={viewerRef}
                role="region"
                aria-label="Registry logs"
                tabIndex={0}
                className="h-[320px] overflow-auto whitespace-pre rounded-md border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:h-[480px]"
              >
                {logLines.length === 0 ? (
                  <span className="text-muted-foreground">No log lines yet.</span>
                ) : (
                  logLines.join('\n')
                )}
              </pre>
            )}

            <p className="text-xs text-muted-foreground">
              The agent keeps the last 2,000 lines of each source in memory.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
