import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, HardDrive, PackageOpen, Clock, ShieldCheck, Box } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { CopyCommand } from '@/components/shared/copy-command';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNpmPackage, useNpmPackageVersions } from '@/services/queries/npm.queries';
import { formatBytes, formatNumber, formatDate } from '@/lib/formatters';

function DependencyCard({ title, deps }: { title: string; deps: Record<string, string> }) {
  const entries = Object.entries(deps);
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title} ({entries.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {entries.map(([name, range]) => (
          <div key={name} className="flex items-center justify-between text-sm py-1">
            <span className="font-medium">{name}</span>
            <Badge variant="outline" className="font-mono text-[10px]">{range}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function NpmVersionDetailPage() {
  const { packageName, version } = useParams<{ packageName: string; version: string }>();
  const navigate = useNavigate();

  const { data: pkg } = useNpmPackage(packageName!);
  const { data: versions, isLoading } = useNpmPackageVersions(packageName!);

  const versionData = versions?.find((v) => v.version === version);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/npm/${encodeURIComponent(packageName!)}`)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (!versionData) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/npm/${encodeURIComponent(packageName!)}`)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Package
        </Button>
        <div className="py-12 text-center text-muted-foreground">Version not found.</div>
      </div>
    );
  }

  const hasDeps =
    Object.keys(versionData.dependencies).length > 0 ||
    Object.keys(versionData.devDependencies).length > 0 ||
    Object.keys(versionData.peerDependencies).length > 0;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/npm/${encodeURIComponent(packageName!)}`)} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to {pkg?.name || 'Package'}
      </Button>

      <PageHeader title={`${pkg?.name || packageName} v${versionData.version}`} description="Version details and dependencies" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Downloads" value={formatNumber(versionData.downloads)} icon={<Download className="h-4 w-4" />} />
        <StatCard label="Size" value={formatBytes(versionData.sizeBytes)} icon={<HardDrive className="h-4 w-4" />} />
        <StatCard label="Unpacked Size" value={formatBytes(versionData.unpackedSizeBytes)} icon={<PackageOpen className="h-4 w-4" />} />
        <StatCard label="Published" value={formatDate(versionData.publishedAt)} icon={<Clock className="h-4 w-4" />} />
      </div>

      <div className="space-y-2">
        <CopyCommand command={`npm install ${pkg?.name || packageName}@${versionData.version}`} />
        <CopyCommand command={`yarn add ${pkg?.name || packageName}@${versionData.version}`} />
        <CopyCommand command={`pnpm add ${pkg?.name || packageName}@${versionData.version}`} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Metadata
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-4 py-1">
            <span className="text-sm text-muted-foreground shrink-0">Shasum</span>
            <code className="text-xs font-mono text-foreground break-all text-right">{versionData.shasum}</code>
          </div>
          <div className="flex items-start justify-between gap-4 py-1">
            <span className="text-sm text-muted-foreground shrink-0">Integrity</span>
            <code className="text-xs font-mono text-foreground break-all text-right">{versionData.integrity}</code>
          </div>
          {versionData.nodeEngine && (
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">Node Engine</span>
              <Badge variant="outline" className="font-mono text-[10px]">{versionData.nodeEngine}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Box className="h-5 w-5 text-muted-foreground" /> Dependencies
        </h2>
        {!hasDeps ? (
          <EmptyState title="No dependencies" description="This version has no dependencies." />
        ) : (
          <>
            <DependencyCard title="Dependencies" deps={versionData.dependencies} />
            <DependencyCard title="Dev Dependencies" deps={versionData.devDependencies} />
            <DependencyCard title="Peer Dependencies" deps={versionData.peerDependencies} />
          </>
        )}
      </div>
    </div>
  );
}
