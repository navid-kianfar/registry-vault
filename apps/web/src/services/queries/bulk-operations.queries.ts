import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../http-api-client';
import type { IBulkDeleteRequest, ICleanupVersionsRequest } from '@registry-vault/shared';
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
      toast.success(`Deleted ${response.data.successCount} items successfully`);
    },
    onError: () => toast.error('Bulk delete failed'),
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
