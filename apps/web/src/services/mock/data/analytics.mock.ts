import type { IAnalyticsSummary, IRegistryAnalytics, ITopPackage } from '@registryvault/shared';
import { RegistryType } from '@registryvault/shared';
import { format, subDays } from 'date-fns';

function generateDataPoints(days: number, basepulls: number, basePushes: number) {
  const dataPoints = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
    const dayOfWeek = subDays(new Date(), i).getDay();
    const weekendMultiplier = dayOfWeek === 0 || dayOfWeek === 6 ? 0.3 : 1;
    const randomVariance = 0.7 + Math.random() * 0.6;

    dataPoints.push({
      date,
      pulls: Math.round(basepulls * weekendMultiplier * randomVariance),
      pushes: Math.round(basePushes * weekendMultiplier * randomVariance),
    });
  }
  return dataPoints;
}

const topPackages: ITopPackage[] = [
  { registryType: RegistryType.Docker, name: 'myorg/api-gateway', downloads: 18420, trend: 12.4 },
  { registryType: RegistryType.Docker, name: 'library/nginx', downloads: 15230, trend: 3.2 },
  { registryType: RegistryType.NuGet, name: 'MyOrg.Core', downloads: 8940, trend: 8.7 },
  { registryType: RegistryType.NPM, name: '@myorg/ui-components', downloads: 7650, trend: 22.1 },
  { registryType: RegistryType.Docker, name: 'myorg/auth-service', downloads: 6820, trend: -2.3 },
  { registryType: RegistryType.NuGet, name: 'MyOrg.Data', downloads: 5470, trend: 5.1 },
  { registryType: RegistryType.NPM, name: '@myorg/hooks', downloads: 4980, trend: 15.6 },
  { registryType: RegistryType.Docker, name: 'myorg/frontend', downloads: 4310, trend: -1.8 },
  { registryType: RegistryType.NPM, name: '@myorg/api-client', downloads: 3820, trend: 9.4 },
  { registryType: RegistryType.NuGet, name: 'MyOrg.Messaging', downloads: 2950, trend: 4.6 },
];

export function getAnalyticsSummary(days: number): IAnalyticsSummary {
  const dockerData = generateDataPoints(days, 950, 35);
  const nugetData = generateDataPoints(days, 280, 12);
  const npmData = generateDataPoints(days, 350, 18);

  const dockerAnalytics: IRegistryAnalytics = {
    registryType: RegistryType.Docker,
    dataPoints: dockerData,
    totalPulls: dockerData.reduce((sum, d) => sum + d.pulls, 0),
    totalPushes: dockerData.reduce((sum, d) => sum + d.pushes, 0),
  };

  const nugetAnalytics: IRegistryAnalytics = {
    registryType: RegistryType.NuGet,
    dataPoints: nugetData,
    totalPulls: nugetData.reduce((sum, d) => sum + d.pulls, 0),
    totalPushes: nugetData.reduce((sum, d) => sum + d.pushes, 0),
  };

  const npmAnalytics: IRegistryAnalytics = {
    registryType: RegistryType.NPM,
    dataPoints: npmData,
    totalPulls: npmData.reduce((sum, d) => sum + d.pulls, 0),
    totalPushes: npmData.reduce((sum, d) => sum + d.pushes, 0),
  };

  const label =
    days <= 7 ? 'Last 7 days' : days <= 30 ? 'Last 30 days' : days <= 90 ? 'Last 90 days' : 'Last year';

  return {
    timeRangeLabel: label,
    registryAnalytics: [dockerAnalytics, nugetAnalytics, npmAnalytics],
    topPackages,
  };
}
