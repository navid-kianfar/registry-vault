import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../http-api-client';
import { queryKeys } from './query-keys';
import type {
  IGeneralSettings,
  ICreateRegistryConnectionRequest,
  IUpdateRegistryConnectionRequest,
  ICreateRetentionPolicyRequest,
  IUpdateRetentionPolicyRequest,
  ICreateWebhookRequest,
  IUpdateWebhookRequest,
} from '@registry-vault/shared';
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

export function useCreateRegistryConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ICreateRegistryConnectionRequest) => apiClient.createRegistryConnection(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.registries });
      toast.success('Registry connection added');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add registry connection');
    },
  });
}

export function useUpdateRegistryConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: IUpdateRegistryConnectionRequest }) =>
      apiClient.updateRegistryConnection(id, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.registries });
      toast.success('Registry connection updated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update registry connection');
    },
  });
}

export function useDeleteRegistryConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteRegistryConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.registries });
      toast.success('Registry connection deleted');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete registry connection');
    },
  });
}

function invalidateAllDataCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: queryKeys.settings.registries });
  queryClient.invalidateQueries({ queryKey: ['docker'] });
  queryClient.invalidateQueries({ queryKey: ['nuget'] });
  queryClient.invalidateQueries({ queryKey: ['npm'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['analytics'] });
}

export function useSyncRegistryConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.syncRegistryConnection(id),
    onSuccess: () => {
      invalidateAllDataCaches(queryClient);
      toast.success('Registry synced successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Sync failed');
    },
  });
}

export function useSyncAllRegistries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.syncAllRegistries(),
    onSuccess: () => {
      invalidateAllDataCaches(queryClient);
      toast.success('All registries synced');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Sync failed');
    },
  });
}

export function useRetentionPolicies() {
  return useQuery({
    queryKey: queryKeys.settings.retention,
    queryFn: () => apiClient.getRetentionPolicies(),
    select: (response) => response.data,
  });
}

export function useCreateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ICreateRetentionPolicyRequest) => apiClient.createRetentionPolicy(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.retention });
      toast.success('Retention policy created');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to create policy'),
  });
}

export function useUpdateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: IUpdateRetentionPolicyRequest }) =>
      apiClient.updateRetentionPolicy(id, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.retention });
      toast.success('Retention policy updated');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to update policy'),
  });
}

export function useDeleteRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteRetentionPolicy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.retention });
      toast.success('Retention policy deleted');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to delete policy'),
  });
}

export function useRunRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.runRetentionPolicy(id),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['docker'] });
      queryClient.invalidateQueries({ queryKey: ['nuget'] });
      queryClient.invalidateQueries({ queryKey: ['npm'] });
      toast.success(`Cleanup complete — ${response.data.deleted} item(s) deleted`);
    },
    onError: (error: Error) => toast.error(error.message || 'Cleanup failed'),
  });
}

export function useWebhooks() {
  return useQuery({
    queryKey: queryKeys.settings.webhooks,
    queryFn: () => apiClient.getWebhooks(),
    select: (response) => response.data,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ICreateWebhookRequest) => apiClient.createWebhook(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.webhooks });
      toast.success('Webhook created');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to create webhook'),
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: IUpdateWebhookRequest }) =>
      apiClient.updateWebhook(id, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.webhooks });
      toast.success('Webhook updated');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to update webhook'),
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteWebhook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.webhooks });
      toast.success('Webhook deleted');
    },
    onError: (error: Error) => toast.error(error.message || 'Failed to delete webhook'),
  });
}
