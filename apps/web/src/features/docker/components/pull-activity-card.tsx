import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { format, parseISO } from 'date-fns';
import { Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Notice } from '@/components/shared/notice';
import { FeatureUnavailable, NoAgentInline } from '@/features/registry/components/agent-states';
import { formatNumber, formatRelativeTimeOr } from '@/lib/formatters';
import { useDockerPullStats } from '@/services/queries/agent.queries';

const RANGE_OPTIONS = [7, 30, 90] as const;
const DEFAULT_RANGE_DAYS = 30;

// The product token keeps every Docker page in one colour family.
const chartConfig = {
  pulls: { label: 'Pulls', color: 'hsl(var(--docker))' },
} satisfies ChartConfig;

interface PullActivityCardProps {
  repositoryId: string;
  /** Undefined when the repository's connection is unknown. */
  connectionId?: string;
  hasAgent: boolean;
  hasEventsFeature: boolean;
}

export function PullActivityCard({
  repositoryId,
  connectionId,
  hasAgent,
  hasEventsFeature,
}: PullActivityCardProps) {
  const [days, setDays] = useState<number>(DEFAULT_RANGE_DAYS);
  const canQuery = hasAgent && hasEventsFeature;
  const { data: stats, isLoading } = useDockerPullStats(repositoryId, days, canQuery);

  const chartData = useMemo(
    () =>
      (stats?.daily ?? []).map((point) => ({
        ...point,
        label: format(parseISO(point.date), 'MMM d'),
      })),
    [stats?.daily],
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Download className="h-4 w-4" /> Pull activity
          </CardTitle>
          {canQuery && (
            <p className="text-xs text-muted-foreground">
              {stats?.lastPulledAt
                ? `Last pulled ${formatRelativeTimeOr(stats.lastPulledAt)}`
                : 'Never pulled'}
            </p>
          )}
        </div>
        {canQuery && (
          <Tabs value={String(days)} onValueChange={(value) => setDays(Number(value))}>
            <TabsList>
              {RANGE_OPTIONS.map((option) => (
                <TabsTrigger key={option} value={String(option)}>
                  {option} days
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasAgent ? (
          <NoAgentInline
            connectionId={connectionId ?? ''}
            sentence="Pull counts need a registry agent on this connection."
          />
        ) : !hasEventsFeature ? (
          <FeatureUnavailable feature="events" />
        ) : isLoading ? (
          <Skeleton className="aspect-[3/2] w-full sm:aspect-[3/1]" />
        ) : !stats ? (
          <p className="text-sm text-muted-foreground">No pull data.</p>
        ) : (
          <>
            {stats.incomplete && (
              <Notice tone="info" title="Some history is missing">
                The agent prunes its event log (30 days by default), so days before that show fewer
                pulls than actually happened.
              </Notice>
            )}

            <ChartContainer config={chartConfig} className="aspect-[3/2] w-full sm:aspect-[3/1]">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="repoPullsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-pulls)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-pulls)" stopOpacity={0.02} />
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
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        if (payload?.[0]?.payload?.date) {
                          return format(parseISO(payload[0].payload.date), 'EEEE, MMM d');
                        }
                        return '';
                      }}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="pulls"
                  stroke="var(--color-pulls)"
                  strokeWidth={2}
                  fill="url(#repoPullsGradient)"
                />
              </AreaChart>
            </ChartContainer>

            <p className="text-sm">
              {formatNumber(stats.totalPulls)} pulls in the last {days} days
            </p>
            {stats.totalPulls === 0 && (
              <p className="text-sm text-muted-foreground">No pulls recorded in this period.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
