import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../http-api-client';
import type {
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
      toast.success(`Cleaned up ${response.data.successCount} old versions`);
    },
    onError: () => toast.error('Cleanup failed'),
  });
}

/** Runs cleanupVersions for each selected package sequentially */
export function useBulkCleanup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (options: BulkCleanupOptions) => {
      let totalCleaned = 0;
      for (const packageIdentifier of options.packageIdentifiers) {
        const res = await apiClient.cleanupVersions({
          registryType: options.registryType,
          packageIdentifier,
          keepCount: options.keepCount,
          olderThanDate: options.olderThanDate,
        });
        totalCleaned += res.data.successCount;
      }
      return totalCleaned;
    },
    onSuccess: (totalCleaned, options) => {
      const prefix = options.registryType === RegistryType.Docker ? 'docker'
        : options.registryType === RegistryType.NuGet ? 'nuget' : 'npm';
      queryClient.invalidateQueries({ queryKey: [prefix] });
      toast.success(`Cleaned up ${totalCleaned} old versions across ${options.packageIdentifiers.length} packages`);
    },
    onError: () => toast.error('Bulk cleanup failed'),
  });
}
