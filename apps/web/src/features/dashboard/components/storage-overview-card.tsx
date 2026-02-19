import { useMemo } from 'react';
import { Cell, Label, Pie, PieChart } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatBytes } from '@/lib/formatters';
import { RegistryType, REGISTRY_LABELS, REGISTRY_COLORS } from '@registryvault/shared';
import type { IStorageStat } from '@registryvault/shared';

interface StorageOverviewCardProps {
  storageStats: IStorageStat[];
}

const chartConfig = {
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

export default function StorageOverviewCard({ storageStats }: StorageOverviewCardProps) {
  const totalUsed = useMemo(
    () => storageStats.reduce((sum, s) => sum + s.usedBytes, 0),
    [storageStats],
  );

  const chartData = useMemo(
    () =>
      storageStats.map((stat) => ({
        name: REGISTRY_LABELS[stat.registryType],
        key: REGISTRY_KEY_MAP[stat.registryType],
        value: stat.usedBytes,
        fill: REGISTRY_COLORS[stat.registryType],
      })),
    [storageStats],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Storage Distribution</CardTitle>
        <p className="text-xs text-muted-foreground">Used storage across registries</p>
      </CardHeader>
      <CardContent className="pt-0">
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[260px]">
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value, name) => (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{name}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {formatBytes(value as number)}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={70}
              outerRadius={100}
              strokeWidth={2}
              stroke="hsl(var(--background))"
              paddingAngle={2}
            >
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={entry.fill} />
              ))}
              <Label
                content={({ viewBox }) => {
                  if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) - 8}
                          className="fill-foreground text-xl font-bold"
                        >
                          {formatBytes(totalUsed)}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) + 12}
                          className="fill-muted-foreground text-xs"
                        >
                          Total Used
                        </tspan>
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>

        <div className="mt-2 flex items-center justify-center gap-4">
          {storageStats.map((stat) => (
            <div key={stat.registryType} className="flex items-center gap-1.5 text-xs">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: REGISTRY_COLORS[stat.registryType] }}
              />
              <span className="text-muted-foreground">{REGISTRY_LABELS[stat.registryType]}</span>
              <span className="font-medium">{formatBytes(stat.usedBytes)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
