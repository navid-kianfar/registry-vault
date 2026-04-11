import { RegistryType } from '../enums';

export interface IBulkDeleteRequest {
  registryType: RegistryType;
  items: IBulkDeleteItem[];
}

export interface IBulkDeleteItem {
  /** For Docker: repositoryId. For NuGet: packageId. For NPM: packageName */
  packageIdentifier: string;
  /** For Docker: tag name. For NuGet/NPM: version string. If omitted, delete entire package */
  versionIdentifier?: string;
}

export interface IBulkDeleteResult {
  totalRequested: number;
  successCount: number;
  failureCount: number;
  failures: IBulkDeleteFailure[];
}

export interface IBulkDeleteFailure {
  packageIdentifier: string;
  versionIdentifier?: string;
  reason: string;
}

export interface ICleanupVersionsRequest {
  registryType: RegistryType;
  packageIdentifier: string;
  /** Keep the most recent N versions, delete the rest */
  keepCount?: number;
  /** Delete versions published before this date (ISO string) */
  olderThanDate?: string;
}
