import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import type { AgentFeature, IAgentMaintenance } from '@registry-vault/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { ADMIN_ONLY_REASON, FeatureUnavailable, GatedControl } from '../agent-states';
import { formatDateTime, formatRelativeTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const MAX_REASON_LENGTH = 200;

interface ReadOnlyCardProps {
  features: readonly AgentFeature[];
  maintenance?: IAgentMaintenance;
  isLoading: boolean;
  isSaving: boolean;
  isAdmin: boolean;
  connectionName: string;
  onChange: (readOnly: boolean, reason?: string) => void;
}

export function ReadOnlyCard({
  features,
  maintenance,
  isLoading,
  isSaving,
  isAdmin,
  connectionName,
  onChange,
}: ReadOnlyCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogReason, setDialogReason] = useState('');
  const [cardReason, setCardReason] = useState('');

  useEffect(() => {
    setCardReason(maintenance?.reason ?? '');
  }, [maintenance?.reason]);

  const isReadOnly = maintenance?.readOnly ?? false;
  const hasReasonChanged = isReadOnly && cardReason !== (maintenance?.reason ?? '');

  function handleToggle(next: boolean) {
    // Turning it off restores service; needing two clicks for that is hostile.
    if (!next) {
      onChange(false);
      return;
    }
    setDialogReason('');
    setConfirmOpen(true);
  }

  return (
    <Card className={cn(isReadOnly && 'border-[hsl(var(--severity-medium))]/40')}>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Lock className="h-4 w-4" /> Read-only mode
        </CardTitle>
        <CardDescription>
          Rejects every push with 503 while you take a backup or migrate. Pulls keep working. The
          setting survives a restart.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!features.includes('maintenance') ? (
          <FeatureUnavailable feature="maintenance" />
        ) : isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="readOnly">Read-only</Label>
              <GatedControl disabled={!isAdmin} reason={ADMIN_ONLY_REASON}>
                <Switch
                  id="readOnly"
                  checked={isReadOnly}
                  disabled={!isAdmin || isSaving}
                  onCheckedChange={handleToggle}
                />
              </GatedControl>
            </div>

            {isReadOnly && (
              <div className="space-y-2">
                <Label htmlFor="readOnlyReason">Reason (shown to clients)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="readOnlyReason"
                    value={cardReason}
                    maxLength={MAX_REASON_LENGTH}
                    disabled={!isAdmin}
                    onChange={(event) => setCardReason(event.target.value)}
                    placeholder="e.g. nightly backup"
                  />
                  {hasReasonChanged && (
                    <Button
                      size="sm"
                      disabled={!isAdmin || isSaving}
                      onClick={() => onChange(true, cardReason)}
                    >
                      Save reason
                    </Button>
                  )}
                </div>
              </div>
            )}

            {isReadOnly && maintenance?.since && (
              <p className="text-xs text-muted-foreground" title={formatDateTime(maintenance.since)}>
                On since {formatRelativeTime(maintenance.since)}
                {maintenance.reason ? ` · "${maintenance.reason}"` : ''}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Garbage collection pauses pushes too, but it does not change this setting.
            </p>
          </>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Put this registry in read-only mode?</DialogTitle>
            <DialogDescription>
              Every push to <strong>{connectionName}</strong> will be rejected with 503 until you
              turn this off, including pushes from CI. Pulls keep working.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="dialogReason">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="dialogReason"
              value={dialogReason}
              maxLength={MAX_REASON_LENGTH}
              onChange={(event) => setDialogReason(event.target.value)}
              placeholder="e.g. nightly backup"
            />
          </div>
          <DialogFooter>
            <Button autoFocus variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                onChange(true, dialogReason || undefined);
              }}
            >
              Turn on read-only mode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
