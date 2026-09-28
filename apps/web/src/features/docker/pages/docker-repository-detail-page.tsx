import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Tag,
  Download,
  HardDrive,
  Clock,
  Shield,
  ChevronRight,
  ListChecks,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { IDockerTag } from '@registry-vault/shared';
import { DEFAULT_PAGE_SIZE, RegistryType } from '@registry-vault/shared';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/empty-state';
import { BulkActionsBar } from '@/components/shared/bulk-actions-bar';
import { BulkDeleteConfirmationDialog } from '@/components/shared/bulk-delete-confirmation-dialog';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PlatformBadges } from '../components/platform-badges';
import { TagScanStatus } from '../components/tag-scan-status';
import { PullActivityCard } from '../components/pull-activity-card';
import { useDockerRepository, useDockerTags } from '@/services/queries/docker.queries';
import { useBulkDelete, useCleanupVersions } from '@/services/queries/bulk-operations.queries';
import { useStartTagScan, isJobActive } from '@/services/queries/agent.queries';
import { useRegistryConnections } from '@/services/queries/settings.queries';
import { useSelection } from '@/hooks/use-selection';
import { useCanCurate, useIsAdmin } from '@/hooks/use-is-admin';
import { AgentPageNotices } from '@/features/registry/components/agent-page-notices';
import {
  ADMIN_ONLY_REASON,
  CURATE_ONLY_REASON,
  GC_RUNNING_REASON,
  GatedControl,
  NoAgentInline,
} from '@/features/registry/components/agent-states';

const SCAN_PERMISSION_REASON = 'Only administrators and maintainers can start a scan.';
import { useAgentHealth, useAgentStorage } from '@/services/queries/agent.queries';
import { formatBytes, formatNumber, formatRelativeTime, formatRelativeTimeOr } from '@/lib/formatters';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function TagRow({
  tag,
  onClick,
  selectionMode,
  isSelected,
  onToggle,
  showPulls,
  canScan,
  canRequestScan,
  onScan,
}: {
  tag: IDockerTag;
  onClick: () => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggle: () => void;
  showPulls: boolean;
  canScan: boolean;
  canRequestScan: boolean;
  onScan: () => void;
}) {
  const isScanning = isJobActive(tag.vulnerabilitySummary.scanState);

  return (
    <div className="flex items-center gap-2">
      {selectionMode && (
        <div className="shrink-0 animate-in fade-in slide-in-from-left-2 duration-200">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggle}
            aria-label={`Select ${tag.name}`}
          />
        </div>
      )}
      {/* flex-1 + min-w-0, not w-full: a w-full flex child claims the whole row
          and pushes the scan button beside it off a narrow screen. */}
      <button
        onClick={selectionMode ? onToggle : onClick}
        className={`flex min-w-0 flex-1 items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${isSelected ? 'ring-2 ring-primary/50 border-primary/30' : ''}`}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Tag className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm font-mono">{tag.name}</span>
            <PlatformBadges platforms={tag.platforms} />
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">{tag.digest.slice(0, 19)}...</span>
            <TagScanStatus summary={tag.vulnerabilitySummary} />
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-5 shrink-0">
          {/* Without an agent pullCount is documented as 0 — a zero that means
              "unknown" is a lie, so the column is omitted instead. */}
          {showPulls && (
            <div className="text-right">
              <div
                className="flex items-center justify-end gap-1 text-xs font-medium"
                title={tag.pullCount.toLocaleString()}
              >
                <Download className="h-3 w-3" />
                {formatNumber(tag.pullCount)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {formatRelativeTimeOr(tag.lastPulledAt)}
              </div>
            </div>
          )}
          <div className="text-right">
            <div className="text-xs font-medium">{formatBytes(tag.sizeBytes)}</div>
            <div className="text-[10px] text-muted-foreground">{formatRelativeTime(tag.pushedAt)}</div>
          </div>
        </div>
        {!selectionMode && (
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
        )}
      </button>
      {/* A sibling, not a child: nesting a button inside the row button is
          invalid HTML and unreachable by keyboard. A tooltip per row would be a
          hundred tooltips, so the title and aria-label carry the reason. */}
      {canScan && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label={
            canRequestScan
              ? `Scan ${tag.name} for vulnerabilities`
              : `Scan ${tag.name} for vulnerabilities — ${SCAN_PERMISSION_REASON}`
          }
          title={canRequestScan ? 'Scan for vulnerabilities' : SCAN_PERMISSION_REASON}
          disabled={!canRequestScan || isScanning}
          onClick={onScan}
        >
          <ShieldCheck className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default function DockerRepositoryDetailPage() {
  const { repositoryId, connectionId: routeConnectionId } = useParams<{
    repositoryId: string;
    connectionId?: string;
  }>();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  // Requesting a scan is curation, not administration: Maintainers may do it.
  const canCurate = useCanCurate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [deleteRepoOpen, setDeleteRepoOpen] = useState(false);
  const [keepCount, setKeepCount] = useState('5');
  const [olderThanDays, setOlderThanDays] = useState('');
  const [notPulledForDays, setNotPulledForDays] = useState('');

  const { data: repo, isLoading: repoLoading } = useDockerRepository(repositoryId!);
  const { data: tagsData, isLoading: tagsLoading } = useDockerTags(repositoryId!, { page, pageSize });
  const { data: connections } = useRegistryConnections();

  const connectionId = repo?.registryConnectionId ?? routeConnectionId;
  const connection = connections?.find((candidate) => candidate.id === connectionId);
  const agent = connection?.agent;
  const hasAgent = !!agent;
  const hasEvents = agent?.features.includes('events') ?? false;
  const canScan = agent?.features.includes('scan') ?? false;

  const health = useAgentHealth(connectionId, hasAgent);
  const storage = useAgentStorage(connectionId, false, hasAgent);
  const isGcRunning = isJobActive(health.data?.gc.state);

  const tags = tagsData?.items ?? [];
  const allIds = useMemo(() => tags.map((t) => t.name), [tags]);
  const selection = useSelection(allIds);
  const bulkDelete = useBulkDelete();
  const cleanupVersions = useCleanupVersions();
  const startScan = useStartTagScan(repositoryId!);

  const exclusiveBytes = useMemo(() => {
    if (!repo) return undefined;
    const entry = storage.data?.repositories.find((row) => row.name === repo.name);
    return entry;
  }, [storage.data, repo]);

  const selectedItems = useMemo(
    () => tags
      .filter((t) => selection.selected.has(t.name))
      .map((t) => ({ id: t.name, name: t.name })),
    [tags, selection.selected],
  );

  const handleConfirmDelete = () => {
    bulkDelete.mutate(
      {
        registryType: RegistryType.Docker,
        items: selectedItems.map((t) => ({
          packageIdentifier: repositoryId!,
          versionIdentifier: t.name,
        })),
      },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          selection.clear();
          setSelectionMode(false);
        },
      },
    );
  };

  const handleExitSelectionMode = () => {
    setSelectionMode(false);
    selection.clear();
  };

  const handleCleanup = () => {
    const olderThanDate = olderThanDays
      ? new Date(Date.now() - Number(olderThanDays) * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    cleanupVersions.mutate(
      {
        registryType: RegistryType.Docker,
        packageIdentifier: repositoryId!,
        keepCount: keepCount ? Number(keepCount) : undefined,
        olderThanDate,
        notPulledForDays: notPulledForDays ? Number(notPulledForDays) : undefined,
      },
      { onSuccess: () => setCleanupOpen(false) },
    );
  };

  // Deleting the whole repository: the API removes the registry directory
  // through the agent when one is configured (agent.interfaces.ts), so this
  // stays a single bulk delete rather than a second, UI-side code path.
  const handleDeleteRepository = () => {
    bulkDelete.mutate(
      {
        registryType: RegistryType.Docker,
        items: [{ packageIdentifier: repositoryId! }],
      },
      {
        onSuccess: () => {
          setDeleteRepoOpen(false);
          navigate(connectionId ? `/registry/${connectionId}` : '/docker');
        },
      },
    );
  };

  if (repoLoading || tagsLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/docker')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-lg" />)}
      </div>
    );
  }

  if (!repo) return <div className="py-12 text-center text-muted-foreground">Repository not found.</div>;

  const isCleanupUnavailable = !hasAgent || !hasEvents;
  const canSubmitCleanup = !!keepCount || !!olderThanDays || !!notPulledForDays;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/docker')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to Repositories</Button>

        <AgentPageNotices connectionId={connectionId} enabled={hasAgent} />

        <PageHeader title={repo.name} description={repo.description}>
          <Badge variant={repo.isPublic ? 'secondary' : 'outline'} className="text-xs">{repo.isPublic ? 'Public' : 'Private'}</Badge>
          <GatedControl
            disabled={!isAdmin || isGcRunning}
            reason={!isAdmin ? ADMIN_ONLY_REASON : GC_RUNNING_REASON}
          >
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={!isAdmin || isGcRunning}
              onClick={() => setDeleteRepoOpen(true)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
              Delete repository
            </Button>
          </GatedControl>
        </PageHeader>

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard label="Tags" value={repo.tagCount} icon={<Tag className="h-4 w-4" />} />
          {hasAgent ? (
            <StatCard label="Total Pulls" value={formatNumber(repo.totalPulls)} icon={<Download className="h-4 w-4" />} />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div tabIndex={0} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <StatCard label="Total Pulls" value={formatNumber(repo.totalPulls)} icon={<Download className="h-4 w-4" />} />
                </div>
              </TooltipTrigger>
              <TooltipContent>Pull counts need a registry agent.</TooltipContent>
            </Tooltip>
          )}
          <StatCard label="Total Size" value={formatBytes(repo.totalSize)} icon={<HardDrive className="h-4 w-4" />} />
          <StatCard label="Last Updated" value={formatRelativeTime(repo.lastPushedAt)} icon={<Clock className="h-4 w-4" />} />
        </div>

        <PullActivityCard
          repositoryId={repositoryId!}
          connectionId={connectionId}
          hasAgent={hasAgent}
          hasEventsFeature={hasEvents}
        />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Tags</h2>
            <Badge variant="secondary" className="text-xs">{tagsData?.totalCount ?? 0}</Badge>
            <div className="flex-1" />
            {/* Deleting selected tags is open to maintainers; the Cleanup rule
                deletes by policy and stays administrator-only. */}
            <GatedControl disabled={!isAdmin} reason={ADMIN_ONLY_REASON}>
              <Button
                variant="outline"
                size="sm"
                disabled={!isAdmin}
                onClick={() => setCleanupOpen(true)}
                className="gap-1.5"
              >
                <Sparkles className="h-4 w-4" />
                Cleanup
              </Button>
            </GatedControl>
            <GatedControl disabled={!canCurate} reason={CURATE_ONLY_REASON}>
              <Button
                variant={selectionMode ? 'secondary' : 'outline'}
                size="sm"
                disabled={!canCurate}
                onClick={() => selectionMode ? handleExitSelectionMode() : setSelectionMode(true)}
                className="gap-1.5"
              >
                <ListChecks className="h-4 w-4" />
                {selectionMode ? 'Cancel' : 'Select'}
              </Button>
            </GatedControl>
          </div>

          {selectionMode && allIds.length > 0 && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
              <Checkbox
                checked={selection.isAllSelected}
                onCheckedChange={selection.toggleAll}
                aria-label="Select all"
              />
              <span className="text-sm text-muted-foreground">
                {selection.isAllSelected ? 'Deselect all' : 'Select all'}
              </span>
            </div>
          )}

          <div className="space-y-2">
            {!tags.length ? (
              <EmptyState title="No tags found" />
            ) : (
              tags.map((tag) => (
                <TagRow
                  key={tag.name}
                  tag={tag}
                  onClick={() => navigate(`/docker/${repositoryId}/tags/${tag.name}`)}
                  selectionMode={selectionMode}
                  isSelected={selection.selected.has(tag.name)}
                  onToggle={() => selection.toggle(tag.name)}
                  showPulls={hasAgent}
                  canScan={canScan}
                  canRequestScan={canCurate}
                  onScan={() => startScan.mutate({ tagName: tag.name, request: {} })}
                />
              ))
            )}
          </div>

          {tagsData && tagsData.totalCount > 0 && (
            <DataTablePagination page={page} pageSize={pageSize} totalCount={tagsData.totalCount} totalPages={tagsData.totalPages} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
          )}
        </div>

        {selectionMode && (
          <BulkActionsBar
            count={selection.count}
            onDelete={() => setConfirmOpen(true)}
            onClear={selection.clear}
            isDeleting={bulkDelete.isPending}
          />
        )}

        <BulkDeleteConfirmationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          items={selectedItems}
          onConfirm={handleConfirmDelete}
          isDeleting={bulkDelete.isPending}
        />

        {/* Delete repository */}
        <Dialog open={deleteRepoOpen} onOpenChange={setDeleteRepoOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {repo.name}?</DialogTitle>
              <DialogDescription>
                Its {repo.tagCount} tags and its directory are removed from the registry's storage,
                and it disappears from Registry Vault.{' '}
                <strong>Disk space comes back the next time garbage collection runs</strong> — until
                then the blobs are still on disk.
                {exclusiveBytes && (
                  <>
                    {' '}
                    About <strong>{formatBytes(exclusiveBytes.exclusiveBytes)}</strong> will be
                    freed; {formatBytes(exclusiveBytes.sharedBytes)} of its layers are shared with
                    other repositories and stay.
                  </>
                )}
                {!hasAgent && (
                  <>
                    {' '}
                    Without a registry agent the directory cannot be removed — the repository stops
                    listing tags but its folder stays on disk.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button autoFocus variant="outline" onClick={() => setDeleteRepoOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteRepository} disabled={bulkDelete.isPending}>
                {bulkDelete.isPending ? 'Deleting…' : 'Delete repository'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cleanup Dialog */}
        <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cleanup Old Tags</DialogTitle>
              <DialogDescription>
                Free up storage by removing old image tags from <strong>{repo.name}</strong>. A tag is
                deleted only if it matches every criterion you fill in. Leave a field empty to skip it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="keepCount">Keep latest N tags</Label>
                <Input
                  id="keepCount"
                  type="number"
                  min="0"
                  value={keepCount}
                  onChange={(e) => setKeepCount(e.target.value)}
                  placeholder="e.g. 5"
                />
                <p className="text-xs text-muted-foreground">Tags beyond this count (oldest first) will be removed. Leave empty to skip.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notPulledForDays">Delete tags not pulled for N days</Label>
                <Input
                  id="notPulledForDays"
                  type="number"
                  min="1"
                  value={notPulledForDays}
                  disabled={isCleanupUnavailable}
                  onChange={(e) => setNotPulledForDays(e.target.value)}
                  placeholder="e.g. 90"
                />
                {isCleanupUnavailable ? (
                  <NoAgentInline
                    connectionId={connectionId ?? ''}
                    sentence="Needs a registry agent on this connection — it is what counts pulls."
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Only tags nobody has pulled for this long are removed.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="olderThanDays">Delete tags older than N days</Label>
                <Input
                  id="olderThanDays"
                  type="number"
                  min="1"
                  value={olderThanDays}
                  onChange={(e) => setOlderThanDays(e.target.value)}
                  placeholder="e.g. 90"
                />
                <p className="text-xs text-muted-foreground">Only tags older than this many days will be removed. Leave empty to skip.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCleanupOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleCleanup}
                disabled={!canSubmitCleanup || cleanupVersions.isPending}
              >
                {cleanupVersions.isPending ? 'Cleaning up...' : 'Run Cleanup'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
