import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Cpu, Layers, Loader2, Tag, RefreshCw, Shield, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { CopyCommand } from '@/components/shared/copy-command';
import { EmptyState } from '@/components/shared/empty-state';
import { Notice } from '@/components/shared/notice';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatPlatform, runnablePlatforms } from '../components/platform-badges';
import { ScanFindingsTable } from '../components/scan-findings-table';
import { useDockerRepository, useDockerTags, useDockerImageDetail } from '@/services/queries/docker.queries';
import { useRegistryConnections } from '@/services/queries/settings.queries';
import { useSyncRegistryConnection } from '@/services/queries/settings.queries';
import {
  SCAN_POLL_TIMEOUT_MS,
  isJobActive,
  useScanCompletionEffects,
  useStartTagScan,
  useTagScan,
} from '@/services/queries/agent.queries';
import { useCanCurate } from '@/hooks/use-is-admin';
import {
  FeatureUnavailable,
  GatedControl,
  NoAgentInline,
} from '@/features/registry/components/agent-states';

const SCAN_PERMISSION_REASON = 'Only administrators and maintainers can start a scan.';
import { formatBytes, formatDateTime, formatNumber, formatRelativeTime, formatRelativeTimeOr } from '@/lib/formatters';

const DEFAULT_SCAN_PLATFORM = 'linux/amd64';

export default function DockerTagDetailPage() {
  const { repositoryId, tagName, connectionId: routeConnectionId } = useParams<{
    repositoryId: string;
    tagName: string;
    connectionId?: string;
  }>();
  const navigate = useNavigate();
  // Scanning is open to Maintainers as well as Admins; Readers get a 403.
  const canRequestScan = useCanCurate();
  const [scanPollDeadline, setScanPollDeadline] = useState(() => Date.now() + SCAN_POLL_TIMEOUT_MS);

  const { data: repo } = useDockerRepository(repositoryId!);
  const { data: tagsData, isLoading: tagsLoading } = useDockerTags(repositoryId!, { page: 1, pageSize: 100 });
  const { data: detail, isLoading: detailLoading, isError: detailError, refetch: refetchDetail } = useDockerImageDetail(repositoryId!, tagName!);
  const { data: connections } = useRegistryConnections();
  const syncMutation = useSyncRegistryConnection();

  const tag = tagsData?.items.find((t) => t.name === tagName);

  // Find the registry connection for this repo so we can trigger a sync
  const connectionId = repo?.registryConnectionId ?? routeConnectionId ?? connections?.find((c) =>
    c.registryType !== undefined
  )?.id;

  const connection = connections?.find((candidate) => candidate.id === connectionId);
  const agent = connection?.agent;
  const hasAgent = !!agent;
  const canScan = agent?.features.includes('scan') ?? false;

  const scanQuery = useTagScan(repositoryId, tagName, {
    enabled: canScan,
    pollDeadline: scanPollDeadline,
  });
  const scan = scanQuery.data;
  const startScan = useStartTagScan(repositoryId!);
  useScanCompletionEffects(repositoryId, scan);

  const scanPlatforms = useMemo(
    () => runnablePlatforms(detail?.platforms ?? []).map(formatPlatform),
    [detail?.platforms],
  );

  function handleScan(platform?: string) {
    setScanPollDeadline(Date.now() + SCAN_POLL_TIMEOUT_MS);
    startScan.mutate({ tagName: tagName!, request: platform ? { platform } : {} });
  }

  function handleSync() {
    if (!connectionId) return;
    syncMutation.mutate(connectionId, {
      onSuccess: () => refetchDetail(),
    });
  }

  if (tagsLoading || detailLoading) {
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
  const isScanActive = isJobActive(scan?.state) || isJobActive(vulns?.scanState);
  const findingsCount = scan?.vulnerabilities.length ?? 0;

  // A scan that just finished is newer than the summary stored on the tag, and
  // the tags list may not have been refetched yet — prefer the live result so
  // this card and the findings table below it cannot contradict each other.
  const liveSummary = scan?.state === 'succeeded' ? scan.summary : null;
  const scannedAt = liveSummary ? (scan?.finishedAt ?? scan?.queuedAt) : vulns?.lastScannedAt;
  const counts = liveSummary ?? vulns;
  const severityRows = counts
    ? [
        { label: 'Critical', value: counts.critical, token: 'critical' },
        { label: 'High', value: counts.high, token: 'high' },
        { label: 'Medium', value: counts.medium, token: 'medium' },
        { label: 'Low', value: counts.low, token: 'low' },
        { label: 'Unknown', value: counts.unknown ?? 0, token: 'unknown' },
      ]
    : [];
  // A multi-arch tag publishes one image per platform; show them all rather
  // than only the one whose config the sync happened to read.
  const platforms = runnablePlatforms(detail?.platforms ?? tag?.platforms ?? []);

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/docker/${repositoryId}`)} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to {repo?.name || 'Repository'}
      </Button>

      <div className="flex items-start justify-between gap-4">
        <PageHeader title={`${repo?.name || ''}:${tagName}`} description="Image tag details and layers" />
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncMutation.isPending}
          className="shrink-0 gap-1.5 mt-1"
        >
          <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'Syncing...' : 'Sync'}
        </Button>
      </div>

      {detailError && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Image details are not yet available — they will appear after the next registry sync. Use the Sync button above to fetch them now.
        </div>
      )}

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
              {
                label: platforms.length > 1 ? 'Platforms' : 'Architecture',
                value: platforms.length > 0
                  ? platforms.map(formatPlatform).join(', ')
                  : `${detail?.os || tag?.os || '-'}/${detail?.architecture || tag?.architecture || '-'}`,
              },
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
              <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
                <div className="flex-1 space-y-3">
                  {severityRows.map((item) => (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-medium tabular-nums">{item.value}</span>
                      </div>
                      {/* The bar is a sparkline beside the number, not a
                          measurement — the number carries the meaning. */}
                      <div
                        aria-hidden="true"
                        className={`h-2 rounded-full bg-[hsl(var(--severity-${item.token}))]/20`}
                      >
                        <div
                          className={`h-2 rounded-full bg-[hsl(var(--severity-${item.token}))] transition-all`}
                          style={{ width: `${Math.min(item.value * 5, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 sm:w-44 sm:shrink-0 sm:text-right" aria-live="polite">
                  {isScanActive ? (
                    <>
                      <p className="flex items-center gap-1.5 text-sm sm:justify-end">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> Scanning…
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Scans run one at a time; this can take a few minutes.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm" title={scannedAt ? formatDateTime(scannedAt) : undefined}>
                        {scannedAt ? `Scanned ${formatRelativeTimeOr(scannedAt)}` : 'Not scanned'}
                      </p>
                      {scan?.platform && (
                        <p className="text-xs text-muted-foreground">{scan.platform} · Trivy</p>
                      )}
                    </>
                  )}

                  {canScan && (
                    <div className="sm:flex sm:justify-end">
                      <GatedControl disabled={!canRequestScan} reason={SCAN_PERMISSION_REASON}>
                        {scanPlatforms.length > 1 ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="gap-1.5" disabled={!canRequestScan || isScanActive}>
                                <RefreshCw className="h-4 w-4" /> Rescan
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleScan()}>
                                {DEFAULT_SCAN_PLATFORM} (default)
                              </DropdownMenuItem>
                              {scanPlatforms
                                .filter((platform) => platform !== DEFAULT_SCAN_PLATFORM)
                                .map((platform) => (
                                  <DropdownMenuItem key={platform} onClick={() => handleScan(platform)}>
                                    {platform}
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled={!canRequestScan || isScanActive}
                            onClick={() => handleScan()}
                          >
                            <RefreshCw className="h-4 w-4" /> Rescan
                          </Button>
                        )}
                      </GatedControl>
                    </div>
                  )}
                </div>
              </div>
            ) : <p className="text-sm text-muted-foreground">No scan data available.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Findings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Findings
            {findingsCount > 0 && (
              <Badge variant="secondary" className="text-xs">{formatNumber(findingsCount)}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasAgent ? (
            <NoAgentInline
              connectionId={connectionId ?? ''}
              sentence="Vulnerability scanning needs a registry agent on this connection."
            />
          ) : !canScan ? (
            <FeatureUnavailable feature="scan" />
          ) : scanQuery.isLoading ? (
            <TableSkeleton rows={6} />
          ) : !scan ? (
            <EmptyState
              icon={<ShieldQuestion className="h-6 w-6 text-muted-foreground" />}
              title="This tag has not been scanned"
              description="Trivy checks the image's packages against known vulnerabilities. A scan takes a few minutes and runs on the agent host."
              action={
                <GatedControl disabled={!canRequestScan} reason={SCAN_PERMISSION_REASON}>
                  <Button disabled={!canRequestScan} onClick={() => handleScan()}>Scan now</Button>
                </GatedControl>
              }
            />
          ) : scan.state === 'queued' ? (
            <EmptyState
              icon={<Clock className="h-6 w-6 text-muted-foreground" />}
              title="Scan queued"
              description="Scans run one at a time. This one starts when the current scan finishes."
            />
          ) : scan.state === 'running' ? (
            <EmptyState
              icon={<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
              title="Scanning…"
              description={scan.startedAt ? `Started ${formatRelativeTimeOr(scan.startedAt)}.` : undefined}
            />
          ) : scan.state === 'failed' ? (
            <div className="space-y-2">
              <Notice
                tone="danger"
                title="Scan failed"
                action={
                  <GatedControl disabled={!canRequestScan} reason={SCAN_PERMISSION_REASON}>
                    <Button variant="outline" size="sm" disabled={!canRequestScan} onClick={() => handleScan()}>
                      Try again
                    </Button>
                  </GatedControl>
                }
              >
                <span className="font-mono text-xs">{scan.error ?? 'The agent did not report a reason.'}</span>
              </Notice>
              <p className="text-xs text-muted-foreground">
                If this was the first scan on this agent: Trivy downloads its vulnerability database
                on first use, which needs internet access from the agent host.
              </p>
            </div>
          ) : scan.vulnerabilities.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-6 w-6 text-[hsl(var(--severity-none))]" />}
              title="No known vulnerabilities"
              description={`Scanned ${formatRelativeTimeOr(scan.finishedAt ?? scan.queuedAt, 'recently')} against Trivy's database for ${scan.platform}.`}
            />
          ) : (
            <ScanFindingsTable
              findings={scan.vulnerabilities}
              caption={`Vulnerabilities found in ${repo?.name ?? 'this repository'}:${tagName}`}
            />
          )}
        </CardContent>
      </Card>

      {/* Platforms — one entry per architecture published under this tag */}
      {platforms.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4" /> Platforms
              <Badge variant="outline" className="text-[10px] font-mono">{platforms.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {platforms.map((platform) => (
              <div
                key={platform.digest || formatPlatform(platform)}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium font-mono">{formatPlatform(platform)}</div>
                  <code className="text-xs text-muted-foreground break-all">{platform.digest}</code>
                </div>
                <span className="text-xs font-medium shrink-0">{formatBytes(platform.sizeBytes)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
    </TooltipProvider>
  );
}
