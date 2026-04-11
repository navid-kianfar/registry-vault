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
  createUser(request: ICreateUserRequest): Promise<ApiResponse<IUser>>;
  updateUser(id: string, request: IUpdateUserRequest): Promise<ApiResponse<IUser>>;
  deleteUser(id: string): Promise<ApiResponse<void>>;
  changeUserPassword(id: string, request: IChangePasswordRequest): Promise<ApiResponse<void>>;

  getTeams(params: PaginationParams): Promise<ApiResponse<PaginatedResponse<ITeam>>>;
  getTeam(teamId: string): Promise<ApiResponse<ITeam>>;

  getAuditLogs(params: PaginationParams & SortParams & AuditLogFilter): Promise<ApiResponse<PaginatedResponse<IAuditLogEntry>>>;

  getAnalyticsSummary(filter: AnalyticsFilter): Promise<ApiResponse<IAnalyticsSummary>>;

  getGeneralSettings(): Promise<ApiResponse<IGeneralSettings>>;
  updateGeneralSettings(settings: Partial<IGeneralSettings>): Promise<ApiResponse<IGeneralSettings>>;
  getRegistryConnections(): Promise<ApiResponse<IRegistryConnection[]>>;
  createRegistryConnection(request: ICreateRegistryConnectionRequest): Promise<ApiResponse<IRegistryConnection>>;
  updateRegistryConnection(id: string, request: IUpdateRegistryConnectionRequest): Promise<ApiResponse<IRegistryConnection>>;
  deleteRegistryConnection(id: string): Promise<ApiResponse<void>>;
  syncRegistryConnection(id: string): Promise<ApiResponse<{ synced: boolean }>>;
  syncAllRegistries(): Promise<ApiResponse<{ synced: boolean }>>;
  getRetentionPolicies(): Promise<ApiResponse<IRetentionPolicy[]>>;
  createRetentionPolicy(request: ICreateRetentionPolicyRequest): Promise<ApiResponse<IRetentionPolicy>>;
  updateRetentionPolicy(id: string, request: IUpdateRetentionPolicyRequest): Promise<ApiResponse<IRetentionPolicy>>;
  deleteRetentionPolicy(id: string): Promise<ApiResponse<void>>;
  runRetentionPolicy(id: string): Promise<ApiResponse<{ deleted: number }>>;
  getWebhooks(): Promise<ApiResponse<IWebhook[]>>;
  createWebhook(request: ICreateWebhookRequest): Promise<ApiResponse<IWebhook>>;
  updateWebhook(id: string, request: IUpdateWebhookRequest): Promise<ApiResponse<IWebhook>>;
  deleteWebhook(id: string): Promise<ApiResponse<void>>;

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
