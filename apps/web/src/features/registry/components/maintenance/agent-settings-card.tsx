import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { AgentFeature, IAgentSettings } from '@registry-vault/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ADMIN_ONLY_REASON, FeatureUnavailable, GatedControl } from '../agent-states';

const MIN_WARNING_PERCENT = 1;
const MAX_WARNING_PERCENT = 99;
const LOW_DISK_ERROR_ID = 'lowDiskWarningError';

interface AgentSettingsCardProps {
  features: readonly AgentFeature[];
  settings?: IAgentSettings;
  isLoading: boolean;
  isSaving: boolean;
  isAdmin: boolean;
  onSave: (next: IAgentSettings) => void;
}

export function AgentSettingsCard({
  features,
  settings,
  isLoading,
  isSaving,
  isAdmin,
  onSave,
}: AgentSettingsCardProps) {
  const [warningPercent, setWarningPercent] = useState('85');
  const [autoScan, setAutoScan] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setWarningPercent(String(settings.lowDiskWarningPercent));
    setAutoScan(settings.autoScanOnPush);
  }, [settings]);

  const parsedPercent = Number(warningPercent);
  const isPercentValid =
    Number.isInteger(parsedPercent) &&
    parsedPercent >= MIN_WARNING_PERCENT &&
    parsedPercent <= MAX_WARNING_PERCENT;

  const hasScanFeature = features.includes('scan');
  const hasChanges =
    !!settings &&
    (parsedPercent !== settings.lowDiskWarningPercent || autoScan !== settings.autoScanOnPush);

  // A PUT replaces the whole object: keep the schedule this card does not own.
  function handleSave() {
    if (!settings) return;
    onSave({
      ...settings,
      lowDiskWarningPercent: parsedPercent,
      autoScanOnPush: autoScan,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <SlidersHorizontal className="h-4 w-4" /> Agent settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : !settings ? (
          <p className="text-sm text-muted-foreground">No settings available.</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="lowDiskWarningPercent">Warn about low disk at</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="lowDiskWarningPercent"
                  type="number"
                  min={MIN_WARNING_PERCENT}
                  max={MAX_WARNING_PERCENT}
                  className="w-20"
                  value={warningPercent}
                  disabled={!isAdmin}
                  aria-invalid={!isPercentValid}
                  aria-describedby={isPercentValid ? undefined : LOW_DISK_ERROR_ID}
                  onChange={(event) => setWarningPercent(event.target.value)}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              {isPercentValid ? (
                <p className="text-xs text-muted-foreground">
                  The dashboard and this registry show a warning at or above this usage.
                </p>
              ) : (
                <p id={LOW_DISK_ERROR_ID} className="text-xs text-destructive">
                  Enter a number between {MIN_WARNING_PERCENT} and {MAX_WARNING_PERCENT}.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="autoScanOnPush">Scan new tags automatically</Label>
                  <p className="text-xs text-muted-foreground">
                    Every newly pushed tag is scanned with Trivy. Scans run one at a time.
                  </p>
                </div>
                <GatedControl disabled={!isAdmin} reason={ADMIN_ONLY_REASON}>
                  <Switch
                    id="autoScanOnPush"
                    checked={autoScan}
                    disabled={!isAdmin || !hasScanFeature}
                    onCheckedChange={setAutoScan}
                  />
                </GatedControl>
              </div>
              {!hasScanFeature && <FeatureUnavailable feature="scan" />}
            </div>

            <div className="flex justify-end">
              <GatedControl disabled={!isAdmin} reason={ADMIN_ONLY_REASON}>
                <Button
                  size="sm"
                  disabled={!isAdmin || !hasChanges || !isPercentValid || isSaving}
                  onClick={handleSave}
                >
                  {isSaving ? 'Saving…' : 'Save settings'}
                </Button>
              </GatedControl>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
