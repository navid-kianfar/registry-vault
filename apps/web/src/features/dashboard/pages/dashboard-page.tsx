import { useDashboardStats, useRecentActivity } from '@/services/queries/dashboard.queries';
import { formatBytes, formatNumber, formatRelativeTime } from '@/lib/formatters';
import { StatCard } from '@/components/shared/stat-card';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { HealthStatusIndicator } from '@/components/shared/health-status-indicator';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { REGISTRY_LABELS } from '@registryvault/shared';
import PullPushChart from '../components/pull-push-chart';
import { getAnalyticsSummary } from '@/services/mock/data/analytics.mock';
import {
  Container,
  Package,
  Tags,
  ArrowDownToLine,
  ArrowUpFromLine,
  Users,
  Activity,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useMemo } from 'react';

const CHART_COLORS = ['hsl(207, 90%, 54%)', 'hsl(270, 52%, 50%)', 'hsl(1, 63%, 51%)'];

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: activity, isLoading: activityLoading } = useRecentActivity(12);

  const chartData = useMemo(() => {
    const summary = getAnalyticsSummary(30);
    const combined: Record<string, { date: string; pulls: number; pushes: number }> = {};
    for (const reg of summary.registryAnalytics) {
      for (const dp of reg.dataPoints) {
        if (!combined[dp.date]) combined[dp.date] = { date: dp.date, pulls: 0, pushes: 0 };
        combined[dp.date].pulls += dp.pulls;
        combined[dp.date].pushes += dp.pushes;
      }
    }
    return Object.values(combined).sort((a, b) => a.date.localeCompare(b.date));
  }, []);

  const storageData = useMemo(() => {
    if (!stats) return [];
    return stats.storageStats.map((s) => ({
      name: REGISTRY_LABELS[s.registryType],
      value: s.usedBytes,
    }));
  }, [stats]);

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Overview of all registries and activity" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Repositories" value={stats.totalRepositories} icon={<Container className="h-4 w-4" />} trend={5.2} trendLabel="vs last week" />
        <StatCard label="Packages" value={stats.totalPackages} icon={<Package className="h-4 w-4" />} trend={3.1} trendLabel="vs last week" />
        <StatCard label="Image Tags" value={stats.totalImageTags} icon={<Tags className="h-4 w-4" />} trend={8.4} trendLabel="vs last week" />
        <StatCard label="Pulls Today" value={formatNumber(stats.totalPullsToday)} icon={<ArrowDownToLine className="h-4 w-4" />} trend={12.3} trendLabel="vs yesterday" />
        <StatCard label="Pushes Today" value={stats.totalPushesToday} icon={<ArrowUpFromLine className="h-4 w-4" />} trend={-2.1} trendLabel="vs yesterday" />
        <StatCard label="Active Users" value={stats.totalUsers} icon={<Users className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PullPushChart data={chartData} />
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Storage Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie data={storageData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4} dataKey="value" strokeWidth={0}>
                    {storageData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 space-y-2">
              {stats.storageStats.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i] }} />
                    <span className="text-muted-foreground">{REGISTRY_LABELS[s.registryType]}</span>
                  </div>
                  <span className="font-medium">{formatBytes(s.usedBytes)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" /> Registry Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.registryHealth.map((h) => (
              <div key={h.registryType} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <RegistryBadge type={h.registryType} />
                  <span className="text-xs text-muted-foreground font-mono hidden sm:inline">{h.url}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground">{h.responseTimeMs}ms</span>
                  <HealthStatusIndicator status={h.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[280px] px-4 pb-4">
              <div className="space-y-1">
                {activityLoading
                  ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)
                  : activity?.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/50 transition-colors">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback className="text-xs bg-muted">{item.actorName.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{item.actorName}</span>
                            <span className="text-xs text-muted-foreground">{item.action}</span>
                          </div>
                          <span className="text-xs font-mono text-muted-foreground truncate block">{item.resourceName}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <RegistryBadge type={item.registryType} className="scale-75 origin-right" />
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatRelativeTime(item.timestamp)}</span>
                        </div>
                      </div>
                    ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
