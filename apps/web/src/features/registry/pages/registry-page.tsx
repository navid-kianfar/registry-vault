import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Container, Tag, Download, HardDrive, Clock, ChevronRight, Package, Box, User } from 'lucide-react';
import type { IDockerRepository, INuGetPackage, INpmPackage } from '@registryvault/shared';
import { RegistryType, DEFAULT_PAGE_SIZE } from '@registryvault/shared';
import { useRegistryConnection } from '@/hooks/use-registry-connection';
import { useDockerRepositories } from '@/services/queries/docker.queries';
import { useNuGetPackages } from '@/services/queries/nuget.queries';
import { useNpmPackages } from '@/services/queries/npm.queries';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, formatNumber, formatRelativeTime } from '@/lib/formatters';

// Docker list sub-component
function DockerList({ connectionId, connectionName }: { connectionId: string; connectionName: string }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [query, setQuery] = useState('');

  const { data, isLoading } = useDockerRepositories({
    page, pageSize, query, sortBy: 'lastPushedAt', sortOrder: 'desc', registryConnectionId: connectionId,
  });

  return (
    <div className="space-y-6">
      <PageHeader title={connectionName} description="Browse and manage Docker image repositories." />

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          className="pl-8"
        />
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-lg" />)
        ) : !data?.items.length ? (
          <EmptyState title="No repositories found" description="Try adjusting your search query." />
        ) : (
          data.items.map((repo: IDockerRepository) => (
            <button
              key={repo.id}
              onClick={() => navigate(`/registry/${connectionId}/${repo.id}`)}
              className="w-full flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group"
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
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
            </button>
          ))
        )}
      </div>

      {data && data.totalCount > 0 && (
        <DataTablePagination
          page={page} pageSize={pageSize} totalCount={data.totalCount} totalPages={data.totalPages}
          onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      )}
    </div>
  );
}

// NuGet list sub-component
function NuGetList({ connectionId, connectionName }: { connectionId: string; connectionName: string }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const { data, isLoading } = useNuGetPackages({
    page, pageSize, sortBy: 'totalDownloads', sortOrder: 'desc', query: search || undefined, registryConnectionId: connectionId,
  });

  const totalCount = data?.totalCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title={connectionName} description="Browse and manage NuGet packages.">
        <Badge variant="secondary" className="gap-1">
          <Package className="h-3 w-3" />
          {totalCount} packages
        </Badge>
      </PageHeader>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search packages..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-8"
        />
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[80px] rounded-lg" />)
        ) : !data?.items.length ? (
          <EmptyState
            icon={<Package className="h-6 w-6 text-muted-foreground" />}
            title="No NuGet packages found"
            description={search ? 'Try adjusting your search terms.' : 'No packages have been published yet.'}
          />
        ) : (
          data.items.map((pkg: INuGetPackage) => (
            <button
              key={pkg.id}
              onClick={() => navigate(`/registry/${connectionId}/${pkg.id}`)}
              className="w-full flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--nuget))]/10">
                <Package className="h-5 w-5 text-[hsl(var(--nuget))]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{pkg.packageId}</span>
                  <Badge variant="secondary" className="font-mono text-[10px] px-1.5">
                    {pkg.latestVersion}
                  </Badge>
                  {pkg.isPrerelease && (
                    <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                      pre
                    </Badge>
                  )}
                </div>
                {pkg.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{pkg.description}</p>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {pkg.tags.slice(0, 3).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] font-normal">{t}</Badge>
                  ))}
                  {pkg.tags.length > 3 && (
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">+{pkg.tags.length - 3}</Badge>
                  )}
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-5 shrink-0">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Download className="h-3.5 w-3.5" />
                  <span className="font-medium">{formatNumber(pkg.totalDownloads)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  <span className="max-w-[120px] truncate">{pkg.authors[0]}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(pkg.updatedAt)}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
            </button>
          ))
        )}
      </div>

      {data && data.totalCount > 0 && (
        <DataTablePagination
          page={page} pageSize={pageSize} totalCount={data.totalCount} totalPages={data.totalPages}
          onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      )}
    </div>
  );
}

// NPM list sub-component
function NpmList({ connectionId, connectionName }: { connectionId: string; connectionName: string }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const { data, isLoading } = useNpmPackages({
    page, pageSize, sortBy: 'totalDownloads', sortOrder: 'desc', query: search || undefined, registryConnectionId: connectionId,
  });

  const totalCount = data?.totalCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title={connectionName} description="Browse and manage NPM packages.">
        <Badge variant="secondary" className="gap-1">
          <Box className="h-3 w-3" />
          {totalCount} packages
        </Badge>
      </PageHeader>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search packages..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-8"
        />
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[80px] rounded-lg" />)
        ) : !data?.items.length ? (
          <EmptyState
            icon={<Box className="h-6 w-6 text-muted-foreground" />}
            title="No NPM packages found"
            description={search ? 'Try adjusting your search terms.' : 'No packages have been published yet.'}
          />
        ) : (
          data.items.map((pkg: INpmPackage) => (
            <button
              key={pkg.id}
              onClick={() => navigate(`/registry/${connectionId}/npm/${pkg.name}`)}
              className="w-full flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group"
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
                    <Badge key={k} variant="outline" className="text-[10px] font-normal">{k}</Badge>
                  ))}
                  {pkg.keywords.length > 3 && (
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">+{pkg.keywords.length - 3}</Badge>
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
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
            </button>
          ))
        )}
      </div>

      {data && data.totalCount > 0 && (
        <DataTablePagination
          page={page} pageSize={pageSize} totalCount={data.totalCount} totalPages={data.totalPages}
          onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      )}
    </div>
  );
}

// Main registry page
export default function RegistryPage() {
  const { connectionId, connection } = useRegistryConnection();

  if (!connection) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  switch (connection.registryType) {
    case RegistryType.Docker:
      return <DockerList connectionId={connectionId!} connectionName={connection.name} />;
    case RegistryType.NuGet:
      return <NuGetList connectionId={connectionId!} connectionName={connection.name} />;
    case RegistryType.NPM:
      return <NpmList connectionId={connectionId!} connectionName={connection.name} />;
    default:
      return <div>Unknown registry type</div>;
  }
}
