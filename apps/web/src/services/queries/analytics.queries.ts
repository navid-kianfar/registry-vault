import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';
import type { AnalyticsFilter } from '@registryvault/shared';

export function useAnalyticsSummary(filter: AnalyticsFilter) {
  return useQuery({
    queryKey: queryKeys.analytics(filter),
    queryFn: () => apiClient.getAnalyticsSummary(filter),
    select: (response) => response.data,
  });
}
