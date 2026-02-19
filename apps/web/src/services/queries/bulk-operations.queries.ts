import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import type { IBulkDeleteRequest, ICleanupVersionsRequest } from '@registryvault/shared';
import { RegistryType } from '@registryvault/shared';
import { toast } from 'sonner';

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
