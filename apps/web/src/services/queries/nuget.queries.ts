import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';
import type { PaginationParams, SortParams, PackageSearchFilter } from '@registryvault/shared';

export function useNuGetPackages(params: PaginationParams & SortParams & PackageSearchFilter & { registryConnectionId?: string }) {
  return useQuery({
    queryKey: queryKeys.nuget.packages(params),
    queryFn: () => apiClient.getNuGetPackages(params),
    select: (response) => response.data,
  });
}

export function useNuGetPackage(packageId: string) {
  return useQuery({
    queryKey: queryKeys.nuget.package(packageId),
    queryFn: () => apiClient.getNuGetPackage(packageId),
    select: (response) => response.data,
    enabled: !!packageId,
  });
}

export function useNuGetPackageVersions(packageId: string) {
  return useQuery({
    queryKey: queryKeys.nuget.versions(packageId),
    queryFn: () => apiClient.getNuGetPackageVersions(packageId),
    select: (response) => response.data,
    enabled: !!packageId,
  });
}
