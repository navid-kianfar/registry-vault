import { RegistryType, AuditAction } from '../enums';

export type DateRangeFilter = {
  from?: string;
  to?: string;
};

export type AuditLogFilter = {
  actions?: AuditAction[];
  registryType?: RegistryType;
  actorUsername?: string;
  resourceName?: string;
  dateRange?: DateRangeFilter;
  success?: boolean;
};

export type AnalyticsFilter = {
  registryTypes?: RegistryType[];
  dateRange: DateRangeFilter;
  granularity: 'day' | 'week' | 'month';
};

export type PackageSearchFilter = {
  query?: string;
  registryType?: RegistryType;
  tags?: string[];
  isPrerelease?: boolean;
};
