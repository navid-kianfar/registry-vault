import { useEffect, useState } from 'react';
import { FileWarning } from 'lucide-react';
import type { AgentFeature, IAgentUploads } from '@registry-vault/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { CURATE_ONLY_REASON, FeatureUnavailable, GatedControl } from '../agent-states';
import { formatBytes, formatDateTime, formatRelativeTime } from '@/lib/formatters';

const LOW_THRESHOLD_HOURS = 6;
const COLLAPSED_ROW_COUNT = 5;
const DEBOUNCE_MS = 400;

interface StaleUploadsCardProps {
  features: readonly AgentFeature[];
  uploads?: IAgentUploads;
  isLoading: boolean;
  isPurging: boolean;
  /** May purge: administrator or maintainer. */
  canPurge: boolean;
  connectionName: string;
  olderThanHours: number;
  onOlderThanHoursChange: (hours: number) => void;
  onPurge: (olderThanHours: number) => void;
}

export function StaleUploadsCard({
  features,
  uploads,
  isLoading,
  isPurging,
  canPurge,
  connectionName,
  olderThanHours,
  onOlderThanHoursChange,
  onPurge,
}: StaleUploadsCardProps) {
  const [inputValue, setInputValue] = useState(String(olderThanHours));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Debounced so typing "168" does not fetch for 1, then 16, then 168.
  useEffect(() => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    const timer = window.setTimeout(() => onOlderThanHoursChange(parsed), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [inputValue, onOlderThanHoursChange]);

  const items = uploads?.uploads ?? [];
  const visible = isExpanded ? items : items.slice(0, COLLAPSED_ROW_COUNT);
  const overflow = items.length - visible.length;
  const isBelowSafeThreshold = Number(inputValue) < LOW_THRESHOLD_HOURS;
  const hasUploads = items.length > 0;

  return (
    <Card id="stale-uploads">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <FileWarning className="h-4 w-4" /> Stale uploads
        </CardTitle>
        <CardDescription>
          Layers left behind by pushes that were interrupted. They occupy disk but belong to no
          image.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!features.includes('uploads') ? (
          <FeatureUnavailable feature="uploads" />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="olderThanHours">Older than (hours)</Label>
                <Input
                  id="olderThanHours"
                  type="number"
                  min={1}
                  className="w-20"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                />
              </div>
              {uploads && (
                <p className="text-sm text-muted-foreground">
                  {formatBytes(uploads.totalBytes)} in {items.length} uploads
                </p>
              )}
            </div>

            {isBelowSafeThreshold && (
              <p className="text-xs text-[hsl(var(--severity-medium))]">
                A large image can take hours to push. Uploads younger than the threshold are never
                touched, but a low threshold can catch a push that is still running.
              </p>
            )}

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-full" />
                ))}
              </div>
            ) : !hasUploads ? (
              <p className="text-sm text-muted-foreground">
                No uploads older than {olderThanHours} hours.
              </p>
            ) : (
              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <div className="space-y-1">
                  {visible.map((upload) => (
                    <div
                      key={upload.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={upload.repository}>
                        {upload.repository}
                      </span>
                      <span
                        className="shrink-0 text-xs text-muted-foreground"
                        title={formatDateTime(upload.startedAt)}
                      >
                        {formatRelativeTime(upload.startedAt)}
                      </span>
                      <span className="w-20 shrink-0 text-right tabular-nums">
                        {formatBytes(upload.bytes)}
                      </span>
                    </div>
                  ))}
                </div>
                {!isExpanded && overflow > 0 && (
                  <CollapsibleTrigger className="mt-1 rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    + {overflow} more
                  </CollapsibleTrigger>
                )}
                <CollapsibleContent />
              </Collapsible>
            )}

            <div className="flex justify-end">
              <GatedControl disabled={!canPurge} reason={CURATE_ONLY_REASON}>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!canPurge || !hasUploads || isPurging}
                  onClick={() => setConfirmOpen(true)}
                >
                  {isPurging ? 'Purging…' : `Purge ${items.length} uploads`}
                </Button>
              </GatedControl>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Purge stale uploads?</DialogTitle>
            <DialogDescription>
              This deletes <strong>{items.length} partial uploads</strong> (
              {formatBytes(uploads?.totalBytes ?? 0)}) older than <strong>{olderThanHours} hours</strong>{' '}
              from <strong>{connectionName}</strong>. Anything younger is left alone. A push that is
              currently running and older than the threshold would have to start over.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button autoFocus variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onPurge(olderThanHours);
              }}
            >
              Purge uploads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
