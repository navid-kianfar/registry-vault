import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Layers, Tag, Cpu, HardDrive, Clock, Shield, Box } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { CopyCommand } from '@/components/shared/copy-command';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useDockerRepository, useDockerTags, useDockerImageDetail } from '@/services/queries/docker.queries';
import { formatBytes, formatRelativeTime } from '@/lib/formatters';

export default function DockerTagDetailPage() {
  const { repositoryId, tagName } = useParams<{ repositoryId: string; tagName: string }>();
  const navigate = useNavigate();

  const { data: repo } = useDockerRepository(repositoryId!);
  const { data: tagsData } = useDockerTags(repositoryId!, { page: 1, pageSize: 100 });
  const { data: detail, isLoading } = useDockerImageDetail(repositoryId!, tagName!);

  const tag = tagsData?.items.find((t) => t.name === tagName);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/docker/${repositoryId}`)} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const vulns = tag?.vulnerabilitySummary;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/docker/${repositoryId}`)} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to {repo?.name || 'Repository'}
      </Button>

      <PageHeader title={`${repo?.name || ''}:${tagName}`} description="Image tag details and layers" />

      <CopyCommand command={`docker pull registry.myorg.io/${repo?.name || ''}:${tagName}`} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Metadata Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" /> Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: 'Digest', value: detail?.digest || tag?.digest || '-', mono: true },
              { label: 'Architecture', value: `${detail?.os || tag?.os || '-'}/${detail?.architecture || tag?.architecture || '-'}` },
              { label: 'Size', value: formatBytes(detail?.sizeBytes || tag?.sizeBytes || 0) },
              { label: 'Pushed', value: detail?.createdAt ? formatRelativeTime(detail.createdAt) : tag?.pushedAt ? formatRelativeTime(tag.pushedAt) : '-' },
              ...(tag?.lastPulledAt ? [{ label: 'Last Pulled', value: formatRelativeTime(tag.lastPulledAt) }] : []),
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className={`text-sm font-medium ${('mono' in item && item.mono) ? 'font-mono text-xs max-w-[200px] truncate' : ''}`}>{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Vulnerabilities Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Vulnerabilities</CardTitle>
          </CardHeader>
          <CardContent>
            {vulns ? (
              <div className="space-y-3">
                {[
                  { label: 'Critical', val: vulns.critical, cls: 'bg-red-500', bar: 'bg-red-500/20' },
                  { label: 'High', val: vulns.high, cls: 'bg-orange-500', bar: 'bg-orange-500/20' },
                  { label: 'Medium', val: vulns.medium, cls: 'bg-yellow-500', bar: 'bg-yellow-500/20' },
                  { label: 'Low', val: vulns.low, cls: 'bg-blue-500', bar: 'bg-blue-500/20' },
                ].map((item) => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium">{item.val}</span>
                    </div>
                    <div className={`h-2 rounded-full ${item.bar}`}>
                      <div className={`h-2 rounded-full ${item.cls} transition-all`} style={{ width: `${Math.min(item.val * 5, 100)}%` }} />
                    </div>
                  </div>
                ))}
                {vulns.lastScannedAt && (
                  <p className="text-xs text-muted-foreground mt-2">Last scanned {formatRelativeTime(vulns.lastScannedAt)}</p>
                )}
              </div>
            ) : <p className="text-sm text-muted-foreground">No scan data available.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Layers */}
      {detail?.layers && detail.layers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> Image Layers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {detail.layers.map((layer, i) => {
              const maxSize = Math.max(...detail.layers.map((l) => l.sizeBytes));
              const pct = maxSize > 0 ? (layer.sizeBytes / maxSize) * 100 : 0;
              return (
                <div key={i} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] font-mono">Layer {i + 1}</Badge>
                    <span className="text-xs font-medium">{formatBytes(layer.sizeBytes)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-[hsl(var(--docker))] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <code className="text-xs text-muted-foreground break-all block">{layer.command}</code>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Labels, Ports, Env */}
      {detail && (
        <div className="grid gap-4 lg:grid-cols-3">
          {detail.labels && Object.keys(detail.labels).length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Labels</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(detail.labels).map(([k, v]) => (
                  <div key={k} className="text-xs"><span className="font-mono text-muted-foreground">{k}</span><br /><span className="font-medium">{v}</span></div>
                ))}
              </CardContent>
            </Card>
          )}
          {detail.exposedPorts && detail.exposedPorts.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Exposed Ports</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {detail.exposedPorts.map((p) => <Badge key={p} variant="outline" className="font-mono text-xs">{p}</Badge>)}
              </CardContent>
            </Card>
          )}
          {detail.env && detail.env.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Environment</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {detail.env.map((e, i) => <code key={i} className="text-xs text-muted-foreground block truncate">{e}</code>)}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
