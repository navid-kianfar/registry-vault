import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';
import type { IGeneralSettings } from '@registryvault/shared';
import { toast } from 'sonner';

export function useGeneralSettings() {
  return useQuery({
    queryKey: queryKeys.settings.general,
    queryFn: () => apiClient.getGeneralSettings(),
    select: (response) => response.data,
  });
}

export function useUpdateGeneralSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Partial<IGeneralSettings>) => apiClient.updateGeneralSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.general });
      toast.success('Settings updated successfully');
    },
    onError: () => {
      toast.error('Failed to update settings');
    },
  });
}

export function useRegistryConnections() {
  return useQuery({
    queryKey: queryKeys.settings.registries,
    queryFn: () => apiClient.getRegistryConnections(),
    select: (response) => response.data,
  });
}

export function useRetentionPolicies() {
  return useQuery({
    queryKey: queryKeys.settings.retention,
    queryFn: () => apiClient.getRetentionPolicies(),
    select: (response) => response.data,
  });
}

export function useWebhooks() {
  return useQuery({
    queryKey: queryKeys.settings.webhooks,
    queryFn: () => apiClient.getWebhooks(),
    select: (response) => response.data,
  });
}
