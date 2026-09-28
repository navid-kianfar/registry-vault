import type { AgentLogSource } from '@registry-vault/shared';

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
    pulls: (repoId: string, days: number) => ['docker', 'pulls', repoId, days] as const,
    scan: (repoId: string, tag: string) => ['docker', 'scan', repoId, tag] as const,
  },
  agent: {
    /** Everything under ['agent', connectionId] is invalidated by Refresh. */
    connection: (id: string) => ['agent', id] as const,
    health: (id: string) => ['agent', id, 'health'] as const,
    storage: (id: string, refresh: boolean) => ['agent', id, 'storage', refresh] as const,
    gc: (id: string) => ['agent', id, 'gc'] as const,
    gcHistory: (id: string) => ['agent', id, 'gc', 'history'] as const,
    uploads: (id: string, hours: number) => ['agent', id, 'uploads', hours] as const,
    maintenance: (id: string) => ['agent', id, 'maintenance'] as const,
    logs: (id: string, source: AgentLogSource, lines: number) =>
      ['agent', id, 'logs', source, lines] as const,
    users: (id: string) => ['agent', id, 'users'] as const,
    settings: (id: string) => ['agent', id, 'settings'] as const,
    overview: ['agent', 'overview'] as const,
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
