export const queryKeys = {
  dashboard: {
    stats: ['dashboard', 'stats'] as const,
    activity: (limit: number) => ['dashboard', 'activity', limit] as const,
  },
  docker: {
    repositories: (params: Record<string, unknown>) => ['docker', 'repositories', params] as const,
    repository: (id: string) => ['docker', 'repository', id] as const,
    tags: (repoId: string, params: Record<string, unknown>) => ['docker', 'tags', repoId, params] as const,
    imageDetail: (repoId: string, tag: string) => ['docker', 'imageDetail', repoId, tag] as const,
  },
  nuget: {
    packages: (params: Record<string, unknown>) => ['nuget', 'packages', params] as const,
    package: (id: string) => ['nuget', 'package', id] as const,
    versions: (id: string) => ['nuget', 'versions', id] as const,
  },
  npm: {
    packages: (params: Record<string, unknown>) => ['npm', 'packages', params] as const,
    package: (name: string) => ['npm', 'package', name] as const,
    versions: (name: string) => ['npm', 'versions', name] as const,
  },
  rbac: {
    users: (params: Record<string, unknown>) => ['rbac', 'users', params] as const,
    user: (id: string) => ['rbac', 'user', id] as const,
    teams: (params: Record<string, unknown>) => ['rbac', 'teams', params] as const,
    team: (id: string) => ['rbac', 'team', id] as const,
  },
  auditLogs: (params: Record<string, unknown>) => ['auditLogs', params] as const,
  analytics: (filter: Record<string, unknown>) => ['analytics', filter] as const,
  settings: {
    general: ['settings', 'general'] as const,
    registries: ['settings', 'registries'] as const,
    retention: ['settings', 'retention'] as const,
    webhooks: ['settings', 'webhooks'] as const,
    credentials: ['settings', 'credentials'] as const,
  },
} as const;
