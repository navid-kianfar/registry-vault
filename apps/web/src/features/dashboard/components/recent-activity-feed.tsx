import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { formatRelativeTime } from '@/lib/formatters';
import type { IActivityFeedItem } from '@registryvault/shared';

interface RecentActivityFeedProps {
  activities: IActivityFeedItem[];
}

function getInitials(name: string): string {
  return name
    .split(/[.\-_\s]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

function getAvatarColor(name: string): string {
  const colors = [
    'bg-blue-500/15 text-blue-600',
    'bg-emerald-500/15 text-emerald-600',
    'bg-violet-500/15 text-violet-600',
    'bg-amber-500/15 text-amber-600',
    'bg-rose-500/15 text-rose-600',
    'bg-cyan-500/15 text-cyan-600',
    'bg-pink-500/15 text-pink-600',
    'bg-indigo-500/15 text-indigo-600',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function RecentActivityFeed({ activities }: RecentActivityFeedProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
        <p className="text-xs text-muted-foreground">Latest actions across all registries</p>
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        <ScrollArea className="h-[400px] pr-3">
          <div className="space-y-1">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-muted/50"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback
                    className={`text-xs font-medium ${getAvatarColor(activity.actorName)}`}
                  >
                    {getInitials(activity.actorName)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{activity.actorName}</span>
                    <RegistryBadge type={activity.registryType} className="h-5 text-[10px]" />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span>{activity.action}</span>
                    {' '}
                    <span className="font-medium text-foreground">{activity.resourceName}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {formatRelativeTime(activity.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
