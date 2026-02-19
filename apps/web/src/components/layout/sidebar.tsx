import { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/hooks/use-sidebar';
import { useRegistryConnections } from '@/services/queries/settings.queries';
import { RegistryType, REGISTRY_LABELS } from '@registryvault/shared';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  LayoutDashboard,
  BarChart3,
  Container,
  Package,
  Box,
  Users,
  Shield,
  ScrollText,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Boxes,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { IRegistryConnection } from '@registryvault/shared';

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
  color?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const staticNavBefore: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/', icon: <LayoutDashboard className="h-4 w-4" /> },
      { label: 'Analytics', path: '/analytics', icon: <BarChart3 className="h-4 w-4" /> },
    ],
  },
];

const staticNavAfter: NavGroup[] = [
  {
    label: 'Access Control',
    items: [
      { label: 'Users', path: '/access/users', icon: <Users className="h-4 w-4" /> },
      { label: 'Teams', path: '/access/teams', icon: <Boxes className="h-4 w-4" /> },
      { label: 'Roles', path: '/access/roles', icon: <Shield className="h-4 w-4" /> },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Audit Logs', path: '/audit-logs', icon: <ScrollText className="h-4 w-4" /> },
      { label: 'Settings', path: '/settings', icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

const registryTypeConfig: Record<RegistryType, { icon: ReactNode; color: string }> = {
  [RegistryType.Docker]: {
    icon: <Container className="h-4 w-4" />,
    color: 'text-[hsl(var(--docker))]',
  },
  [RegistryType.NuGet]: {
    icon: <Package className="h-4 w-4" />,
    color: 'text-[hsl(var(--nuget))]',
  },
  [RegistryType.NPM]: {
    icon: <Box className="h-4 w-4" />,
    color: 'text-[hsl(var(--npm))]',
  },
};

function SidebarNavItem({ item, isCollapsed }: { item: NavItem; isCollapsed: boolean }) {
  const location = useLocation();
  const isActive = item.path === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(item.path);

  const link = (
    <Link
      to={item.path}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70',
        isCollapsed && 'justify-center px-2',
      )}
    >
      <span className={cn(item.color)}>{item.icon}</span>
      {!isCollapsed && <span>{item.label}</span>}
    </Link>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function RegistryTypeGroup({
  registryType,
  connections,
  isCollapsed,
}: {
  registryType: RegistryType;
  connections: IRegistryConnection[];
  isCollapsed: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const location = useLocation();
  const config = registryTypeConfig[registryType];
  const label = REGISTRY_LABELS[registryType];

  const hasActiveConnection = connections.some((conn) =>
    location.pathname.startsWith(`/registry/${conn.id}`),
  );

  if (isCollapsed) {
    // When collapsed, show just the type icon with a tooltip listing connections
    const tooltipContent = connections.map((conn) => conn.name).join(', ');
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex items-center justify-center rounded-md px-2 py-2 transition-colors',
              hasActiveConnection
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70',
            )}
          >
            <span className={config.color}>{config.icon}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          <div className="space-y-1">
            <div className="font-semibold">{label} ({connections.length})</div>
            {connections.map((conn) => (
              <div key={conn.id}>
                <Link
                  to={`/registry/${conn.id}`}
                  className={cn(
                    'block text-sm hover:underline',
                    location.pathname.startsWith(`/registry/${conn.id}`)
                      ? 'font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {conn.name}
                </Link>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold text-sidebar-foreground/60 hover:text-sidebar-foreground/80 transition-colors">
        <span className={config.color}>{config.icon}</span>
        <span className="flex-1 text-left">
          {label} ({connections.length})
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform duration-200',
            !isOpen && '-rotate-90',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-3 space-y-0.5 border-l border-sidebar-border pl-2">
          {connections.map((conn) => {
            const isActive = location.pathname.startsWith(`/registry/${conn.id}`);
            return (
              <Link
                key={conn.id}
                to={`/registry/${conn.id}`}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground/70',
                )}
              >
                <span className="truncate">{conn.name}</span>
              </Link>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RegistriesSection({ isCollapsed }: { isCollapsed: boolean }) {
  const { data: connections } = useRegistryConnections();

  const grouped = useMemo(() => {
    if (!connections) return [];
    const groups = new Map<RegistryType, IRegistryConnection[]>();
    for (const conn of connections) {
      const existing = groups.get(conn.registryType) || [];
      existing.push(conn);
      groups.set(conn.registryType, existing);
    }
    // Sort by registry type order: Docker, NuGet, NPM
    const order = [RegistryType.Docker, RegistryType.NuGet, RegistryType.NPM];
    return order
      .filter((type) => groups.has(type))
      .map((type) => ({ type, connections: groups.get(type)! }));
  }, [connections]);

  if (!connections || grouped.length === 0) return null;

  return (
    <div>
      {!isCollapsed && (
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Registries
        </p>
      )}
      {isCollapsed && <div className="mb-1 border-t border-sidebar-border" />}
      <div className="space-y-1">
        {grouped.map(({ type, connections: conns }) => (
          <RegistryTypeGroup
            key={type}
            registryType={type}
            connections={conns}
            isCollapsed={isCollapsed}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarContent({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn(
        'flex h-14 items-center border-b border-sidebar-border px-4',
        isCollapsed && 'justify-center px-2',
      )}>
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Package className="h-4 w-4" />
          </div>
          {!isCollapsed && (
            <span className="text-base font-bold text-sidebar-foreground">
              RegistryVault
            </span>
          )}
        </Link>
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="space-y-4">
          {/* Static groups before Registries */}
          {staticNavBefore.map((group) => (
            <div key={group.label}>
              {!isCollapsed && (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </p>
              )}
              {isCollapsed && <div className="mb-1 border-t border-sidebar-border" />}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarNavItem key={item.path} item={item} isCollapsed={isCollapsed} />
                ))}
              </div>
            </div>
          ))}

          {/* Dynamic Registries section */}
          <RegistriesSection isCollapsed={isCollapsed} />

          {/* Static groups after Registries */}
          {staticNavAfter.map((group) => (
            <div key={group.label}>
              {!isCollapsed && (
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </p>
              )}
              {isCollapsed && <div className="mb-1 border-t border-sidebar-border" />}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarNavItem key={item.path} item={item} isCollapsed={isCollapsed} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>
    </div>
  );
}

export function Sidebar() {
  const { isCollapsed, toggle, isMobileOpen, setMobileOpen } = useSidebar();

  return (
    <TooltipProvider>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 relative',
          isCollapsed ? 'w-[60px]' : 'w-[240px]',
        )}
      >
        <SidebarContent isCollapsed={isCollapsed} />
        <button
          onClick={toggle}
          className="absolute -right-3 top-[18px] z-50 flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm hover:bg-accent"
        >
          {isCollapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </button>
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={isMobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[240px] p-0 bg-sidebar">
          <SidebarContent isCollapsed={false} />
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
