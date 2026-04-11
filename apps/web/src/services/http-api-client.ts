import type { IApiClient } from './api-client';
import type {
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
  SortParams,
  IDashboardStats,
  IActivityFeedItem,
  IDockerRepository,
  IDockerTag,
  IDockerImageDetail,
  INuGetPackage,
  INuGetPackageVersion,
  INpmPackage,
  INpmPackageVersion,
  IUser,
  ITeam,
  IAuditLogEntry,
  IAnalyticsSummary,
  IGeneralSettings,
  IRegistryConnection,
  ICreateRegistryConnectionRequest,
  IUpdateRegistryConnectionRequest,
  IRetentionPolicy,
  ICreateRetentionPolicyRequest,
  IUpdateRetentionPolicyRequest,
  IWebhook,
  ICreateWebhookRequest,
  IUpdateWebhookRequest,
  AuditLogFilter,
  AnalyticsFilter,
  PackageSearchFilter,
  IAuthUser,
  ILoginRequest,
  ILoginResponse,
  IRegistryCredential,
  ICreateCredentialRequest,
  IUpdateCredentialRequest,
  IBulkDeleteRequest,
  IBulkDeleteResult,
  ICleanupVersionsRequest,
  ICreateUserRequest,
  IUpdateUserRequest,
  IChangePasswordRequest,
} from '@registry-vault/shared';

const API_BASE = '/api';
const AUTH_TOKEN_KEY = 'registry-vault-auth-token';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;

  const headers: Record<string, string> = {};

  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const method = options?.method?.toUpperCase();
  if (method === 'POST' || method === 'PATCH') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string>),
    },
  });

  if (response.status === 401) {
    // Don't redirect if this IS the login request — let the form handle the error
    if (!path.endsWith('/auth/login')) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        searchParams.set(key, value.join(','));
      }
    } else if (typeof value === 'object') {
      // Flatten nested objects (e.g., dateRange.from -> from, dateRange.to -> to)
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (nestedValue !== undefined && nestedValue !== null) {
          searchParams.set(nestedKey, String(nestedValue));
        }
      }
    } else {
      searchParams.set(key, String(value));
    }
  }

  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

class HttpApiClient implements IApiClient {
  // Dashboard
  async getDashboardStats(): Promise<ApiResponse<IDashboardStats>> {
    return apiFetch('/dashboard/stats');
  }

  async getRecentActivity(limit: number): Promise<ApiResponse<IActivityFeedItem[]>> {
    return apiFetch(`/dashboard/activity${buildQueryString({ limit })}`);
  }

  // Docker
  async getDockerRepositories(
    params: PaginationParams & SortParams & { query?: string; registryConnectionId?: string },
  ): Promise<ApiResponse<PaginatedResponse<IDockerRepository>>> {
    return apiFetch(`/docker/repositories${buildQueryString(params)}`);
  }

  async getDockerRepository(repositoryId: string): Promise<ApiResponse<IDockerRepository>> {
    return apiFetch(`/docker/repositories/${encodeURIComponent(repositoryId)}`);
  }

  async getDockerTags(
    repositoryId: string,
    params: PaginationParams,
  ): Promise<ApiResponse<PaginatedResponse<IDockerTag>>> {
    return apiFetch(
      `/docker/repositories/${encodeURIComponent(repositoryId)}/tags${buildQueryString(params)}`,
    );
  }

  async getDockerImageDetail(
    repositoryId: string,
    tagName: string,
  ): Promise<ApiResponse<IDockerImageDetail>> {
    return apiFetch(
      `/docker/repositories/${encodeURIComponent(repositoryId)}/tags/${encodeURIComponent(tagName)}`,
    );
  }

  async deleteDockerTag(repositoryId: string, tagName: string): Promise<ApiResponse<void>> {
    return apiFetch(
      `/docker/repositories/${encodeURIComponent(repositoryId)}/tags/${encodeURIComponent(tagName)}`,
      { method: 'DELETE' },
    );
  }

  // NuGet
  async getNuGetPackages(
    params: PaginationParams & SortParams & PackageSearchFilter & { registryConnectionId?: string },
  ): Promise<ApiResponse<PaginatedResponse<INuGetPackage>>> {
    return apiFetch(`/nuget/packages${buildQueryString(params)}`);
  }

  async getNuGetPackage(packageId: string): Promise<ApiResponse<INuGetPackage>> {
    return apiFetch(`/nuget/packages/${encodeURIComponent(packageId)}`);
  }

  async getNuGetPackageVersions(packageId: string): Promise<ApiResponse<INuGetPackageVersion[]>> {
    return apiFetch(`/nuget/packages/${encodeURIComponent(packageId)}/versions`);
  }

  // npm
  async getNpmPackages(
    params: PaginationParams & SortParams & PackageSearchFilter & { registryConnectionId?: string },
  ): Promise<ApiResponse<PaginatedResponse<INpmPackage>>> {
    return apiFetch(`/npm/packages${buildQueryString(params)}`);
  }

  async getNpmPackage(packageName: string): Promise<ApiResponse<INpmPackage>> {
    return apiFetch(`/npm/packages/${encodeURIComponent(packageName)}`);
  }

  async getNpmPackageVersions(packageName: string): Promise<ApiResponse<INpmPackageVersion[]>> {
    return apiFetch(`/npm/packages/${encodeURIComponent(packageName)}/versions`);
  }

  // Users / RBAC
  async getUsers(
    params: PaginationParams & SortParams & { query?: string },
  ): Promise<ApiResponse<PaginatedResponse<IUser>>> {
    return apiFetch(`/users${buildQueryString(params)}`);
  }

  async getUser(userId: string): Promise<ApiResponse<IUser>> {
    return apiFetch(`/users/${encodeURIComponent(userId)}`);
  }

  async createUser(request: ICreateUserRequest): Promise<ApiResponse<IUser>> {
    return apiFetch('/users', { method: 'POST', body: JSON.stringify(request) });
  }

  async updateUser(id: string, request: IUpdateUserRequest): Promise<ApiResponse<IUser>> {
    return apiFetch(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(request) });
  }

  async deleteUser(id: string): Promise<ApiResponse<void>> {
    return apiFetch(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async changeUserPassword(id: string, request: IChangePasswordRequest): Promise<ApiResponse<void>> {
    return apiFetch(`/users/${encodeURIComponent(id)}/password`, { method: 'PATCH', body: JSON.stringify(request) });
  }

  async getTeams(params: PaginationParams): Promise<ApiResponse<PaginatedResponse<ITeam>>> {
    return apiFetch(`/teams${buildQueryString(params)}`);
  }

  async getTeam(teamId: string): Promise<ApiResponse<ITeam>> {
    return apiFetch(`/teams/${encodeURIComponent(teamId)}`);
  }

  // Audit logs
  async getAuditLogs(
    params: PaginationParams & SortParams & AuditLogFilter,
  ): Promise<ApiResponse<PaginatedResponse<IAuditLogEntry>>> {
    const { dateRange, ...rest } = params;
    const flatParams: Record<string, unknown> = { ...rest };
    if (dateRange) {
      if (dateRange.from) flatParams['from'] = dateRange.from;
      if (dateRange.to) flatParams['to'] = dateRange.to;
    }
    return apiFetch(`/audit-logs${buildQueryString(flatParams)}`);
  }

  // Analytics
  async getAnalyticsSummary(filter: AnalyticsFilter): Promise<ApiResponse<IAnalyticsSummary>> {
    const { dateRange, ...rest } = filter;
    const flatParams: Record<string, unknown> = { ...rest };
    if (dateRange) {
      if (dateRange.from) flatParams['from'] = dateRange.from;
      if (dateRange.to) flatParams['to'] = dateRange.to;
    }
    return apiFetch(`/analytics/summary${buildQueryString(flatParams)}`);
  }

  // Settings
  async getGeneralSettings(): Promise<ApiResponse<IGeneralSettings>> {
    return apiFetch('/settings/general');
  }

  async updateGeneralSettings(
    settings: Partial<IGeneralSettings>,
  ): Promise<ApiResponse<IGeneralSettings>> {
    return apiFetch('/settings/general', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  }

  async getRegistryConnections(): Promise<ApiResponse<IRegistryConnection[]>> {
    return apiFetch('/settings/registries');
  }

  async createRegistryConnection(request: ICreateRegistryConnectionRequest): Promise<ApiResponse<IRegistryConnection>> {
    return apiFetch('/settings/registries', { method: 'POST', body: JSON.stringify(request) });
  }

  async updateRegistryConnection(id: string, request: IUpdateRegistryConnectionRequest): Promise<ApiResponse<IRegistryConnection>> {
    return apiFetch(`/settings/registries/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(request) });
  }

  async deleteRegistryConnection(id: string): Promise<ApiResponse<void>> {
    return apiFetch(`/settings/registries/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async syncRegistryConnection(id: string): Promise<ApiResponse<{ synced: boolean }>> {
    return apiFetch(`/settings/registries/${encodeURIComponent(id)}/sync`, { method: 'POST' });
  }

  async syncAllRegistries(): Promise<ApiResponse<{ synced: boolean }>> {
    return apiFetch('/settings/sync', { method: 'POST' });
  }

  async getRetentionPolicies(): Promise<ApiResponse<IRetentionPolicy[]>> {
    return apiFetch('/settings/retention');
  }

  async createRetentionPolicy(request: ICreateRetentionPolicyRequest): Promise<ApiResponse<IRetentionPolicy>> {
    return apiFetch('/settings/retention', { method: 'POST', body: JSON.stringify(request) });
  }

  async updateRetentionPolicy(id: string, request: IUpdateRetentionPolicyRequest): Promise<ApiResponse<IRetentionPolicy>> {
    return apiFetch(`/settings/retention/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(request) });
  }

  async deleteRetentionPolicy(id: string): Promise<ApiResponse<void>> {
    return apiFetch(`/settings/retention/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async runRetentionPolicy(id: string): Promise<ApiResponse<{ deleted: number }>> {
    return apiFetch(`/settings/retention/${encodeURIComponent(id)}/run`, { method: 'POST' });
  }

  async getWebhooks(): Promise<ApiResponse<IWebhook[]>> {
    return apiFetch('/settings/webhooks');
  }

  async createWebhook(request: ICreateWebhookRequest): Promise<ApiResponse<IWebhook>> {
    return apiFetch('/settings/webhooks', { method: 'POST', body: JSON.stringify(request) });
  }

  async updateWebhook(id: string, request: IUpdateWebhookRequest): Promise<ApiResponse<IWebhook>> {
    return apiFetch(`/settings/webhooks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(request) });
  }

  async deleteWebhook(id: string): Promise<ApiResponse<void>> {
    return apiFetch(`/settings/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Auth
  async login(request: ILoginRequest): Promise<ApiResponse<ILoginResponse>> {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async logout(): Promise<ApiResponse<void>> {
    return apiFetch('/auth/logout', {
      method: 'POST',
    });
  }

  async getCurrentUser(): Promise<ApiResponse<IAuthUser>> {
    return apiFetch('/auth/me');
  }

  // Credential management
  async getRegistryCredentials(): Promise<ApiResponse<IRegistryCredential[]>> {
    return apiFetch('/credentials');
  }

  async createRegistryCredential(
    request: ICreateCredentialRequest,
  ): Promise<ApiResponse<IRegistryCredential>> {
    return apiFetch('/credentials', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async updateRegistryCredential(
    id: string,
    request: IUpdateCredentialRequest,
  ): Promise<ApiResponse<IRegistryCredential>> {
    return apiFetch(`/credentials/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  }

  async deleteRegistryCredential(id: string): Promise<ApiResponse<void>> {
    return apiFetch(`/credentials/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // Bulk operations
  async bulkDelete(request: IBulkDeleteRequest): Promise<ApiResponse<IBulkDeleteResult>> {
    return apiFetch('/bulk/delete', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async cleanupVersions(
    request: ICleanupVersionsRequest,
  ): Promise<ApiResponse<IBulkDeleteResult>> {
    return apiFetch('/bulk/cleanup', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }
}

export const apiClient: IApiClient = new HttpApiClient();
