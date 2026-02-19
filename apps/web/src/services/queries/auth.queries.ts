import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';
import type { ICreateCredentialRequest, IUpdateCredentialRequest } from '@registryvault/shared';
import { toast } from 'sonner';

export function useRegistryCredentials() {
  return useQuery({
    queryKey: queryKeys.settings.credentials,
    queryFn: () => apiClient.getRegistryCredentials(),
    select: (response) => response.data,
  });
}

export function useCreateCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ICreateCredentialRequest) => apiClient.createRegistryCredential(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.credentials });
      toast.success('Credential created successfully');
    },
    onError: () => {
      toast.error('Failed to create credential');
    },
  });
}

export function useUpdateCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: IUpdateCredentialRequest }) =>
      apiClient.updateRegistryCredential(id, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.credentials });
      toast.success('Credential updated successfully');
    },
    onError: () => {
      toast.error('Failed to update credential');
    },
  });
}

export function useDeleteCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteRegistryCredential(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.credentials });
      toast.success('Credential deleted successfully');
    },
    onError: () => {
      toast.error('Failed to delete credential');
    },
  });
}
