import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Box, Download, ChevronRight, User, ListChecks } from 'lucide-react';
import type { INpmPackage } from '@registryvault/shared';
import { DEFAULT_PAGE_SIZE, RegistryType } from '@registryvault/shared';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { BulkActionsBar } from '@/components/shared/bulk-actions-bar';
import { BulkDeleteConfirmationDialog } from '@/components/shared/bulk-delete-confirmation-dialog';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useNpmPackages } from '@/services/queries/npm.queries';
import { useBulkDelete } from '@/services/queries/bulk-operations.queries';
import { useSelection } from '@/hooks/use-selection';
import { formatNumber } from '@/lib/formatters';

function PackageRow({
  pkg,
  onClick,
  selectionMode,
  isSelected,
  onToggle,
}: {
  pkg: INpmPackage;
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
            aria-label={`Select ${pkg.name}`}
          />
        </div>
      )}
      <button
        onClick={selectionMode ? onToggle : onClick}
        className={`w-full flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group ${isSelected ? 'ring-2 ring-primary/50 border-primary/30' : ''}`}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--npm))]/10">
          <Box className="h-5 w-5 text-[hsl(var(--npm))]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{pkg.name}</span>
            <Badge variant="secondary" className="font-mono text-[10px] px-1.5">
              {pkg.latestVersion}
            </Badge>
          </div>
          {pkg.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{pkg.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {pkg.keywords.slice(0, 3).map((k) => (
              <Badge key={k} variant="outline" className="text-[10px] font-normal">
                {k}
              </Badge>
            ))}
            {pkg.keywords.length > 3 && (
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                +{pkg.keywords.length - 3}
              </Badge>
            )}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-5 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Download className="h-3.5 w-3.5" />
            <span className="font-medium">{formatNumber(pkg.totalDownloads)}</span>
          </div>
          {pkg.author && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span className="max-w-[120px] truncate">{pkg.author}</span>
            </div>
          )}
        </div>
        {!selectionMode && (
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
        )}
      </button>
    </div>
  );
}

export default function NpmPackagesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading } = useNpmPackages({
    page,
    pageSize,
    sortBy: 'totalDownloads',
    sortOrder: 'desc',
    query: search || undefined,
  });

  const totalCount = data?.totalCount ?? 0;
  const allIds = useMemo(() => data?.items.map((p) => p.id) ?? [], [data?.items]);
  const selection = useSelection(allIds);
  const bulkDelete = useBulkDelete();

  const selectedItems = useMemo(
    () => (data?.items ?? [])
      .filter((p) => selection.selected.has(p.id))
      .map((p) => ({ id: p.id, name: p.name })),
    [data?.items, selection.selected],
  );

  const handleConfirmDelete = () => {
    bulkDelete.mutate(
      {
        registryType: RegistryType.NPM,
        items: selectedItems.map((p) => ({ packageIdentifier: p.name })),
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
      <PageHeader title="NPM Registry" description="Browse and manage NPM packages in your private registry.">
        <Badge variant="secondary" className="gap-1">
          <Box className="h-3 w-3" />
          {totalCount} packages
        </Badge>
      </PageHeader>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search packages..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
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
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[80px] rounded-lg" />
          ))
        ) : !data?.items.length ? (
          <EmptyState
            icon={<Box className="h-6 w-6 text-muted-foreground" />}
            title="No NPM packages found"
            description={search ? 'Try adjusting your search terms.' : 'No packages have been published yet.'}
          />
        ) : (
          data.items.map((pkg) => (
            <PackageRow
              key={pkg.id}
              pkg={pkg}
              onClick={() => navigate(`/npm/${pkg.name}`)}
              selectionMode={selectionMode}
              isSelected={selection.selected.has(pkg.id)}
              onToggle={() => selection.toggle(pkg.id)}
            />
          ))
        )}
      </div>

      {data && data.totalCount > 0 && (
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalCount={data.totalCount}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
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
