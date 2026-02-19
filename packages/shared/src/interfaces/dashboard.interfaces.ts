import { RegistryType, HealthStatus } from '../enums';

export interface IStorageStat {
  registryType: RegistryType;
  usedBytes: number;
  totalBytes: number;
  itemCount: number;
}

export interface IRegistryHealth {
  registryType: RegistryType;
  status: HealthStatus;
  url: string;
  lastCheckedAt: string;
  responseTimeMs: number;
  errorMessage?: string;
}

export interface IDashboardStats {
  totalRepositories: number;
  totalPackages: number;
  totalImageTags: number;
  totalPullsToday: number;
  totalPushesToday: number;
  totalUsers: number;
  storageStats: IStorageStat[];
  registryHealth: IRegistryHealth[];
}

export interface IActivityFeedItem {
  id: string;
  action: string;
  actorName: string;
  actorAvatarUrl?: string;
  registryType: RegistryType;
  resourceName: string;
  timestamp: string;
}
