import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HealthStatusIndicator } from '@/components/shared/health-status-indicator';
import { formatRelativeTime } from '@/lib/formatters';
import { REGISTRY_LABELS } from '@registryvault/shared';
import type { IRegistryHealth } from '@registryvault/shared';
import { ExternalLink } from 'lucide-react';

interface RegistryHealthCardProps {
  registryHealth: IRegistryHealth[];
}

export default function RegistryHealthCard({ registryHealth }: RegistryHealthCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Registry Health</CardTitle>
        <p className="text-xs text-muted-foreground">Status of all connected registries</p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {registryHealth.map((registry) => (
            <div
              key={registry.registryType}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    {REGISTRY_LABELS[registry.registryType]}
                  </span>
                  <HealthStatusIndicator status={registry.status} />
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ExternalLink className="h-3 w-3" />
                  <span className="truncate">{registry.url}</span>
                </div>
              </div>

              <div className="ml-4 shrink-0 text-right">
                <div className="text-sm font-medium tabular-nums">
                  {registry.responseTimeMs}ms
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {formatRelativeTime(registry.lastCheckedAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
