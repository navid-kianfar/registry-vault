import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Calendar, ChevronRight, User } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useTeam } from '@/services/queries/rbac.queries';
import { formatDate } from '@/lib/formatters';

export default function TeamDetailPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();

  const { data: team, isLoading } = useTeam(teamId!);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/access/teams')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/access/teams')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="py-12 text-center text-muted-foreground">Team not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/access/teams')} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to Teams
      </Button>

      <PageHeader title={team.name} description={team.description || 'No description provided.'}>
        <Badge variant="secondary" className="gap-1">
          <Users className="h-3 w-3" />
          {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
        </Badge>
      </PageHeader>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <StatCard label="Members" value={team.memberCount} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Created" value={formatDate(team.createdAt)} icon={<Calendar className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Members
            <Badge variant="secondary" className="text-xs ml-auto">
              {team.memberIds.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {team.memberIds.length === 0 ? (
            <EmptyState title="No members" description="This team has no members yet." />
          ) : (
            <div className="space-y-2">
              {team.memberIds.map((memberId) => (
                <button
                  key={memberId}
                  onClick={() => navigate(`/access/users/${memberId}`)}
                  className="w-full flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors text-left group"
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="text-xs">
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium font-mono truncate block">
                      {memberId}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
