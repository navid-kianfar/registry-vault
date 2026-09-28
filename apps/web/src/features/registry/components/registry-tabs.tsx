import { Link, useLocation } from 'react-router-dom';
import type { IRegistryConnection } from '@registry-vault/shared';
import { RegistryType } from '@registry-vault/shared';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { cn } from '@/lib/utils';

interface RegistryTab {
  label: string;
  path: string;
}

/**
 * Navigation only ever offers destinations that work: Maintenance appears when
 * the connection has an agent, Registry users when that agent manages logins
 * and the viewer can see them.
 */
function buildTabs(
  connectionId: string,
  connection: IRegistryConnection,
  isAdmin: boolean,
): readonly RegistryTab[] {
  const tabs: RegistryTab[] = [{ label: 'Repositories', path: `/registry/${connectionId}` }];

  const hasAgent = connection.registryType === RegistryType.Docker && !!connection.agent;
  if (!hasAgent) return tabs;

  tabs.push({ label: 'Maintenance', path: `/registry/${connectionId}/maintenance` });

  if (isAdmin && connection.agent?.features.includes('users')) {
    tabs.push({ label: 'Registry users', path: `/registry/${connectionId}/users` });
  }

  return tabs;
}

interface RegistryTabsProps {
  connectionId: string;
  connection: IRegistryConnection;
}

export function RegistryTabs({ connectionId, connection }: RegistryTabsProps) {
  const location = useLocation();
  const isAdmin = useIsAdmin();
  const tabs = buildTabs(connectionId, connection, isAdmin);

  // A one-tab strip is noise: NuGet and NPM registry pages look as they did.
  if (tabs.length < 2) return null;

  return (
    <div className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 lg:mx-0 lg:px-0">
      {tabs.map((tab) => {
        const isActive = location.pathname === tab.path;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
