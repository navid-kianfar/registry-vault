import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';
import type { PaginationParams, SortParams, AuditLogFilter } from '@registryvault/shared';

export function useAuditLogs(params: PaginationParams & SortParams & AuditLogFilter) {
  return useQuery({
    queryKey: queryKeys.auditLogs(params),
    queryFn: () => apiClient.getAuditLogs(params),
    select: (response) => response.data,
  });
}
