import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../http-api-client';
import { queryKeys } from './query-keys';
import type { PaginationParams, SortParams } from '@registry-vault/shared';

const FIVE_MINUTES = 5 * 60 * 1000;

export function useDockerRepositories(params: PaginationParams & SortParams & { query?: string; registryConnectionId?: string }) {
  return useQuery({
    queryKey: queryKeys.docker.repositories(params),
    queryFn: () => apiClient.getDockerRepositories(params),
    select: (response) => response.data,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });
}

export function useDockerRepository(repositoryId: string) {
  return useQuery({
    queryKey: queryKeys.docker.repository(repositoryId),
    queryFn: () => apiClient.getDockerRepository(repositoryId),
    select: (response) => response.data,
    enabled: !!repositoryId,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });
}

const SCANNING_POLL_MS = 10 * 1000;
const ACTIVE_SCAN_STATES = new Set(['queued', 'running']);

export function useDockerTags(repositoryId: string, params: PaginationParams) {
  return useQuery({
    queryKey: queryKeys.docker.tags(repositoryId, params),
    queryFn: () => apiClient.getDockerTags(repositoryId, params),
    select: (response) => response.data,
    enabled: !!repositoryId,
    staleTime: FIVE_MINUTES,
    // A queued scan changes a badge on this list, so follow it closely while
    // one is outstanding and fall back to the slow interval afterwards.
    refetchInterval: (query) => {
      const items = query.state.data?.data?.items ?? [];
      const isScanning = items.some((tag) => {
        const state = tag.vulnerabilitySummary.scanState;
        return !!state && ACTIVE_SCAN_STATES.has(state);
      });
      return isScanning ? SCANNING_POLL_MS : FIVE_MINUTES;
    },
  });
}

export function useDockerImageDetail(repositoryId: string, tagName: string) {
  return useQuery({
    queryKey: queryKeys.docker.imageDetail(repositoryId, tagName),
    queryFn: () => apiClient.getDockerImageDetail(repositoryId, tagName),
    select: (response) => response.data,
    enabled: !!repositoryId && !!tagName,
    // Don't retry on 404 — image detail may not exist yet (needs a sync)
    retry: false,
    staleTime: FIVE_MINUTES,
  });
}
