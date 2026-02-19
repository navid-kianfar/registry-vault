import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../mock/mock-api-client';
import { queryKeys } from './query-keys';
import type { PaginationParams, SortParams, PackageSearchFilter } from '@registryvault/shared';

export function useNpmPackages(params: PaginationParams & SortParams & PackageSearchFilter & { registryConnectionId?: string }) {
  return useQuery({
    queryKey: queryKeys.npm.packages(params),
    queryFn: () => apiClient.getNpmPackages(params),
    select: (response) => response.data,
  });
}

export function useNpmPackage(packageName: string) {
  return useQuery({
    queryKey: queryKeys.npm.package(packageName),
    queryFn: () => apiClient.getNpmPackage(packageName),
    select: (response) => response.data,
    enabled: !!packageName,
  });
}

export function useNpmPackageVersions(packageName: string) {
  return useQuery({
    queryKey: queryKeys.npm.versions(packageName),
    queryFn: () => apiClient.getNpmPackageVersions(packageName),
    select: (response) => response.data,
    enabled: !!packageName,
  });
}
