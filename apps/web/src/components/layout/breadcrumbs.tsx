import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { Fragment } from 'react';
import { useRegistryConnections } from '@/services/queries/settings.queries';
import { useUser } from '@/services/queries/rbac.queries';
import { useDockerRepository } from '@/services/queries/docker.queries';
import { useNuGetPackage } from '@/services/queries/nuget.queries';

const staticLabels: Record<string, string> = {
  registry: 'Registries',
  docker: 'Docker',
  nuget: 'NuGet',
  npm: 'NPM',
  access: 'Access Control',
  users: 'Users',
  roles: 'Roles',
  'audit-logs': 'Audit Logs',
  analytics: 'Analytics',
  settings: 'Settings',
  general: 'General',
  registries: 'Registries',
  storage: 'Storage',
  retention: 'Retention',
  webhooks: 'Webhooks',
  tags: 'Tags',
  versions: 'Versions',
};

// Segments that are never navigable — rendered as plain text
const alwaysNonNavigable = new Set(['access', 'registry', 'tags', 'versions']);
// Registry-type segments are only navigable at the top level (e.g. /docker), not inside /registry/:id/docker/...
const registryTypeSegments = new Set(['docker', 'nuget', 'npm']);


export function Breadcrumbs() {
  const location = useLocation();
  const { data: connections } = useRegistryConnections();

  const segments = location.pathname.split('/').filter(Boolean);

  // Extract entity IDs from URL for reactive queries
  const usersIdx = segments.indexOf('users');
  const dockerIdx = segments.indexOf('docker');
  const nugetIdx = segments.indexOf('nuget');

  const userId = usersIdx >= 0 ? (segments[usersIdx + 1] ?? '') : '';
  const dockerRepoId = dockerIdx >= 0 ? (segments[dockerIdx + 1] ?? '') : '';
  const nugetPackageId = nugetIdx >= 0 ? (segments[nugetIdx + 1] ?? '') : '';

  const { data: fetchedUser } = useUser(userId);
  const { data: fetchedDockerRepo } = useDockerRepository(dockerRepoId);
  const { data: fetchedNugetPackage } = useNuGetPackage(nugetPackageId);

  if (location.pathname === '/') return null;

  function resolveLabel(segment: string, index: number): string {
    if (staticLabels[segment]) return staticLabels[segment];

    const prev = segments[index - 1];

    if (prev === 'registry') {
      const conn = connections?.find((c) => c.id === segment);
      if (conn) return conn.name;
    }

    if (prev === 'users' && segment === userId && fetchedUser) {
      return fetchedUser.displayName;
    }

    if (prev === 'docker' && segment === dockerRepoId && fetchedDockerRepo) {
      return fetchedDockerRepo.name;
    }

    if (prev === 'nuget' && segment === nugetPackageId && fetchedNugetPackage) {
      return fetchedNugetPackage.packageId;
    }

    return decodeURIComponent(segment);
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link
        to="/"
        className="flex items-center hover:text-foreground transition-colors"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {segments.map((segment, index) => {
        const path = '/' + segments.slice(0, index + 1).join('/');
        const isLast = index === segments.length - 1;
        const label = resolveLabel(segment, index);

        // registry-type labels are only navigable at the top level (/docker, /nuget, /npm)
        // — inside /registry/:id/docker/... the path would 404
        const isInsideRegistryScope = segments[0] === 'registry';
        const isNonNavigable =
          alwaysNonNavigable.has(segment) ||
          (registryTypeSegments.has(segment) && isInsideRegistryScope);

        return (
          <Fragment key={path}>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            {isLast || isNonNavigable ? (
              <span className={isLast ? 'font-medium text-foreground truncate max-w-[200px]' : 'truncate max-w-[200px]'}>
                {label}
              </span>
            ) : (
              <Link
                to={path}
                className="hover:text-foreground transition-colors truncate max-w-[200px]"
              >
                {label}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
