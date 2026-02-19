import { RegistryType } from '../enums';

export interface IAnalyticsDataPoint {
  date: string;
  pulls: number;
  pushes: number;
}

export interface IRegistryAnalytics {
  registryType: RegistryType;
  dataPoints: IAnalyticsDataPoint[];
  totalPulls: number;
  totalPushes: number;
}

export interface ITopPackage {
  registryType: RegistryType;
  name: string;
  downloads: number;
  trend: number;
}

export interface IAnalyticsSummary {
  timeRangeLabel: string;
  registryAnalytics: IRegistryAnalytics[];
  topPackages: ITopPackage[];
}
