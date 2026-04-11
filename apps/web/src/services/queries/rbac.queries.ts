import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../http-api-client';
import { queryKeys } from './query-keys';
import type { PaginationParams, SortParams, ICreateUserRequest, IUpdateUserRequest, IChangePasswordRequest } from '@registry-vault/shared';
import { toast } from 'sonner';

export function useUsers(params: PaginationParams & SortParams & { query?: string }) {
  return useQuery({
    queryKey: queryKeys.rbac.users(params),
    queryFn: () => apiClient.getUsers(params),
    select: (response) => response.data,
  });
}

export function useUser(userId: string) {
  return useQuery({
    queryKey: queryKeys.rbac.user(userId),
    queryFn: () => apiClient.getUser(userId),
    select: (response) => response.data,
    enabled: !!userId,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ICreateUserRequest) => apiClient.createUser(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rbac.users({}) });
      toast.success('User created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create user');
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: IUpdateUserRequest }) =>
      apiClient.updateUser(id, request),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rbac.user(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.rbac.users({}) });
      toast.success('User updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update user');
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rbac.users({}) });
      toast.success('User deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete user');
    },
  });
}

export function useChangeUserPassword() {
  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: IChangePasswordRequest }) =>
      apiClient.changeUserPassword(id, request),
    onSuccess: () => {
      toast.success('Password changed successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to change password');
    },
  });
}

export function useTeams(params: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.rbac.teams(params),
    queryFn: () => apiClient.getTeams(params),
    select: (response) => response.data,
  });
}

export function useTeam(teamId: string) {
  return useQuery({
    queryKey: queryKeys.rbac.team(teamId),
    queryFn: () => apiClient.getTeam(teamId),
    select: (response) => response.data,
    enabled: !!teamId,
  });
}
