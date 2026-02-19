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
        <p className="text-muted-foreground">Manage your RegistryVault instance configuration.</p>
      </div>
      <div className="flex gap-1 border-b">
        {settingsTabs.map((tab) => (
          <Link
            key={tab.path}
            to={tab.path}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              location.pathname === tab.path
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
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
