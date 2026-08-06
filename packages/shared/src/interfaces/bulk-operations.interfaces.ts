import { RegistryType } from '../enums';

export interface IBulkDeleteRequest {
  registryType: RegistryType;
  items: IBulkDeleteItem[];
  /**
   * Docker tags that must survive. A registry delete removes every tag sharing
   * the target digest, so a delete that would also take one of these is
   * refused instead of silently removing it.
   */
  protectTags?: string[];
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

export interface IRegistryRepairRequest {
  registryConnectionId: string;
  /** Limit the scan to these repositories; omit to scan the whole registry. */
  repositories?: string[];
  /** Nothing is deleted unless this is true — the default is a dry run. */
  apply?: boolean;
}

export interface IRegistryRepairResult {
  /** False when this was a dry run and nothing was deleted. */
  applied: boolean;
  scannedRepositories: number;
  danglingTags: number;
  repairedTags: number;
  repositories: IRegistryRepairRepository[];
  failures: IRegistryRepairFailure[];
}

export interface IRegistryRepairRepository {
  repository: string;
  danglingTags: Array<{
    tag: string;
    digest: string | null;
    /** Content the registry no longer holds, e.g. a missing amd64 manifest. */
    missing: string[];
  }>;
  /** Tags removed by the repair, including any that shared a digest. */
  repairedTags: string[];
}

export interface IRegistryRepairFailure {
  repository: string;
  tag: string;
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
