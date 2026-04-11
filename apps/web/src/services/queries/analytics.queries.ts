import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../http-api-client';
import { queryKeys } from './query-keys';
import type { AnalyticsFilter } from '@registry-vault/shared';

export function useAnalyticsSummary(filter: AnalyticsFilter) {
  return useQuery({
    queryKey: queryKeys.analytics(filter),
    queryFn: () => apiClient.getAnalyticsSummary(filter),
    select: (response) => response.data,
  });
}
