import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Tag, Download, HardDrive, Clock, Shield, Cpu, ChevronRight, ListChecks } from 'lucide-react';
import type { IDockerTag } from '@registryvault/shared';
import { DEFAULT_PAGE_SIZE, RegistryType } from '@registryvault/shared';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { CopyCommand } from '@/components/shared/copy-command';
import { EmptyState } from '@/components/shared/empty-state';
import { BulkActionsBar } from '@/components/shared/bulk-actions-bar';
import { BulkDeleteConfirmationDialog } from '@/components/shared/bulk-delete-confirmation-dialog';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useDockerRepository, useDockerTags } from '@/services/queries/docker.queries';
import { useBulkDelete } from '@/services/queries/bulk-operations.queries';
import { useSelection } from '@/hooks/use-selection';
import { formatBytes, formatNumber, formatRelativeTime } from '@/lib/formatters';

function VulnBadges({ tag }: { tag: IDockerTag }) {
  const s = tag.vulnerabilitySummary;
  const items = [
    { label: 'Critical', val: s.critical, cls: 'bg-red-500/15 text-red-600 border-red-500/20' },
    { label: 'High', val: s.high, cls: 'bg-orange-500/15 text-orange-600 border-orange-500/20' },
    { label: 'Medium', val: s.medium, cls: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/20' },
    { label: 'Low', val: s.low, cls: 'bg-blue-500/15 text-blue-600 border-blue-500/20' },
  ].filter((i) => i.val > 0);

  if (!items.length) {
    return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">Clean</Badge>;
  }
  return (
    <div className="flex items-center gap-1">
      {items.map((i) => (
        <Badge key={i.label} variant="outline" className={`${i.cls} text-[10px] px-1.5 py-0 font-mono`}>
          {i.val} {i.label}
        </Badge>
      ))}
    </div>
  );
}

function TagRow({
  tag,
  onClick,
  selectionMode,
  isSelected,
  onToggle,
}: {
  tag: IDockerTag;
  onClick: () => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggle: () => void;
}) {
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
      <button
        onClick={selectionMode ? onToggle : onClick}
        className={`w-full flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group ${isSelected ? 'ring-2 ring-primary/50 border-primary/30' : ''}`}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Tag className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm font-mono">{tag.name}</span>
            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
              <Cpu className="h-2.5 w-2.5 mr-1" />
              {tag.os}/{tag.architecture}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">{tag.digest.slice(0, 19)}...</span>
            <VulnBadges tag={tag} />
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-5 shrink-0">
          <div className="text-right">
            <div className="text-xs font-medium">{formatBytes(tag.sizeBytes)}</div>
            <div className="text-[10px] text-muted-foreground">{formatRelativeTime(tag.pushedAt)}</div>
          </div>
        </div>
        {!selectionMode && (
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
        )}
      </button>
    </div>
  );
}

export default function DockerRepositoryDetailPage() {
  const { repositoryId } = useParams<{ repositoryId: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: repo, isLoading: repoLoading } = useDockerRepository(repositoryId!);
  const { data: tagsData, isLoading: tagsLoading } = useDockerTags(repositoryId!, { page, pageSize });

  const tags = tagsData?.items ?? [];
  const allIds = useMemo(() => tags.map((t) => t.name), [tags]);
  const selection = useSelection(allIds);
  const bulkDelete = useBulkDelete();

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

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/docker')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to Repositories</Button>
      <PageHeader title={repo.name} description={repo.description}>
        <Badge variant={repo.isPublic ? 'secondary' : 'outline'} className="text-xs">{repo.isPublic ? 'Public' : 'Private'}</Badge>
      </PageHeader>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tags" value={repo.tagCount} icon={<Tag className="h-4 w-4" />} />
        <StatCard label="Total Pulls" value={formatNumber(repo.totalPulls)} icon={<Download className="h-4 w-4" />} />
        <StatCard label="Total Size" value={formatBytes(repo.totalSize)} icon={<HardDrive className="h-4 w-4" />} />
        <StatCard label="Last Pushed" value={formatRelativeTime(repo.lastPushedAt)} icon={<Clock className="h-4 w-4" />} />
      </div>

      <CopyCommand command={`docker pull registry.myorg.io/${repo.name}:latest`} />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Tags</h2>
          <Badge variant="secondary" className="text-xs">{tagsData?.totalCount ?? 0}</Badge>
          <div className="flex-1" />
          <Button
            variant={selectionMode ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => selectionMode ? handleExitSelectionMode() : setSelectionMode(true)}
            className="gap-1.5"
          >
            <ListChecks className="h-4 w-4" />
            {selectionMode ? 'Cancel' : 'Select'}
          </Button>
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
    </div>
  );
}
