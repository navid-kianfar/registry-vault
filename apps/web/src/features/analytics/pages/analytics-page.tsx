import { useState, useMemo } from 'react';
import { subDays, format } from 'date-fns';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { useAnalyticsSummary } from '@/services/queries/analytics.queries';
import { formatNumber, formatDate } from '@/lib/formatters';
import {
  RegistryType,
  REGISTRY_LABELS,
  REGISTRY_COLORS,
} from '@registryvault/shared';
import type { AnalyticsFilter, ITopPackage } from '@registryvault/shared';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Crown,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Activity,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIME_RANGES = [
  { label: '7d', days: 7, granularity: 'day' as const },
  { label: '30d', days: 30, granularity: 'day' as const },
  { label: '90d', days: 90, granularity: 'week' as const },
  { label: '1y', days: 365, granularity: 'month' as const },
];

const pullChartConfig = {
  docker: {
    label: REGISTRY_LABELS[RegistryType.Docker],
    color: REGISTRY_COLORS[RegistryType.Docker],
  },
  nuget: {
    label: REGISTRY_LABELS[RegistryType.NuGet],
    color: REGISTRY_COLORS[RegistryType.NuGet],
  },
  npm: {
    label: REGISTRY_LABELS[RegistryType.NPM],
    color: REGISTRY_COLORS[RegistryType.NPM],
  },
} satisfies ChartConfig;

const pushChartConfig = {
  docker: {
    label: REGISTRY_LABELS[RegistryType.Docker],
    color: REGISTRY_COLORS[RegistryType.Docker],
  },
  nuget: {
    label: REGISTRY_LABELS[RegistryType.NuGet],
    color: REGISTRY_COLORS[RegistryType.NuGet],
  },
  npm: {
    label: REGISTRY_LABELS[RegistryType.NPM],
    color: REGISTRY_COLORS[RegistryType.NPM],
  },
} satisfies ChartConfig;

const REGISTRY_KEY_MAP: Record<RegistryType, string> = {
  [RegistryType.Docker]: 'docker',
  [RegistryType.NuGet]: 'nuget',
  [RegistryType.NPM]: 'npm',
};

// ---------------------------------------------------------------------------
// Top package row
// ---------------------------------------------------------------------------

function TopPackageRow({ rank, pkg }: { rank: number; pkg: ITopPackage }) {
  const isPositive = pkg.trend >= 0;

  return (
    <div className="flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50">
      {/* Rank */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
        {rank}
      </div>

      {/* Package info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{pkg.name}</span>
          <RegistryBadge type={pkg.registryType} className="scale-90 origin-left" />
        </div>
      </div>

      {/* Downloads */}
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums">{formatNumber(pkg.downloads)}</p>
        <div className="flex items-center justify-end gap-0.5">
          {isPositive ? (
            <TrendingUp className="h-3 w-3 text-emerald-500" />
          ) : (
            <TrendingDown className="h-3 w-3 text-red-500" />
          )}
          <span
            className={`text-[11px] font-medium ${
              isPositive ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            {isPositive ? '+' : ''}
            {pkg.trend.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-14" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [selectedRange, setSelectedRange] = useState(1); // default 30d

  const filter = useMemo<AnalyticsFilter>(() => {
    const range = TIME_RANGES[selectedRange];
    const now = new Date();
    return {
      dateRange: {
        from: format(subDays(now, range.days), 'yyyy-MM-dd'),
        to: format(now, 'yyyy-MM-dd'),
      },
      granularity: range.granularity,
    };
  }, [selectedRange]);

  const { data: summary, isLoading } = useAnalyticsSummary(filter);

  // Build chart data: merge data points from all registries by date
  const pullChartData = useMemo(() => {
    if (!summary) return [];
    const dateMap: Record<string, { date: string; label: string; docker: number; nuget: number; npm: number }> = {};

    for (const reg of summary.registryAnalytics) {
      const key = REGISTRY_KEY_MAP[reg.registryType] as 'docker' | 'nuget' | 'npm';
      for (const dp of reg.dataPoints) {
        if (!dateMap[dp.date]) {
          dateMap[dp.date] = {
            date: dp.date,
            label: formatDate(dp.date),
            docker: 0,
            nuget: 0,
            npm: 0,
          };
        }
        dateMap[dp.date][key] = dp.pulls;
      }
    }

    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [summary]);

  const pushChartData = useMemo(() => {
    if (!summary) return [];
    const dateMap: Record<string, { date: string; label: string; docker: number; nuget: number; npm: number }> = {};

    for (const reg of summary.registryAnalytics) {
      const key = REGISTRY_KEY_MAP[reg.registryType] as 'docker' | 'nuget' | 'npm';
      for (const dp of reg.dataPoints) {
        if (!dateMap[dp.date]) {
          dateMap[dp.date] = {
            date: dp.date,
            label: formatDate(dp.date),
            docker: 0,
            nuget: 0,
            npm: 0,
          };
        }
        dateMap[dp.date][key] = dp.pushes;
      }
    }

    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [summary]);

  // Compute summary stats
  const totalPulls = useMemo(
    () => summary?.registryAnalytics.reduce((sum, r) => sum + r.totalPulls, 0) ?? 0,
    [summary],
  );

  const totalPushes = useMemo(
    () => summary?.registryAnalytics.reduce((sum, r) => sum + r.totalPushes, 0) ?? 0,
    [summary],
  );

  const topRegistry = useMemo(() => {
    if (!summary || summary.registryAnalytics.length === 0) return null;
    return summary.registryAnalytics.reduce((top, r) =>
      r.totalPulls + r.totalPushes > top.totalPulls + top.totalPushes ? r : top,
    );
  }, [summary]);

  if (isLoading) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Pull/push trends and download statistics across registries"
      />

      {/* ----- Time range selector ----- */}
      <div className="flex items-center gap-1.5">
        {TIME_RANGES.map((range, idx) => (
          <Button
            key={range.label}
            variant={idx === selectedRange ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedRange(idx)}
          >
            {range.label}
          </Button>
        ))}
      </div>

      {/* ----- Summary stat cards ----- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Pulls"
          value={formatNumber(totalPulls)}
          icon={<ArrowDownToLine className="h-4 w-4" />}
        />
        <StatCard
          label="Total Pushes"
          value={formatNumber(totalPushes)}
          icon={<ArrowUpFromLine className="h-4 w-4" />}
        />
        <StatCard
          label="Top Registry"
          value={topRegistry ? REGISTRY_LABELS[topRegistry.registryType] : '--'}
          icon={<Crown className="h-4 w-4" />}
        />
      </div>

      {/* ----- Charts row ----- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Area chart: Pull trends */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Pull Trends
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Downloads over the last {TIME_RANGES[selectedRange].label}
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <ChartContainer config={pullChartConfig} className="aspect-[2/1] w-full">
              <AreaChart data={pullChartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="pullDockerGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={REGISTRY_COLORS[RegistryType.Docker]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={REGISTRY_COLORS[RegistryType.Docker]} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="pullNugetGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={REGISTRY_COLORS[RegistryType.NuGet]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={REGISTRY_COLORS[RegistryType.NuGet]} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="pullNpmGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={REGISTRY_COLORS[RegistryType.NPM]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={REGISTRY_COLORS[RegistryType.NPM]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval="preserveStartEnd"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  tickFormatter={(value: number) => formatNumber(value)}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="docker"
                  stroke={REGISTRY_COLORS[RegistryType.Docker]}
                  strokeWidth={2}
                  fill="url(#pullDockerGradient)"
                  stackId="pulls"
                />
                <Area
                  type="monotone"
                  dataKey="nuget"
                  stroke={REGISTRY_COLORS[RegistryType.NuGet]}
                  strokeWidth={2}
                  fill="url(#pullNugetGradient)"
                  stackId="pulls"
                />
                <Area
                  type="monotone"
                  dataKey="npm"
                  stroke={REGISTRY_COLORS[RegistryType.NPM]}
                  strokeWidth={2}
                  fill="url(#pullNpmGradient)"
                  stackId="pulls"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Bar chart: Push comparison */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Push Comparison
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Uploads over the last {TIME_RANGES[selectedRange].label}
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <ChartContainer config={pushChartConfig} className="aspect-[2/1] w-full">
              <BarChart data={pushChartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval="preserveStartEnd"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  tickFormatter={(value: number) => formatNumber(value)}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="docker"
                  fill={REGISTRY_COLORS[RegistryType.Docker]}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="nuget"
                  fill={REGISTRY_COLORS[RegistryType.NuGet]}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="npm"
                  fill={REGISTRY_COLORS[RegistryType.NPM]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* ----- Top packages ----- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Crown className="h-4 w-4 text-muted-foreground" />
            Top Packages
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Most downloaded packages across all registries
          </p>
        </CardHeader>
        <CardContent>
          {summary && summary.topPackages.length > 0 ? (
            <div className="space-y-2">
              {summary.topPackages.map((pkg, idx) => (
                <TopPackageRow key={`${pkg.registryType}-${pkg.name}`} rank={idx + 1} pkg={pkg} />
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No package data available for the selected time range.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
