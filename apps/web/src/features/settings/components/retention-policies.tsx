import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { useRetentionPolicies } from '@/services/queries/settings.queries';
import { Clock, Hash, Filter } from 'lucide-react';

export default function RetentionPolicies() {
  const { data: policies, isLoading } = useRetentionPolicies();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Retention Policies</CardTitle>
        <CardDescription>
          Automated cleanup rules for images and packages.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {policies?.map((policy) => (
            <div key={policy.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RegistryBadge type={policy.registryType} />
                  <span className="text-sm font-semibold">{policy.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={policy.enabled ? 'default' : 'secondary'}>
                    {policy.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <Switch checked={policy.enabled} disabled aria-label="Policy status" />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {policy.keepLastN != null && (
                  <span className="flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    Keep last {policy.keepLastN}
                  </span>
                )}
                {policy.olderThanDays != null && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Older than {policy.olderThanDays} days
                  </span>
                )}
                {policy.tagPatternExclude && (
                  <span className="flex items-center gap-1">
                    <Filter className="h-3 w-3" />
                    Exclude: <code className="rounded bg-muted px-1">{policy.tagPatternExclude}</code>
                  </span>
                )}
              </div>
            </div>
          ))}

          {policies?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No retention policies configured.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
