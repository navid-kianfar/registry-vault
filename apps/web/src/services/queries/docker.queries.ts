import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';
import type { PaginationParams, SortParams } from '@registryvault/shared';

export function useDockerRepositories(params: PaginationParams & SortParams & { query?: string; registryConnectionId?: string }) {
  return useQuery({
    queryKey: queryKeys.docker.repositories(params),
    queryFn: () => apiClient.getDockerRepositories(params),
    select: (response) => response.data,
  });
}

export function useDockerRepository(repositoryId: string) {
  return useQuery({
    queryKey: queryKeys.docker.repository(repositoryId),
    queryFn: () => apiClient.getDockerRepository(repositoryId),
    select: (response) => response.data,
    enabled: !!repositoryId,
  });
}

export function useDockerTags(repositoryId: string, params: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.docker.tags(repositoryId, params),
    queryFn: () => apiClient.getDockerTags(repositoryId, params),
    select: (response) => response.data,
    enabled: !!repositoryId,
  });
}

export function useDockerImageDetail(repositoryId: string, tagName: string) {
  return useQuery({
    queryKey: queryKeys.docker.imageDetail(repositoryId, tagName),
    queryFn: () => apiClient.getDockerImageDetail(repositoryId, tagName),
    select: (response) => response.data,
    enabled: !!repositoryId && !!tagName,
  });
}
