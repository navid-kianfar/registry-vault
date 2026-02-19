import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, Download, Box, Scale, User, ChevronRight, Tag, ListChecks } from 'lucide-react';
import type { INpmPackageVersion, INpmPackage } from '@registryvault/shared';
import { RegistryType } from '@registryvault/shared';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { CopyCommand } from '@/components/shared/copy-command';
import { EmptyState } from '@/components/shared/empty-state';
import { BulkActionsBar } from '@/components/shared/bulk-actions-bar';
import { BulkDeleteConfirmationDialog } from '@/components/shared/bulk-delete-confirmation-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useNpmPackage, useNpmPackageVersions } from '@/services/queries/npm.queries';
import { useBulkDelete, useCleanupVersions } from '@/services/queries/bulk-operations.queries';
import { useSelection } from '@/hooks/use-selection';
import { formatBytes, formatNumber, formatDate } from '@/lib/formatters';

function VersionRow({
  v,
  pkg,
  onClick,
  selectionMode,
  isSelected,
  onToggle,
}: {
  v: INpmPackageVersion;
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
            aria-label={`Select ${v.version}`}
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
            <span className="font-semibold text-sm font-mono">{v.version}</span>
            {pkg.distTags.latest === v.version && (
              <Badge variant="secondary" className="text-[10px]">latest</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            <span>{formatDate(v.publishedAt)}</span>
            <span>{formatBytes(v.sizeBytes)}</span>
            <span>{formatNumber(v.downloads)} downloads</span>
          </div>
        </div>
        {!selectionMode && (
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
        )}
      </button>
    </div>
  );
}

export default function NpmPackageDetailPage() {
  const { packageName } = useParams<{ packageName: string }>();
  const navigate = useNavigate();
  const { data: pkg, isLoading } = useNpmPackage(packageName!);
  const { data: versions, isLoading: versionsLoading } = useNpmPackageVersions(packageName!);

  const latestVersion = versions?.[0];
  const latestDeps = latestVersion?.dependencies ?? {};

  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const allVersionIds = useMemo(() => versions?.map((v) => v.version) ?? [], [versions]);
  const selection = useSelection(allVersionIds);
  const bulkDelete = useBulkDelete();
  const cleanupVersions = useCleanupVersions();

  const selectedItems = useMemo(
    () => (versions ?? [])
      .filter((v) => selection.selected.has(v.version))
      .map((v) => ({ id: v.version, name: v.version })),
    [versions, selection.selected],
  );

  const handleConfirmDelete = () => {
    bulkDelete.mutate(
      {
        registryType: RegistryType.NPM,
        items: selectedItems.map((v) => ({
          packageIdentifier: packageName!,
          versionIdentifier: v.id,
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

  const handleKeepLastN = (n: number) => {
    cleanupVersions.mutate(
      {
        registryType: RegistryType.NPM,
        packageIdentifier: packageName!,
        keepCount: n,
      },
      {
        onSuccess: () => {
          selection.clear();
          setSelectionMode(false);
        },
      },
    );
  };

  const handleDeleteOlderThan = (date: string) => {
    cleanupVersions.mutate(
      {
        registryType: RegistryType.NPM,
        packageIdentifier: packageName!,
        olderThanDate: new Date(date).toISOString(),
      },
      {
        onSuccess: () => {
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/npm')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (!pkg) {
    return <div className="py-12 text-center text-muted-foreground">Package not found.</div>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/npm')} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to Packages
      </Button>

      <PageHeader title={pkg.name} description={pkg.description}>
        {pkg.license && (
          <Badge variant="outline" className="gap-1">
            <Scale className="h-3 w-3" />
            {pkg.license}
          </Badge>
        )}
      </PageHeader>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Downloads" value={formatNumber(pkg.totalDownloads)} icon={<Download className="h-4 w-4" />} />
        <StatCard label="Latest Version" value={pkg.latestVersion} icon={<Box className="h-4 w-4" />} />
        <StatCard label="Author" value={pkg.author || 'N/A'} icon={<User className="h-4 w-4" />} />
        <StatCard label="License" value={pkg.license || 'N/A'} icon={<Scale className="h-4 w-4" />} />
      </div>

      <div className="space-y-2">
        <CopyCommand command={`npm install ${pkg.name}`} />
        <CopyCommand command={`yarn add ${pkg.name}`} />
        <CopyCommand command={`pnpm add ${pkg.name}`} />
      </div>

      <Tabs defaultValue="readme">
        <TabsList>
          <TabsTrigger value="readme">Readme</TabsTrigger>
          <TabsTrigger value="versions">Versions ({versions?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
        </TabsList>

        <TabsContent value="readme" className="mt-4">
          <Card>
            <CardContent className="p-6">
              {pkg.readmeContent ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{pkg.readmeContent}</ReactMarkdown>
                </div>
              ) : (
                <EmptyState title="No readme available" description="This package does not have a readme file." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions" className="space-y-3 mt-4">
          <div className="flex items-center justify-end">
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

          {selectionMode && allVersionIds.length > 0 && (
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
            {versionsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] rounded-lg" />
              ))
            ) : !versions?.length ? (
              <EmptyState title="No versions found" />
            ) : (
              versions.map((v) => (
                <VersionRow
                  key={v.version}
                  v={v}
                  pkg={pkg}
                  onClick={() => navigate(`/npm/${encodeURIComponent(packageName!)}/versions/${v.version}`)}
                  selectionMode={selectionMode}
                  isSelected={selection.selected.has(v.version)}
                  onToggle={() => selection.toggle(v.version)}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="dependencies" className="space-y-4 mt-4">
          {Object.keys(latestDeps).length === 0 ? (
            <EmptyState title="No dependencies" description="This package has no dependencies." />
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Dependencies ({Object.keys(latestDeps).length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {Object.entries(latestDeps).map(([name, range]) => (
                  <div key={name} className="flex items-center justify-between text-sm py-1">
                    <span className="font-medium">{name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{range}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {selectionMode && (
        <BulkActionsBar
          count={selection.count}
          onDelete={() => setConfirmOpen(true)}
          onKeepLastN={handleKeepLastN}
          onDeleteOlderThan={handleDeleteOlderThan}
          onClear={selection.clear}
          isDeleting={bulkDelete.isPending || cleanupVersions.isPending}
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
