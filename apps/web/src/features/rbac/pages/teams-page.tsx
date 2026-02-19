import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Calendar, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@registryvault/shared';
import type { ITeam } from '@registryvault/shared';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTeams } from '@/services/queries/rbac.queries';
import { formatRelativeTime } from '@/lib/formatters';

function TeamCard({ team, onClick }: { team: ITeam; onClick: () => void }) {
  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors group"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <span className="truncate">{team.name}</span>
          </div>
          <Badge variant="secondary" className="text-xs shrink-0">
            {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {team.description ? (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {team.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic mb-3">
            No description
          </p>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>Created {formatRelativeTime(team.createdAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TeamsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const { data, isLoading } = useTeams({ page, pageSize });

  const totalCount = data?.totalCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Teams" description="Manage teams and their members.">
        <Badge variant="secondary" className="gap-1">
          <Users className="h-3 w-3" />
          {totalCount} teams
        </Badge>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Create Team
        </Button>
      </PageHeader>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[160px] rounded-lg" />
          ))}
        </div>
      ) : !data?.items.length ? (
        <EmptyState
          icon={<Users className="h-6 w-6 text-muted-foreground" />}
          title="No teams found"
          description="Teams will appear here once they are created."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              onClick={() => navigate(`/access/teams/${team.id}`)}
            />
          ))}
        </div>
      )}

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
