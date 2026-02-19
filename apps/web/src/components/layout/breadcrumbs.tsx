import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { Fragment } from 'react';

const pathLabels: Record<string, string> = {
  docker: 'Docker Registry',
  nuget: 'NuGet Registry',
  npm: 'NPM Registry',
  access: 'Access Control',
  users: 'Users',
  teams: 'Teams',
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

export function Breadcrumbs() {
  const location = useLocation();

  if (location.pathname === '/') return null;

  const segments = location.pathname.split('/').filter(Boolean);

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
        const label = pathLabels[segment] || decodeURIComponent(segment);

        return (
          <Fragment key={path}>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            {isLast ? (
              <span className="font-medium text-foreground truncate max-w-[200px]">
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
