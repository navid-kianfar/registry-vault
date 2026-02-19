import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Mail, Clock, ChevronRight, UserPlus } from 'lucide-react';
import type { IUser } from '@registryvault/shared';
import { DEFAULT_PAGE_SIZE, Role } from '@registryvault/shared';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useUsers } from '@/services/queries/rbac.queries';
import { formatRelativeTime } from '@/lib/formatters';

const ROLE_LABELS: Record<Role, string> = {
  [Role.Admin]: 'Admin',
  [Role.Maintainer]: 'Maintainer',
  [Role.Reader]: 'Reader',
};

const ROLE_COLORS: Record<Role, string> = {
  [Role.Admin]: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  [Role.Maintainer]: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  [Role.Reader]: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

function getInitials(displayName: string): string {
  return displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function UserRow({ user, onClick }: { user: IUser; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group"
    >
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarFallback className="text-xs font-medium">
          {getInitials(user.displayName)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{user.displayName}</span>
          <span className="text-xs text-muted-foreground">@{user.username}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Mail className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground truncate">{user.email}</span>
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-3 shrink-0">
        <Badge variant="outline" className={`${ROLE_COLORS[user.role]} text-[10px] px-1.5 py-0`}>
          {ROLE_LABELS[user.role]}
        </Badge>

        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`}
          />
          <span className="text-xs text-muted-foreground">
            {user.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {user.lastLoginAt && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Last login">
            <Clock className="h-3.5 w-3.5" />
            <span>{formatRelativeTime(user.lastLoginAt)}</span>
          </div>
        )}
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
    </button>
  );
}

export default function UsersPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [query, setQuery] = useState('');

  const { data, isLoading } = useUsers({
    page,
    pageSize,
    query: query || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const totalCount = data?.totalCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Users" description="Manage user accounts and role assignments.">
        <Badge variant="secondary" className="gap-1">
          <Users className="h-3 w-3" />
          {totalCount} users
        </Badge>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Invite User
        </Button>
      </PageHeader>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search users..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          className="pl-8"
        />
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-lg" />
          ))
        ) : !data?.items.length ? (
          <EmptyState
            icon={<Users className="h-6 w-6 text-muted-foreground" />}
            title="No users found"
            description={query ? 'Try adjusting your search query.' : 'No users have been added yet.'}
          />
        ) : (
          data.items.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              onClick={() => navigate(`/access/users/${user.id}`)}
            />
          ))
        )}
      </div>

      {data && data.totalCount > 0 && (
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalCount={data.totalCount}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
