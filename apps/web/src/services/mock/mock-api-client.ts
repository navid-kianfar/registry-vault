import type { IApiClient } from '../api-client';
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
  IRetentionPolicy,
  IWebhook,
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
} from '@registryvault/shared';
import { delay } from './delay';
import { dashboardStats, recentActivity } from './data/dashboard.mock';
import { dockerRepositories, dockerTags, dockerImageDetails } from './data/docker.mock';
import { nugetPackages, nugetVersions } from './data/nuget.mock';
import { npmPackages, npmVersions } from './data/npm.mock';
import { users } from './data/users.mock';
import { teams } from './data/teams.mock';
import { auditLogs } from './data/audit-logs.mock';
import { getAnalyticsSummary } from './data/analytics.mock';
import { generalSettings, registryConnections, retentionPolicies, webhooks } from './data/settings.mock';
import { mockAuthUsers, registryCredentials } from './data/auth.mock';

const DELAY_MS = 300;

let currentUser: (IAuthUser & { password: string }) | null = null;

function makeResponse<T>(data: T): ApiResponse<T> {
  return { data, success: true, timestamp: new Date().toISOString() };
}

function paginate<T>(items: T[], params: PaginationParams): PaginatedResponse<T> {
  const start = (params.page - 1) * params.pageSize;
  const paged = items.slice(start, start + params.pageSize);
  const totalPages = Math.ceil(items.length / params.pageSize);
  return {
    items: paged,
    totalCount: items.length,
    page: params.page,
    pageSize: params.pageSize,
    totalPages,
    hasNextPage: params.page < totalPages,
    hasPreviousPage: params.page > 1,
  };
}

function sortItems<T>(items: T[], sortBy: string, sortOrder: 'asc' | 'desc'): T[] {
  return [...items].sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[sortBy];
    const bVal = (b as Record<string, unknown>)[sortBy];
    const dir = sortOrder === 'asc' ? 1 : -1;
    if (typeof aVal === 'string') return aVal.localeCompare(bVal as string) * dir;
    return ((aVal as number) - (bVal as number)) * dir;
  });
}

export class MockApiClient implements IApiClient {
  async getDashboardStats() {
    await delay(DELAY_MS);
    return makeResponse(dashboardStats);
  }

  async getRecentActivity(limit: number) {
    await delay(DELAY_MS);
    return makeResponse(recentActivity.slice(0, limit));
  }

  async getDockerRepositories(params: PaginationParams & SortParams & { query?: string; registryConnectionId?: string }) {
    await delay(DELAY_MS);
    let filtered = [...dockerRepositories];
    if (params.registryConnectionId) {
      filtered = filtered.filter((r) => r.registryConnectionId === params.registryConnectionId);
    }
    if (params.query) {
      const q = params.query.toLowerCase();
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
    }
    filtered = sortItems(filtered, params.sortBy, params.sortOrder);
    return makeResponse(paginate(filtered, params));
  }

  async getDockerRepository(repositoryId: string) {
    await delay(DELAY_MS);
    const repo = dockerRepositories.find((r) => r.id === repositoryId);
    if (!repo) throw new Error('Repository not found');
    return makeResponse(repo);
  }

  async getDockerTags(repositoryId: string, params: PaginationParams) {
    await delay(DELAY_MS);
    const tags = dockerTags[repositoryId] || [];
    return makeResponse(paginate(tags, params));
  }

  async getDockerImageDetail(repositoryId: string, tagName: string) {
    await delay(DELAY_MS);
    const key = `${repositoryId}/${tagName}`;
    const detail = dockerImageDetails[key];
    if (!detail) {
      const repo = dockerRepositories.find((r) => r.id === repositoryId);
      const tags = dockerTags[repositoryId] || [];
      const tag = tags.find((t) => t.name === tagName);
      return makeResponse({
        repository: repo?.name || repositoryId,
        tag: tagName,
        digest: tag?.digest || 'sha256:unknown',
        architecture: tag?.architecture || 'amd64',
        os: tag?.os || 'linux',
        sizeBytes: tag?.sizeBytes || 0,
        layers: [],
        labels: {},
        createdAt: tag?.pushedAt || new Date().toISOString(),
      } as IDockerImageDetail);
    }
    return makeResponse(detail);
  }

  async deleteDockerTag(_repositoryId: string, _tagName: string) {
    await delay(DELAY_MS);
    return makeResponse(undefined as unknown as void);
  }

  async getNuGetPackages(params: PaginationParams & SortParams & PackageSearchFilter & { registryConnectionId?: string }) {
    await delay(DELAY_MS);
    let filtered = [...nugetPackages];
    if (params.registryConnectionId) {
      filtered = filtered.filter((p) => p.registryConnectionId === params.registryConnectionId);
    }
    if (params.query) {
      const q = params.query.toLowerCase();
      filtered = filtered.filter((p) => p.packageId.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    filtered = sortItems(filtered, params.sortBy, params.sortOrder);
    return makeResponse(paginate(filtered, params));
  }

  async getNuGetPackage(packageId: string) {
    await delay(DELAY_MS);
    const pkg = nugetPackages.find((p) => p.id === packageId);
    if (!pkg) throw new Error('Package not found');
    return makeResponse(pkg);
  }

  async getNuGetPackageVersions(packageId: string) {
    await delay(DELAY_MS);
    return makeResponse(nugetVersions[packageId] || []);
  }

  async getNpmPackages(params: PaginationParams & SortParams & PackageSearchFilter & { registryConnectionId?: string }) {
    await delay(DELAY_MS);
    let filtered = [...npmPackages];
    if (params.registryConnectionId) {
      filtered = filtered.filter((p) => p.registryConnectionId === params.registryConnectionId);
    }
    if (params.query) {
      const q = params.query.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    filtered = sortItems(filtered, params.sortBy, params.sortOrder);
    return makeResponse(paginate(filtered, params));
  }

  async getNpmPackage(packageName: string) {
    await delay(DELAY_MS);
    const pkg = npmPackages.find((p) => p.name === packageName);
    if (!pkg) throw new Error('Package not found');
    return makeResponse(pkg);
  }

  async getNpmPackageVersions(packageName: string) {
    await delay(DELAY_MS);
    const pkg = npmPackages.find((p) => p.name === packageName);
    return makeResponse(pkg ? (npmVersions[pkg.id] || []) : []);
  }

  async getUsers(params: PaginationParams & SortParams & { query?: string }) {
    await delay(DELAY_MS);
    let filtered = [...users];
    if (params.query) {
      const q = params.query.toLowerCase();
      filtered = filtered.filter(
        (u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      );
    }
    filtered = sortItems(filtered, params.sortBy, params.sortOrder);
    return makeResponse(paginate(filtered, params));
  }

  async getUser(userId: string) {
    await delay(DELAY_MS);
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    return makeResponse(user);
  }

  async getTeams(params: PaginationParams) {
    await delay(DELAY_MS);
    return makeResponse(paginate(teams, params));
  }

  async getTeam(teamId: string) {
    await delay(DELAY_MS);
    const team = teams.find((t) => t.id === teamId);
    if (!team) throw new Error('Team not found');
    return makeResponse(team);
  }

  async getAuditLogs(params: PaginationParams & SortParams & AuditLogFilter) {
    await delay(DELAY_MS);
    let filtered = [...auditLogs];
    if (params.registryType !== undefined) {
      filtered = filtered.filter((l) => l.registryType === params.registryType);
    }
    if (params.actorUsername) {
      const q = params.actorUsername.toLowerCase();
      filtered = filtered.filter((l) => l.actorUsername.toLowerCase().includes(q));
    }
    if (params.actions && params.actions.length > 0) {
      filtered = filtered.filter((l) => params.actions!.includes(l.action));
    }
    filtered = sortItems(filtered, params.sortBy || 'createdAt', params.sortOrder || 'desc');
    return makeResponse(paginate(filtered, params));
  }

  async getAnalyticsSummary(filter: AnalyticsFilter) {
    await delay(DELAY_MS);
    const days = filter.dateRange.from && filter.dateRange.to
      ? Math.ceil((new Date(filter.dateRange.to).getTime() - new Date(filter.dateRange.from).getTime()) / (1000 * 60 * 60 * 24))
      : 30;
    return makeResponse(getAnalyticsSummary(days));
  }

  async getGeneralSettings() {
    await delay(DELAY_MS);
    return makeResponse(generalSettings);
  }

  async updateGeneralSettings(settings: Partial<IGeneralSettings>) {
    await delay(DELAY_MS);
    Object.assign(generalSettings, settings);
    return makeResponse(generalSettings);
  }

  async getRegistryConnections() {
    await delay(DELAY_MS);
    return makeResponse(registryConnections);
  }

  async getRetentionPolicies() {
    await delay(DELAY_MS);
    return makeResponse(retentionPolicies);
  }

  async getWebhooks() {
    await delay(DELAY_MS);
    return makeResponse(webhooks);
  }

  async login(request: ILoginRequest): Promise<ApiResponse<ILoginResponse>> {
    await delay(DELAY_MS);
    const user = mockAuthUsers.find(
      (u) => u.username === request.username && u.password === request.password,
    );
    if (!user) throw new Error('Invalid username or password');
    currentUser = user;
    const { password: _, ...authUser } = user;
    return makeResponse({
      user: authUser,
      token: `mock-jwt-token-${user.id}-${Date.now()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  async logout(): Promise<ApiResponse<void>> {
    await delay(DELAY_MS);
    currentUser = null;
    return makeResponse(undefined as unknown as void);
  }

  async getCurrentUser(): Promise<ApiResponse<IAuthUser>> {
    await delay(DELAY_MS);
    if (!currentUser) throw new Error('Not authenticated');
    const { password: _, ...authUser } = currentUser;
    return makeResponse(authUser);
  }

  async getRegistryCredentials(): Promise<ApiResponse<IRegistryCredential[]>> {
    await delay(DELAY_MS);
    return makeResponse(registryCredentials);
  }

  async createRegistryCredential(request: ICreateCredentialRequest): Promise<ApiResponse<IRegistryCredential>> {
    await delay(DELAY_MS);
    const connection = registryConnections.find((c) => c.id === request.registryConnectionId);
    const newCredential: IRegistryCredential = {
      id: `cred-${Date.now()}`,
      registryConnectionId: request.registryConnectionId,
      registryName: connection?.name || 'Unknown Registry',
      username: request.username,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    registryCredentials.push(newCredential);
    return makeResponse(newCredential);
  }

  async updateRegistryCredential(id: string, request: IUpdateCredentialRequest): Promise<ApiResponse<IRegistryCredential>> {
    await delay(DELAY_MS);
    const index = registryCredentials.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('Credential not found');
    const updated = {
      ...registryCredentials[index],
      ...request,
      password: undefined,
      updatedAt: new Date().toISOString(),
    };
    registryCredentials[index] = updated;
    return makeResponse(updated);
  }

  async deleteRegistryCredential(id: string): Promise<ApiResponse<void>> {
    await delay(DELAY_MS);
    const index = registryCredentials.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('Credential not found');
    registryCredentials.splice(index, 1);
    return makeResponse(undefined as unknown as void);
  }

  async bulkDelete(request: IBulkDeleteRequest): Promise<ApiResponse<IBulkDeleteResult>> {
    await delay(DELAY_MS * 2);
    const total = request.items.length;
    const result: IBulkDeleteResult = {
      totalRequested: total,
      successCount: total,
      failureCount: 0,
      failures: [],
    };
    return makeResponse(result);
  }

  async cleanupVersions(request: ICleanupVersionsRequest): Promise<ApiResponse<IBulkDeleteResult>> {
    await delay(DELAY_MS * 2);
    // Simulate cleanup: pretend we found some versions to delete
    const simulatedCount = request.keepCount ? Math.max(0, 8 - request.keepCount) : 3;
    const result: IBulkDeleteResult = {
      totalRequested: simulatedCount,
      successCount: simulatedCount,
      failureCount: 0,
      failures: [],
    };
    return makeResponse(result);
  }
}

export const apiClient: IApiClient = new MockApiClient();
