import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Container, Tag, Download, HardDrive, Clock, ChevronRight, ListChecks } from 'lucide-react';
import type { IDockerRepository } from '@registryvault/shared';
import { DEFAULT_PAGE_SIZE, RegistryType } from '@registryvault/shared';
import { PageHeader } from '@/components/shared/page-header';
import { BulkActionsBar } from '@/components/shared/bulk-actions-bar';
import { BulkDeleteConfirmationDialog } from '@/components/shared/bulk-delete-confirmation-dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { useDockerRepositories } from '@/services/queries/docker.queries';
import { useBulkDelete } from '@/services/queries/bulk-operations.queries';
import { useSelection } from '@/hooks/use-selection';
import { formatBytes, formatNumber, formatRelativeTime } from '@/lib/formatters';
import { EmptyState } from '@/components/shared/empty-state';

function RepoRow({
  repo,
  onClick,
  selectionMode,
  isSelected,
  onToggle,
}: {
  repo: IDockerRepository;
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
            aria-label={`Select ${repo.name}`}
          />
        </div>
      )}
      <button
        onClick={selectionMode ? onToggle : onClick}
        className={`w-full flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group ${isSelected ? 'ring-2 ring-primary/50 border-primary/30' : ''}`}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--docker))]/10">
          <Container className="h-5 w-5 text-[hsl(var(--docker))]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{repo.name}</span>
            {repo.isPublic && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Public</Badge>}
          </div>
          {repo.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{repo.description}</p>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-5 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Tags">
            <Tag className="h-3.5 w-3.5" />
            <span className="font-medium">{repo.tagCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Pulls">
            <Download className="h-3.5 w-3.5" />
            <span className="font-medium">{formatNumber(repo.totalPulls)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Size">
            <HardDrive className="h-3.5 w-3.5" />
            <span className="font-medium">{formatBytes(repo.totalSize)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Last pushed">
            <Clock className="h-3.5 w-3.5" />
            <span>{formatRelativeTime(repo.lastPushedAt)}</span>
          </div>
        </div>
        {!selectionMode && (
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
        )}
      </button>
    </div>
  );
}

export default function DockerRepositoriesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [query, setQuery] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading } = useDockerRepositories({
    page, pageSize, query, sortBy: 'lastPushedAt', sortOrder: 'desc',
  });

  const allIds = useMemo(() => data?.items.map((r) => r.id) ?? [], [data?.items]);
  const selection = useSelection(allIds);
  const bulkDelete = useBulkDelete();

  const selectedItems = useMemo(
    () => (data?.items ?? [])
      .filter((r) => selection.selected.has(r.id))
      .map((r) => ({ id: r.id, name: r.name })),
    [data?.items, selection.selected],
  );

  const handleConfirmDelete = () => {
    bulkDelete.mutate(
      {
        registryType: RegistryType.Docker,
        items: selectedItems.map((r) => ({ packageIdentifier: r.id })),
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

  return (
    <div className="space-y-6">
      <PageHeader title="Docker Registry" description="Browse and manage Docker image repositories." />

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search repositories..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            className="pl-8"
          />
        </div>
        <Button
          variant={selectionMode ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => selectionMode ? handleExitSelectionMode() : setSelectionMode(true)}
          className="gap-1.5 shrink-0"
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
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-lg" />)
        ) : !data?.items.length ? (
          <EmptyState title="No repositories found" description="Try adjusting your search query." />
        ) : (
          data.items.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              onClick={() => navigate(`/docker/${repo.id}`)}
              selectionMode={selectionMode}
              isSelected={selection.selected.has(repo.id)}
              onToggle={() => selection.toggle(repo.id)}
            />
          ))
        )}
      </div>

      {data && data.totalCount > 0 && (
        <DataTablePagination
          page={page} pageSize={pageSize} totalCount={data.totalCount} totalPages={data.totalPages}
          onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      )}

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
