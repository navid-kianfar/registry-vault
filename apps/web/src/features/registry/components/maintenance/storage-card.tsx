import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronsUpDown, HardDrive, RefreshCw } from 'lucide-react';
import type { AgentFeature, IAgentStorage, IAgentRepositoryStorage } from '@registry-vault/shared';
import { DEFAULT_PAGE_SIZE } from '@registry-vault/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { DiskUsageBar } from '@/components/shared/disk-usage-bar';
import { EmptyState } from '@/components/shared/empty-state';
import { FeatureUnavailable } from '../agent-states';
import { formatBytes, formatNumber, formatRelativeTime } from '@/lib/formatters';
import { cn } from '@/lib/utils';

// The app's page-size scale is 10/20/50/100 (PAGE_SIZE_OPTIONS); a size outside
// it leaves the shared pagination select blank.
const STORAGE_PAGE_SIZE = DEFAULT_PAGE_SIZE;

type SortColumn = 'name' | 'exclusiveBytes' | 'sharedBytes' | 'layerCount' | 'manifestCount';
type SortDirection = 'asc' | 'desc';

/**
 * The storage table sorts and paginates in the browser: the agent returns every
 * repository in one response, so a server round-trip per click would be slower
 * and no more correct.
 */
function sortRepositories(
  repositories: readonly IAgentRepositoryStorage[],
  column: SortColumn,
  direction: SortDirection,
): readonly IAgentRepositoryStorage[] {
  const sorted = [...repositories].sort((left, right) => {
    if (column === 'name') return left.name.localeCompare(right.name);
    return left[column] - right[column];
  });
  return direction === 'asc' ? sorted : sorted.reverse();
}

function SortableHeader({
  label,
  column,
  activeColumn,
  direction,
  onSort,
  className,
  tooltip,
}: {
  label: string;
  column: SortColumn;
  activeColumn: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
  className?: string;
  tooltip?: string;
}) {
  const isActive = activeColumn === column;
  const button = (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => onSort(column)}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      {isActive && direction === 'desc' ? (
        <ArrowDown className="ml-1 h-3.5 w-3.5" />
      ) : isActive ? (
        <ArrowUp className="ml-1 h-3.5 w-3.5" />
      ) : (
        <ChevronsUpDown className="ml-1 h-3.5 w-3.5" />
      )}
    </Button>
  );

  return (
    <TableHead className={cn('px-2 sm:px-4', className)}>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </TableHead>
  );
}

interface StorageCardProps {
  features: readonly AgentFeature[];
  storage?: IAgentStorage;
  isLoading: boolean;
  isRefreshing: boolean;
  connectionId: string;
  onRecompute: () => void;
  onShowUploads: () => void;
}

export function StorageCard({
  features,
  storage,
  isLoading,
  isRefreshing,
  connectionId,
  onRecompute,
  onShowUploads,
}: StorageCardProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('exclusiveBytes');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(STORAGE_PAGE_SIZE);

  const repositories = storage?.repositories ?? [];
  const sorted = useMemo(
    () => sortRepositories(repositories, sortColumn, sortDirection),
    [repositories, sortColumn, sortDirection],
  );
  const pageItems = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  function handleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortColumn(column);
    setSortDirection(column === 'name' ? 'asc' : 'desc');
    setPage(1);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <HardDrive className="h-4 w-4" /> Storage
          </CardTitle>
          {storage && (
            <p className="text-xs text-muted-foreground" title={storage.computedAt}>
              Computed {formatRelativeTime(storage.computedAt)} — the agent caches this for 60
              seconds.
            </p>
          )}
        </div>
        {features.includes('storage') && (
          <Button variant="outline" size="sm" onClick={onRecompute} disabled={isRefreshing} className="gap-1.5">
            <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
            {isRefreshing ? 'Recomputing…' : 'Recompute'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!features.includes('storage') ? (
          <FeatureUnavailable feature="storage" />
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : !storage ? (
          <p className="text-sm text-muted-foreground">No storage data.</p>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">Disk</p>
              <DiskUsageBar disk={storage.disk} showLabels />
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium">Registry</span>
              <span className="text-muted-foreground">
                {formatBytes(storage.registry.totalBytes)} total
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {formatBytes(storage.registry.blobBytes)} blobs
              </span>
              <span className="text-muted-foreground">·</span>
              {storage.registry.uploadBytes > 0 ? (
                <button
                  type="button"
                  onClick={onShowUploads}
                  className="rounded text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {formatBytes(storage.registry.uploadBytes)} uploads
                </button>
              ) : (
                <span className="text-muted-foreground">
                  {formatBytes(storage.registry.uploadBytes)} uploads
                </span>
              )}
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {formatNumber(storage.registry.repositoryCount)} repos
              </span>
            </div>

            {sorted.length === 0 ? (
              <EmptyState
                title="No repositories in storage"
                description="Nothing has been pushed to this registry yet."
              />
            ) : (
              <>
                <Table>
                  <caption className="sr-only">
                    Disk use per repository, largest exclusive size first
                  </caption>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader
                        label="Repository"
                        column="name"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Exclusive"
                        column="exclusiveBytes"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                        className="text-right"
                        tooltip="Blobs only this repository uses. Deleting the repository and running garbage collection frees this much."
                      />
                      <SortableHeader
                        label="Shared"
                        column="sharedBytes"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                        className="hidden sm:table-cell text-right"
                        tooltip="Blobs other repositories also use. Deleting this repository frees none of it."
                      />
                      <SortableHeader
                        label="Layers"
                        column="layerCount"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                        className="hidden md:table-cell text-right"
                      />
                      <SortableHeader
                        label="Manifests"
                        column="manifestCount"
                        activeColumn={sortColumn}
                        direction={sortDirection}
                        onSort={handleSort}
                        className="hidden md:table-cell text-right"
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((repository) => (
                      <TableRow key={repository.name}>
                        <TableCell className="max-w-[150px] px-2 sm:max-w-[220px] sm:px-4">
                          {repository.repositoryId ? (
                            <Link
                              to={`/registry/${connectionId}/docker/${repository.repositoryId}`}
                              className="block truncate font-mono text-xs text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              title={repository.name}
                            >
                              {repository.name}
                            </Link>
                          ) : (
                            <span className="block truncate font-mono text-xs" title={repository.name}>
                              {repository.name}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground sm:hidden">
                            + {formatBytes(repository.sharedBytes)} shared
                          </span>
                        </TableCell>
                        <TableCell className="px-2 text-right tabular-nums sm:px-4">
                          {formatBytes(repository.exclusiveBytes)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {formatBytes(repository.sharedBytes)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right tabular-nums">
                          {formatNumber(repository.layerCount)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right tabular-nums">
                          {formatNumber(repository.manifestCount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <DataTablePagination
                  page={page}
                  pageSize={pageSize}
                  totalCount={sorted.length}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                />
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
