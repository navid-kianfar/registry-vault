import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useWebhooks } from '@/services/queries/settings.queries';
import { WebhookEvent } from '@registryvault/shared';
import { formatRelativeTime } from '@/lib/formatters';
import { Globe, Clock } from 'lucide-react';

const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  [WebhookEvent.Push]: 'Push',
  [WebhookEvent.Pull]: 'Pull',
  [WebhookEvent.Delete]: 'Delete',
  [WebhookEvent.SecurityScan]: 'Scan',
  [WebhookEvent.PolicyViolation]: 'Policy',
};

function getStatusCodeVariant(code: number): 'default' | 'destructive' | 'secondary' {
  if (code >= 200 && code < 300) return 'default';
  if (code >= 500) return 'destructive';
  return 'secondary';
}

export default function WebhooksList() {
  const { data: webhooks, isLoading } = useWebhooks();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-64" />
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
        <CardTitle className="text-base font-semibold">Webhooks</CardTitle>
        <CardDescription>HTTP callbacks triggered by registry events.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {webhooks?.map((webhook) => (
            <div key={webhook.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{webhook.name}</span>
                  <Badge variant={webhook.isActive ? 'default' : 'secondary'}>
                    {webhook.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {webhook.lastStatusCode != null && (
                  <Badge variant={getStatusCodeVariant(webhook.lastStatusCode)}>
                    {webhook.lastStatusCode}
                  </Badge>
                )}
              </div>

              <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-xs">{webhook.url}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {webhook.events.map((event) => (
                  <Badge key={event} variant="outline" className="text-[11px]">
                    {WEBHOOK_EVENT_LABELS[event]}
                  </Badge>
                ))}
              </div>

              {webhook.lastTriggeredAt && (
                <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Last triggered {formatRelativeTime(webhook.lastTriggeredAt)}
                </div>
              )}
            </div>
          ))}

          {webhooks?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No webhooks configured.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
