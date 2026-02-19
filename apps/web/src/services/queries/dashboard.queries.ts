import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';

export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.dashboard.stats,
    queryFn: () => apiClient.getDashboardStats(),
    select: (response) => response.data,
  });
}

export function useRecentActivity(limit = 15) {
  return useQuery({
    queryKey: queryKeys.dashboard.activity(limit),
    queryFn: () => apiClient.getRecentActivity(limit),
    select: (response) => response.data,
  });
}
