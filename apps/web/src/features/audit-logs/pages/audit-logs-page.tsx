import { useState, useMemo, useCallback } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuditLogs } from '@/services/queries/audit-logs.queries';
import { formatRelativeTime } from '@/lib/formatters';
import {
  AuditAction,
  RegistryType,
  DEFAULT_PAGE_SIZE,
  REGISTRY_LABELS,
} from '@registryvault/shared';
import type { IAuditLogEntry } from '@registryvault/shared';
import {
  Search,
  ShieldCheck,
  ShieldAlert,
  Container,
  Package,
  Trash2,
  Upload,
  Download,
  UserPlus,
  UserCog,
  UserMinus,
  Users,
  Settings,
  Webhook,
  LogIn,
  LogOut,
  Tag,
  Globe,
  FileText,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Action label & icon helpers
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<AuditAction, string> = {
  [AuditAction.ImagePush]: 'Image Push',
  [AuditAction.ImagePull]: 'Image Pull',
  [AuditAction.ImageDelete]: 'Image Delete',
  [AuditAction.TagDelete]: 'Tag Delete',
  [AuditAction.PackagePublish]: 'Package Publish',
  [AuditAction.PackageDelete]: 'Package Delete',
  [AuditAction.PackageDownload]: 'Package Download',
  [AuditAction.UserCreate]: 'User Create',
  [AuditAction.UserUpdate]: 'User Update',
  [AuditAction.UserDelete]: 'User Delete',
  [AuditAction.TeamCreate]: 'Team Create',
  [AuditAction.TeamUpdate]: 'Team Update',
  [AuditAction.TeamDelete]: 'Team Delete',
  [AuditAction.RoleAssign]: 'Role Assign',
  [AuditAction.SettingsUpdate]: 'Settings Update',
  [AuditAction.WebhookCreate]: 'Webhook Create',
  [AuditAction.WebhookDelete]: 'Webhook Delete',
  [AuditAction.LoginSuccess]: 'Login Success',
  [AuditAction.LoginFailure]: 'Login Failure',
};

const ACTION_ICONS: Record<AuditAction, ReactNode> = {
  [AuditAction.ImagePush]: <Upload className="h-4 w-4" />,
  [AuditAction.ImagePull]: <Download className="h-4 w-4" />,
  [AuditAction.ImageDelete]: <Trash2 className="h-4 w-4" />,
  [AuditAction.TagDelete]: <Tag className="h-4 w-4" />,
  [AuditAction.PackagePublish]: <Upload className="h-4 w-4" />,
  [AuditAction.PackageDelete]: <Trash2 className="h-4 w-4" />,
  [AuditAction.PackageDownload]: <Download className="h-4 w-4" />,
  [AuditAction.UserCreate]: <UserPlus className="h-4 w-4" />,
  [AuditAction.UserUpdate]: <UserCog className="h-4 w-4" />,
  [AuditAction.UserDelete]: <UserMinus className="h-4 w-4" />,
  [AuditAction.TeamCreate]: <Users className="h-4 w-4" />,
  [AuditAction.TeamUpdate]: <Users className="h-4 w-4" />,
  [AuditAction.TeamDelete]: <Users className="h-4 w-4" />,
  [AuditAction.RoleAssign]: <ShieldCheck className="h-4 w-4" />,
  [AuditAction.SettingsUpdate]: <Settings className="h-4 w-4" />,
  [AuditAction.WebhookCreate]: <Webhook className="h-4 w-4" />,
  [AuditAction.WebhookDelete]: <Webhook className="h-4 w-4" />,
  [AuditAction.LoginSuccess]: <LogIn className="h-4 w-4" />,
  [AuditAction.LoginFailure]: <LogOut className="h-4 w-4" />,
};

// Group actions for the filter dropdown
const ACTION_GROUPS = [
  {
    label: 'Registry',
    actions: [
      AuditAction.ImagePush,
      AuditAction.ImagePull,
      AuditAction.ImageDelete,
      AuditAction.TagDelete,
      AuditAction.PackagePublish,
      AuditAction.PackageDelete,
      AuditAction.PackageDownload,
    ],
  },
  {
    label: 'User Management',
    actions: [
      AuditAction.UserCreate,
      AuditAction.UserUpdate,
      AuditAction.UserDelete,
      AuditAction.TeamCreate,
      AuditAction.TeamUpdate,
      AuditAction.TeamDelete,
      AuditAction.RoleAssign,
    ],
  },
  {
    label: 'System',
    actions: [
      AuditAction.SettingsUpdate,
      AuditAction.WebhookCreate,
      AuditAction.WebhookDelete,
      AuditAction.LoginSuccess,
      AuditAction.LoginFailure,
    ],
  },
];

// ---------------------------------------------------------------------------
// Audit log row component
// ---------------------------------------------------------------------------

function AuditLogRow({ entry }: { entry: IAuditLogEntry }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50">
      {/* Action icon with success/failure indicator */}
      <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <span className="text-muted-foreground">{ACTION_ICONS[entry.action]}</span>
        <span
          className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
            entry.success ? 'bg-emerald-500' : 'bg-red-500'
          }`}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{entry.actorUsername}</span>
          <span className="text-sm text-muted-foreground">{ACTION_LABELS[entry.action]}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground truncate max-w-[260px]">
            {entry.resourceName}
          </code>
          {entry.registryType !== undefined && (
            <RegistryBadge type={entry.registryType} className="scale-90 origin-left" />
          )}
        </div>

        {entry.details && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{entry.details}</p>
        )}
      </div>

      {/* Meta column */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge
          variant={entry.success ? 'outline' : 'destructive'}
          className={`text-[10px] px-1.5 py-0 ${
            entry.success
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
              : ''
          }`}
        >
          {entry.success ? 'Success' : 'Failed'}
        </Badge>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
          {formatRelativeTime(entry.createdAt)}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Globe className="h-3 w-3" />
          {entry.ipAddress}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function AuditLogSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-4 rounded-lg border p-4">
          <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [usernameSearch, setUsernameSearch] = useState('');
  const [registryType, setRegistryType] = useState<RegistryType | undefined>(undefined);
  const [selectedAction, setSelectedAction] = useState<AuditAction | undefined>(undefined);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: 'createdAt',
      sortOrder: 'desc' as const,
      actorUsername: usernameSearch || undefined,
      registryType,
      actions: selectedAction !== undefined ? [selectedAction] : undefined,
    }),
    [page, pageSize, usernameSearch, registryType, selectedAction],
  );

  const { data, isLoading } = useAuditLogs(params);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setUsernameSearch('');
    setRegistryType(undefined);
    setSelectedAction(undefined);
    setPage(1);
  }, []);

  const hasActiveFilters = usernameSearch || registryType !== undefined || selectedAction !== undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="View system activity and user actions across all registries"
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {data && <span>{data.totalCount} entries</span>}
        </div>
      </PageHeader>

      {/* ----- Filter bar ----- */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Username search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by username..."
                value={usernameSearch}
                onChange={(e) => {
                  setUsernameSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>

            {/* Registry type filter */}
            <Select
              value={registryType !== undefined ? String(registryType) : 'all'}
              onValueChange={(value) => {
                setRegistryType(value === 'all' ? undefined : (Number(value) as RegistryType));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Registry type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Registries</SelectItem>
                <SelectItem value={String(RegistryType.Docker)}>
                  <div className="flex items-center gap-2">
                    <Container className="h-3.5 w-3.5" />
                    {REGISTRY_LABELS[RegistryType.Docker]}
                  </div>
                </SelectItem>
                <SelectItem value={String(RegistryType.NuGet)}>
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5" />
                    {REGISTRY_LABELS[RegistryType.NuGet]}
                  </div>
                </SelectItem>
                <SelectItem value={String(RegistryType.NPM)}>
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5" />
                    {REGISTRY_LABELS[RegistryType.NPM]}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Action type filter */}
            <Select
              value={selectedAction !== undefined ? String(selectedAction) : 'all'}
              onValueChange={(value) => {
                setSelectedAction(
                  value === 'all' ? undefined : (Number(value) as AuditAction),
                );
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Action type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {ACTION_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      {group.label}
                    </div>
                    {group.actions.map((action) => (
                      <SelectItem key={action} value={String(action)}>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{ACTION_ICONS[action]}</span>
                          {ACTION_LABELS[action]}
                        </div>
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>

            {/* Clear filters */}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleClearFilters} className="gap-1.5">
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ----- Log entries ----- */}
      {isLoading ? (
        <AuditLogSkeleton />
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={<ShieldAlert className="h-6 w-6 text-muted-foreground" />}
              title="No audit logs found"
              description={
                hasActiveFilters
                  ? 'Try adjusting your filters to find what you are looking for.'
                  : 'Audit logs will appear here as actions are performed in the system.'
              }
              action={
                hasActiveFilters ? (
                  <Button variant="outline" size="sm" onClick={handleClearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {data.items.map((entry) => (
              <AuditLogRow key={entry.id} entry={entry} />
            ))}
          </div>

          <DataTablePagination
            page={data.page}
            pageSize={data.pageSize}
            totalCount={data.totalCount}
            totalPages={data.totalPages}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
          />
        </>
      )}
    </div>
  );
}
