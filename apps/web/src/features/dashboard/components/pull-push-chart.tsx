import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatNumber } from '@/lib/formatters';
import { format, parseISO } from 'date-fns';

interface PullPushDataPoint {
  date: string;
  pulls: number;
  pushes: number;
}

interface PullPushChartProps {
  data: PullPushDataPoint[];
}

const chartConfig = {
  pulls: {
    label: 'Pulls',
    color: 'hsl(215, 80%, 55%)',
  },
  pushes: {
    label: 'Pushes',
    color: 'hsl(150, 60%, 45%)',
  },
} satisfies ChartConfig;

export default function PullPushChart({ data }: PullPushChartProps) {
  const formattedData = useMemo(
    () =>
      data.map((point) => ({
        ...point,
        label: format(parseISO(point.date), 'MMM d'),
      })),
    [data],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Pull / Push Trends</CardTitle>
        <p className="text-xs text-muted-foreground">Activity over the last 30 days</p>
      </CardHeader>
      <CardContent className="pt-0">
        <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
          <AreaChart data={formattedData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="pullsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-pulls)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-pulls)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="pushesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-pushes)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-pushes)" stopOpacity={0.02} />
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
              fill="url(#pullsGradient)"
            />
            <Area
              type="monotone"
              dataKey="pushes"
              stroke="var(--color-pushes)"
              strokeWidth={2}
              fill="url(#pushesGradient)"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
