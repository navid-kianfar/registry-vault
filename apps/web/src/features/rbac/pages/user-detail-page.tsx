import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Shield, Calendar, Clock, Users } from 'lucide-react';
import { Role } from '@registryvault/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { EmptyState } from '@/components/shared/empty-state';
import { useUser } from '@/services/queries/rbac.queries';
import { formatRelativeTime, formatDate } from '@/lib/formatters';

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

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const { data: user, isLoading } = useUser(userId!);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/access/users')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/access/users')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="py-12 text-center text-muted-foreground">User not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/access/users')} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to Users
      </Button>

      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg font-medium">
            {getInitials(user.displayName)}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{user.displayName}</h1>
          <p className="text-muted-foreground">@{user.username}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4" />
                Email
              </div>
              <span className="text-sm font-medium">{user.email}</span>
            </div>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                Role
              </div>
              <Badge variant="outline" className={`${ROLE_COLORS[user.role]} text-xs`}>
                {ROLE_LABELS[user.role]}
              </Badge>
            </div>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`}
                />
                Status
              </div>
              <Badge
                variant="outline"
                className={
                  user.isActive
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs'
                    : 'bg-gray-500/10 text-gray-500 border-gray-500/20 text-xs'
                }
              >
                {user.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Created
              </div>
              <span className="text-sm font-medium">{formatDate(user.createdAt)}</span>
            </div>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                Last Login
              </div>
              <span className="text-sm font-medium">
                {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : 'Never'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Teams
              <Badge variant="secondary" className="text-xs ml-auto">
                {user.teamIds.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {user.teamIds.length === 0 ? (
              <EmptyState title="No teams" description="This user is not a member of any team." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {user.teamIds.map((teamId) => (
                  <Badge
                    key={teamId}
                    variant="secondary"
                    className="cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => navigate(`/access/teams/${teamId}`)}
                  >
                    Team {teamId.slice(0, 8)}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
