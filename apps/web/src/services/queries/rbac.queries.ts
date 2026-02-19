import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';
import type { PaginationParams, SortParams } from '@registryvault/shared';

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
