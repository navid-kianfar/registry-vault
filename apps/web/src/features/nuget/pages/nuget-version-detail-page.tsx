import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, HardDrive, ShieldCheck, Clock, Package } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { CopyCommand } from '@/components/shared/copy-command';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNuGetPackage, useNuGetPackageVersions } from '@/services/queries/nuget.queries';
import { formatBytes, formatNumber, formatDate } from '@/lib/formatters';

export default function NugetVersionDetailPage() {
  const { packageId, version } = useParams<{ packageId: string; version: string }>();
  const navigate = useNavigate();

  const { data: pkg } = useNuGetPackage(packageId!);
  const { data: versions, isLoading } = useNuGetPackageVersions(packageId!);

  const versionData = versions?.find((v) => v.version === version);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/nuget/${packageId}`)} className="gap-1.5">
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
        <Button variant="ghost" size="sm" onClick={() => navigate(`/nuget/${packageId}`)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Package
        </Button>
        <div className="py-12 text-center text-muted-foreground">Version not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/nuget/${packageId}`)} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to {pkg?.packageId || 'Package'}
      </Button>

      <PageHeader title={`${pkg?.packageId || packageId} v${versionData.version}`} description="Version details and dependencies">
        <div className="flex items-center gap-2">
          {versionData.isPrerelease && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
              Prerelease
            </Badge>
          )}
          {!versionData.isListed && (
            <Badge variant="outline">Unlisted</Badge>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Downloads" value={formatNumber(versionData.downloads)} icon={<Download className="h-4 w-4" />} />
        <StatCard label="Size" value={formatBytes(versionData.sizeBytes)} icon={<HardDrive className="h-4 w-4" />} />
        <StatCard label="Hash Algorithm" value={versionData.packageHashAlgorithm} icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard label="Published" value={formatDate(versionData.publishedAt)} icon={<Clock className="h-4 w-4" />} />
      </div>

      <CopyCommand command={`dotnet add package ${pkg?.packageId || packageId} --version ${versionData.version}`} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" /> Package Hash
          </CardTitle>
        </CardHeader>
        <CardContent>
          <code className="text-xs font-mono text-muted-foreground break-all">{versionData.packageHash}</code>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Dependencies</h2>
        {versionData.dependencies.length === 0 ? (
          <EmptyState title="No dependencies" description="This version has no dependencies." />
        ) : (
          versionData.dependencies.map((group) => (
            <Card key={group.targetFramework}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono">{group.targetFramework}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {group.dependencies.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No dependencies for this framework</p>
                ) : (
                  group.dependencies.map((dep) => (
                    <div key={dep.id} className="flex items-center justify-between text-sm py-1">
                      <span className="font-medium">{dep.id}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">{dep.versionRange}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
