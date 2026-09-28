import { Outlet, Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const settingsTabs = [
  { label: 'General', path: '/settings/general' },
  { label: 'Registries', path: '/settings/registries' },
  { label: 'Storage', path: '/settings/storage' },
  { label: 'Retention', path: '/settings/retention' },
  { label: 'Webhooks', path: '/settings/webhooks' },
];

export default function SettingsPage() {
  const location = useLocation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your Registry Vault instance configuration.</p>
      </div>
      <div className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 lg:mx-0 lg:px-0">
        {settingsTabs.map((tab) => (
          <Link
            key={tab.path}
            to={tab.path}
            className={cn(
              'whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              location.pathname === tab.path
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            aria-current={location.pathname === tab.path ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <div>
        <Outlet />
      </div>
    </div>
  );
}
