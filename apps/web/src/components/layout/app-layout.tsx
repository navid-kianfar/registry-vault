import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { SidebarProvider } from '@/providers/sidebar-provider';
import { useGeneralSettings } from '@/services/queries/settings.queries';
import { AlertTriangle } from 'lucide-react';

function MaintenanceBanner() {
  const { data: settings } = useGeneralSettings();
  if (!settings?.maintenanceMode) return null;

  return (
    <div className="flex items-center gap-2 bg-destructive px-4 py-2 text-sm text-destructive-foreground">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        <strong>Maintenance Mode</strong> — The registry is currently rejecting push and pull requests.
      </span>
    </div>
  );
}

export function AppLayout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <MaintenanceBanner />
          <Topbar />
          <main ref={mainRef} className="flex-1 overflow-y-auto p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
