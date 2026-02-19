import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { useRegistryConnections } from '@/services/queries/settings.queries';
import { ExternalLink, User } from 'lucide-react';

export default function RegistryConnections() {
  const { data: connections, isLoading } = useRegistryConnections();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Registry Connections</CardTitle>
        <CardDescription>Connected container and package registries.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {connections?.map((connection) => (
            <div
              key={connection.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <RegistryBadge type={connection.registryType} />
                  <span className="text-sm font-semibold">{connection.name}</span>
                  {connection.isDefault && (
                    <Badge variant="secondary" className="text-[11px]">
                      Default
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 truncate">
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {connection.url}
                  </span>
                  {connection.username && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3 shrink-0" />
                      {connection.username}
                    </span>
                  )}
                </div>
              </div>

              <div className="ml-4 flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      connection.isConnected ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {connection.isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {connections?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No registry connections configured.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
