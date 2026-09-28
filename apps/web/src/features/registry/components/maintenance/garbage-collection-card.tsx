import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  Loader2,
  Trash2,
} from 'lucide-react';
import type { AgentFeature, IAgentGcJob, IAgentSettings } from '@registry-vault/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Notice } from '@/components/shared/notice';
import {
  ADMIN_ONLY_REASON,
  CURATE_ONLY_REASON,
  FeatureUnavailable,
  GatedControl,
} from '../agent-states';
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatRelativeTime,
} from '@/lib/formatters';
import { isJobActive } from '@/services/queries/agent.queries';
import { cn } from '@/lib/utils';

const OUTPUT_TAIL_LINES = 8;
const GC_MIN_REGISTRY_MAJOR = 3;
const HOURS_IN_DAY = 24;
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Never disable on a version we could not read — let the agent's 409 speak. */
function isGcUnsupported(registryVersion?: string): boolean {
  if (!registryVersion) return false;
  const major = Number(registryVersion.split('.')[0]);
  return Number.isFinite(major) && major < GC_MIN_REGISTRY_MAJOR;
}

function ElapsedSince({ startedAt }: { startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // A local clock: polling the API once a second to tick a timer would be absurd.
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;

  return <>{formatDuration(now - started)}</>;
}

function OutputTail({ output }: { output: string[] }) {
  if (output.length === 0) return null;
  const tail = output.slice(-OUTPUT_TAIL_LINES);
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
      {tail.join('\n')}
    </pre>
  );
}

function GcHistory({ history }: { history: readonly IAgentGcJob[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 rounded-md py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} />
        History ({history.length} runs)
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {history.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No previous runs.</p>
        ) : (
          <Table>
            <caption className="sr-only">Previous garbage collection runs</caption>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="text-right">Freed</TableHead>
                <TableHead className="hidden md:table-cell text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((job) => {
                const duration =
                  job.startedAt && job.finishedAt
                    ? formatDuration(
                        new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime(),
                      )
                    : '—';
                return (
                  <TableRow key={job.id}>
                    <TableCell title={job.startedAt ? formatDateTime(job.startedAt) : undefined}>
                      {job.startedAt ? formatRelativeTime(job.startedAt) : '—'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px]">
                        {job.dryRun ? 'Dry run' : 'Full'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {job.state === 'failed' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0}>
                              <Badge
                                variant="outline"
                                className="border-destructive/25 bg-destructive/10 text-[10px] text-destructive"
                              >
                                Failed
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {job.error ?? 'No error recorded.'}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-[hsl(var(--severity-none))]/25 bg-[hsl(var(--severity-none))]/10 text-[10px] text-[hsl(var(--severity-none))]"
                        >
                          Succeeded
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(job.freedBytes ?? 0)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right tabular-nums">
                      {duration}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function GcResult({ job, onRunForReal }: { job: IAgentGcJob; onRunForReal: () => void }) {
  const freed = job.freedBytes ?? 0;
  const duration =
    job.startedAt && job.finishedAt
      ? formatDuration(new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime())
      : null;
  const when = job.startedAt ? formatRelativeTime(job.startedAt) : 'recently';

  // formatNumber abbreviates above 1000, so the exact counts live in the title.
  const exactCounts = `${(job.blobsDeleted ?? 0).toLocaleString()} blobs, ${(job.manifestsDeleted ?? 0).toLocaleString()} manifests`;

  const deletionDetail = [
    `${formatNumber(job.blobsDeleted ?? 0)} blobs and ${formatNumber(job.manifestsDeleted ?? 0)} manifests ${job.dryRun ? 'would be deleted' : 'deleted'}`,
    duration ? `took ${duration}` : null,
    !job.dryRun && job.usedBytesBefore !== undefined && job.usedBytesAfter !== undefined
      ? `${formatBytes(job.usedBytesBefore)} → ${formatBytes(job.usedBytesAfter)} used`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (job.dryRun) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 text-sm">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p>
              Dry run {when} —{' '}
              {freed > 0 ? `${formatBytes(freed)} can be freed` : 'nothing to free'}
            </p>
            <p className="text-xs text-muted-foreground" title={exactCounts}>{deletionDetail}</p>
          </div>
        </div>
        {freed > 0 && (
          <Button size="sm" onClick={onRunForReal}>
            Run it for real
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--severity-none))]" />
      <div>
        <p>
          Last run {when} — {freed > 0 ? `freed ${formatBytes(freed)}` : 'nothing to free'}
        </p>
        <p className="text-xs text-muted-foreground" title={exactCounts}>{deletionDetail}</p>
      </div>
    </div>
  );
}

interface GcScheduleBlockProps {
  settings?: IAgentSettings;
  isLoading: boolean;
  isAdmin: boolean;
  isSaving: boolean;
  onSave: (next: IAgentSettings) => void;
}

function GcScheduleBlock({ settings, isLoading, isAdmin, isSaving, onSave }: GcScheduleBlockProps) {
  const [schedule, setSchedule] = useState<IAgentSettings['gcSchedule']>('off');
  const [hour, setHour] = useState(3);
  const [weekday, setWeekday] = useState(0);
  const [afterRetention, setAfterRetention] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setSchedule(settings.gcSchedule);
    setHour(settings.gcHour);
    setWeekday(settings.gcWeekday);
    setAfterRetention(settings.gcAfterRetention);
  }, [settings]);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!settings) return null;

  const hasChanges =
    schedule !== settings.gcSchedule ||
    hour !== settings.gcHour ||
    weekday !== settings.gcWeekday ||
    afterRetention !== settings.gcAfterRetention;

  // A PUT replaces the whole object: carry the fields this block does not own.
  function handleSave() {
    onSave({
      ...settings!,
      gcSchedule: schedule,
      gcHour: hour,
      gcWeekday: weekday,
      gcAfterRetention: afterRetention,
    });
  }

  const isOff = schedule === 'off';

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Schedule</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="gcSchedule">Run automatically</Label>
          <Select
            value={schedule}
            onValueChange={(value) => setSchedule(value as IAgentSettings['gcSchedule'])}
            disabled={!isAdmin}
          >
            <SelectTrigger id="gcSchedule" className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {schedule === 'weekly' && (
          <div className="space-y-1.5">
            <Label htmlFor="gcWeekday">on</Label>
            <Select
              value={String(weekday)}
              onValueChange={(value) => setWeekday(Number(value))}
              disabled={!isAdmin}
            >
              <SelectTrigger id="gcWeekday" className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="gcHour">at</Label>
          <Select
            value={String(hour)}
            onValueChange={(value) => setHour(Number(value))}
            disabled={isOff || !isAdmin}
          >
            <SelectTrigger id="gcHour" className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: HOURS_IN_DAY }).map((_, index) => (
                <SelectItem key={index} value={String(index)}>
                  {String(index).padStart(2, '0')}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Server local time.</p>

      <div className="flex items-start gap-3">
        <Switch
          id="gcAfterRetention"
          checked={afterRetention}
          onCheckedChange={setAfterRetention}
          disabled={!isAdmin}
        />
        <div className="space-y-0.5">
          <Label htmlFor="gcAfterRetention">
            Run garbage collection after a retention policy deletes anything here
          </Label>
          <p className="text-xs text-muted-foreground">
            Retention deletes tags; garbage collection is what frees the disk. Turning this on does
            both in one go.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <GatedControl disabled={!isAdmin} reason={ADMIN_ONLY_REASON}>
          <Button size="sm" onClick={handleSave} disabled={!isAdmin || !hasChanges || isSaving}>
            {isSaving ? 'Saving…' : 'Save schedule'}
          </Button>
        </GatedControl>
      </div>
    </div>
  );
}

interface GarbageCollectionCardProps {
  features: readonly AgentFeature[];
  registryVersion?: string;
  job: IAgentGcJob | null | undefined;
  history: readonly IAgentGcJob[];
  isLoading: boolean;
  /** May start a run: administrator or maintainer. */
  canRunGc: boolean;
  /** May change the schedule: administrator only. */
  isAdmin: boolean;
  isStarting: boolean;
  connectionName: string;
  settings?: IAgentSettings;
  isSettingsLoading: boolean;
  isSavingSettings: boolean;
  pollTimedOut: boolean;
  onStart: (dryRun: boolean) => void;
  onResumePolling: () => void;
  onSaveSettings: (next: IAgentSettings) => void;
}

export function GarbageCollectionCard({
  features,
  registryVersion,
  job,
  history,
  isLoading,
  canRunGc,
  isAdmin,
  isStarting,
  connectionName,
  settings,
  isSettingsLoading,
  isSavingSettings,
  pollTimedOut,
  onStart,
  onResumePolling,
  onSaveSettings,
}: GarbageCollectionCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const hasGc = features.includes('gc');
  const unsupported = isGcUnsupported(registryVersion);
  const isRunning = isJobActive(job?.state);

  const disabledReason = !canRunGc
    ? CURATE_ONLY_REASON
    : unsupported
      ? 'Garbage collection needs registry 3.'
      : 'Garbage collection is already running.';
  const runDisabled = !canRunGc || unsupported || isRunning || isStarting;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Trash2 className="h-4 w-4" /> Garbage collection
        </CardTitle>
        <CardDescription>
          Deletes blobs that no tag points at any more and returns the space to the disk. Deleting a
          tag only unlinks it — the space comes back here. Pushes are rejected while it runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasGc ? (
          <FeatureUnavailable feature="gc" />
        ) : (
          <>
            {unsupported && (
              <Notice tone="warning" title="Garbage collection needs registry 3">
                This registry reports version <strong>{registryVersion}</strong>. On registry 2,
                deleting untagged manifests also removes platform manifests of images that are still
                tagged, which breaks them. Upgrade the registry image to{' '}
                <span className="font-mono text-xs">registry:3</span> to enable it.
              </Notice>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <GatedControl disabled={runDisabled} reason={disabledReason}>
                <Button
                  variant="outline"
                  className="w-full gap-1.5 sm:w-auto"
                  disabled={runDisabled}
                  onClick={() => onStart(true)}
                >
                  <FlaskConical className="h-4 w-4" />
                  {isStarting ? 'Checking…' : 'Dry run'}
                </Button>
              </GatedControl>
              <GatedControl disabled={runDisabled} reason={disabledReason}>
                <Button
                  className="w-full gap-1.5 sm:w-auto"
                  disabled={runDisabled}
                  onClick={() => setConfirmOpen(true)}
                >
                  {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isRunning ? 'Running…' : 'Run garbage collection'}
                </Button>
              </GatedControl>
            </div>

            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div aria-live="polite" className="space-y-3">
                {isRunning && job && (
                  <>
                    <p className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      {job.dryRun ? 'Dry run' : 'Garbage collection'} is running — started{' '}
                      <ElapsedSince startedAt={job.startedAt} /> ago
                    </p>
                    {!job.dryRun && (
                      <Notice tone="warning" title="Pushes are paused">
                        Pushes to this registry are rejected with 503 until it finishes. Pulls are
                        unaffected.
                      </Notice>
                    )}
                    <OutputTail output={job.output} />
                    {pollTimedOut && (
                      <Notice
                        tone="warning"
                        title="Still running"
                        action={
                          <Button variant="outline" size="sm" onClick={onResumePolling}>
                            Check again
                          </Button>
                        }
                      >
                        This is taking longer than expected, so Registry Vault stopped watching it.
                      </Notice>
                    )}
                  </>
                )}

                {!isRunning && job?.state === 'failed' && (
                  <div className="space-y-2">
                    <Notice
                      tone="danger"
                      title="Garbage collection failed"
                      action={
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={runDisabled}
                          onClick={() => onStart(false)}
                        >
                          Try again
                        </Button>
                      }
                    >
                      {job.error ?? 'The agent did not report a reason.'}
                    </Notice>
                    <OutputTail output={job.output} />
                    <p className="text-xs text-muted-foreground">
                      The write gate is always reopened, even after a failure — pushes are working
                      again.
                    </p>
                  </div>
                )}

                {!isRunning && job?.state === 'succeeded' && (
                  <div className="space-y-2">
                    <GcResult job={job} onRunForReal={() => setConfirmOpen(true)} />
                    {job.output.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-1 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                          <ChevronRight className="h-4 w-4" /> Output
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2">
                          <OutputTail output={job.output} />
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}

                {!job && <p className="text-sm text-muted-foreground">No runs yet.</p>}
              </div>
            )}

            <GcHistory history={history} />

            <Separator />

            <GcScheduleBlock
              settings={settings}
              isLoading={isSettingsLoading}
              isAdmin={isAdmin}
              isSaving={isSavingSettings}
              onSave={onSaveSettings}
            />
          </>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run garbage collection?</DialogTitle>
            <DialogDescription>
              While it runs, every push to <strong>{connectionName}</strong> is rejected with 503 for
              about 30 seconds of retry. Pulls keep working. It cannot be cancelled once started, and
              it may take several minutes on a large registry.
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
                onStart(false);
              }}
            >
              Run garbage collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
