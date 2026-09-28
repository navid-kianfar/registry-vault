import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../http-api-client';
import type {
  IBulkDeleteFailure,
  IBulkDeleteRequest,
  ICleanupVersionsRequest,
  IRegistryRepairRequest,
} from '@registry-vault/shared';
import { RegistryType } from '@registry-vault/shared';
import { toast } from 'sonner';

export interface BulkCleanupOptions {
  registryType: RegistryType;
  packageIdentifiers: string[];
  keepCount?: number;
  olderThanDate?: string;
}

/**
 * Report a cleanup the way the registry saw it: failures are errors, not a
 * "cleaned up 0" success. Deleting Docker tags only unlinks manifests; the
 * space comes back when the registry's garbage collector runs.
 */
export function reportCleanup(
  registryType: RegistryType,
  deleted: number,
  failures: IBulkDeleteFailure[],
  /**
   * Docker repositories the run left alone because it selects by pull activity
   * and their registry has no agent. Silence here would read as "nothing
   * matched" when the rule in fact never ran against them.
   */
  skippedRepositories?: string[],
): void {
  const skippedNote =
    skippedRepositories && skippedRepositories.length > 0
      ? `Skipped ${skippedRepositories.length} repositories with no registry agent — they have no pull history to judge by.`
      : undefined;

  if (failures.length > 0) {
    const reason = failures[0]?.reason ?? 'see logs';
    toast.error(
      deleted > 0
        ? `Deleted ${deleted}, failed ${failures.length} — ${reason}`
        : `Cleanup failed for ${failures.length} version(s) — ${reason}`,
      { description: skippedNote },
    );
    return;
  }

  if (deleted === 0) {
    toast.info('Nothing to clean up — no versions matched the rule', {
      description: skippedNote,
    });
    return;
  }

  const gcNote =
    registryType === RegistryType.Docker
      ? 'Disk space is freed when the registry runs garbage collection.'
      : undefined;

  toast.success(`Deleted ${deleted} old version(s) from the registry`, {
    description: [gcNote, skippedNote].filter(Boolean).join(' ') || undefined,
  });
}

export function useBulkDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: IBulkDeleteRequest) => apiClient.bulkDelete(request),
    onSuccess: (response, request) => {
      // Invalidate queries based on registry type
      const prefix = request.registryType === RegistryType.Docker ? 'docker'
        : request.registryType === RegistryType.NuGet ? 'nuget' : 'npm';
      queryClient.invalidateQueries({ queryKey: [prefix] });

      const { successCount, failureCount, failures } = response.data;

      // Report what the registry actually did. Claiming success while items
      // failed is what hid the half-deleted packages.
      if (failureCount > 0) {
        toast.error(
          successCount > 0
            ? `Deleted ${successCount}, failed ${failureCount} — ${failures[0]?.reason ?? 'see logs'}`
            : `Delete failed — ${failures[0]?.reason ?? 'see logs'}`,
        );
        return;
      }

      toast.success(`Deleted ${successCount} items successfully`);
    },
    onError: () => toast.error('Bulk delete failed'),
  });
}

/**
 * Scan a Docker registry for tags left dangling by a partial delete, and
 * optionally finish removing them. Defaults to a dry run on the API side.
 */
export function useRepairRegistry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: IRegistryRepairRequest) => apiClient.repairRegistry(request),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['docker'] });

      const { applied, danglingTags, repairedTags, failures } = response.data;

      if (danglingTags === 0) {
        toast.success('No half-deleted tags found');
        return;
      }

      if (!applied) {
        toast.warning(`Found ${danglingTags} half-deleted tag(s) — run repair to remove them`);
        return;
      }

      if (failures.length > 0) {
        toast.error(`Repaired ${repairedTags}, failed ${failures.length} — ${failures[0].reason}`);
        return;
      }

      toast.success(`Repaired ${repairedTags} tag(s)`);
    },
    onError: () => toast.error('Registry repair failed'),
  });
}

export function useCleanupVersions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ICleanupVersionsRequest) => apiClient.cleanupVersions(request),
    onSuccess: (response, request) => {
      const prefix = request.registryType === RegistryType.Docker ? 'docker'
        : request.registryType === RegistryType.NuGet ? 'nuget' : 'npm';
      queryClient.invalidateQueries({ queryKey: [prefix] });
      reportCleanup(request.registryType, response.data.successCount, response.data.failures);
    },
    onError: (error: Error) => toast.error(error.message || 'Cleanup failed'),
  });
}

/** Runs cleanupVersions for each selected package sequentially */
export function useBulkCleanup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (options: BulkCleanupOptions) => {
      let totalCleaned = 0;
      const failures: IBulkDeleteFailure[] = [];
      for (const packageIdentifier of options.packageIdentifiers) {
        const res = await apiClient.cleanupVersions({
          registryType: options.registryType,
          packageIdentifier,
          keepCount: options.keepCount,
          olderThanDate: options.olderThanDate,
        });
        totalCleaned += res.data.successCount;
        failures.push(...res.data.failures);
      }
      return { totalCleaned, failures };
    },
    onSuccess: ({ totalCleaned, failures }, options) => {
      const prefix = options.registryType === RegistryType.Docker ? 'docker'
        : options.registryType === RegistryType.NuGet ? 'nuget' : 'npm';
      queryClient.invalidateQueries({ queryKey: [prefix] });
      reportCleanup(options.registryType, totalCleaned, failures);
    },
    onError: () => toast.error('Bulk cleanup failed'),
  });
}
