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

export interface IApiClient {
  getDashboardStats(): Promise<ApiResponse<IDashboardStats>>;
  getRecentActivity(limit: number): Promise<ApiResponse<IActivityFeedItem[]>>;

  getDockerRepositories(params: PaginationParams & SortParams & { query?: string; registryConnectionId?: string }): Promise<ApiResponse<PaginatedResponse<IDockerRepository>>>;
  getDockerRepository(repositoryId: string): Promise<ApiResponse<IDockerRepository>>;
  getDockerTags(repositoryId: string, params: PaginationParams): Promise<ApiResponse<PaginatedResponse<IDockerTag>>>;
  getDockerImageDetail(repositoryId: string, tagName: string): Promise<ApiResponse<IDockerImageDetail>>;
  deleteDockerTag(repositoryId: string, tagName: string): Promise<ApiResponse<void>>;

  getNuGetPackages(params: PaginationParams & SortParams & PackageSearchFilter & { registryConnectionId?: string }): Promise<ApiResponse<PaginatedResponse<INuGetPackage>>>;
  getNuGetPackage(packageId: string): Promise<ApiResponse<INuGetPackage>>;
  getNuGetPackageVersions(packageId: string): Promise<ApiResponse<INuGetPackageVersion[]>>;

  getNpmPackages(params: PaginationParams & SortParams & PackageSearchFilter & { registryConnectionId?: string }): Promise<ApiResponse<PaginatedResponse<INpmPackage>>>;
  getNpmPackage(packageName: string): Promise<ApiResponse<INpmPackage>>;
  getNpmPackageVersions(packageName: string): Promise<ApiResponse<INpmPackageVersion[]>>;

  getUsers(params: PaginationParams & SortParams & { query?: string }): Promise<ApiResponse<PaginatedResponse<IUser>>>;
  getUser(userId: string): Promise<ApiResponse<IUser>>;

  getTeams(params: PaginationParams): Promise<ApiResponse<PaginatedResponse<ITeam>>>;
  getTeam(teamId: string): Promise<ApiResponse<ITeam>>;

  getAuditLogs(params: PaginationParams & SortParams & AuditLogFilter): Promise<ApiResponse<PaginatedResponse<IAuditLogEntry>>>;

  getAnalyticsSummary(filter: AnalyticsFilter): Promise<ApiResponse<IAnalyticsSummary>>;

  getGeneralSettings(): Promise<ApiResponse<IGeneralSettings>>;
  updateGeneralSettings(settings: Partial<IGeneralSettings>): Promise<ApiResponse<IGeneralSettings>>;
  getRegistryConnections(): Promise<ApiResponse<IRegistryConnection[]>>;
  getRetentionPolicies(): Promise<ApiResponse<IRetentionPolicy[]>>;
  getWebhooks(): Promise<ApiResponse<IWebhook[]>>;

  // Auth
  login(request: ILoginRequest): Promise<ApiResponse<ILoginResponse>>;
  logout(): Promise<ApiResponse<void>>;
  getCurrentUser(): Promise<ApiResponse<IAuthUser>>;

  // Credential management
  getRegistryCredentials(): Promise<ApiResponse<IRegistryCredential[]>>;
  createRegistryCredential(request: ICreateCredentialRequest): Promise<ApiResponse<IRegistryCredential>>;
  updateRegistryCredential(id: string, request: IUpdateCredentialRequest): Promise<ApiResponse<IRegistryCredential>>;
  deleteRegistryCredential(id: string): Promise<ApiResponse<void>>;

  // Bulk operations
  bulkDelete(request: IBulkDeleteRequest): Promise<ApiResponse<IBulkDeleteResult>>;
  cleanupVersions(request: ICleanupVersionsRequest): Promise<ApiResponse<IBulkDeleteResult>>;
}
