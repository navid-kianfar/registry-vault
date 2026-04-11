import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RegistryType, WebhookEvent } from '@registry-vault/shared';
import { formatRelativeTime } from '@/lib/formatters';
import { Globe, Clock, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
} from '@/services/queries/settings.queries';
import type { IWebhook } from '@registry-vault/shared';

const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  [WebhookEvent.Push]: 'Push',
  [WebhookEvent.Pull]: 'Pull',
  [WebhookEvent.Delete]: 'Delete',
  [WebhookEvent.SecurityScan]: 'Security Scan',
  [WebhookEvent.PolicyViolation]: 'Policy Violation',
};

const ALL_EVENTS = [
  WebhookEvent.Push,
  WebhookEvent.Pull,
  WebhookEvent.Delete,
  WebhookEvent.SecurityScan,
  WebhookEvent.PolicyViolation,
];

function getStatusCodeVariant(code: number): 'default' | 'destructive' | 'secondary' {
  if (code >= 200 && code < 300) return 'default';
  if (code >= 500) return 'destructive';
  return 'secondary';
}

export default function WebhooksList() {
  const { data: webhooks, isLoading } = useWebhooks();
  const createMutation = useCreateWebhook();
  const updateMutation = useUpdateWebhook();
  const deleteMutation = useDeleteWebhook();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IWebhook | null>(null);
  const [deleting, setDeleting] = useState<IWebhook | null>(null);

  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<WebhookEvent[]>([]);
  const [formRegistryType, setFormRegistryType] = useState<string>('all');
  const [formActive, setFormActive] = useState(true);
  const [formSecret, setFormSecret] = useState('');

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormUrl('');
    setFormEvents([WebhookEvent.Push, WebhookEvent.Delete]);
    setFormRegistryType('all');
    setFormActive(true);
    setFormSecret('');
    setDialogOpen(true);
  }

  function openEdit(webhook: IWebhook) {
    setEditing(webhook);
    setFormName(webhook.name);
    setFormUrl(webhook.url);
    setFormEvents(webhook.events);
    setFormRegistryType(webhook.registryType != null ? String(webhook.registryType) : 'all');
    setFormActive(webhook.isActive);
    setFormSecret('');
    setDialogOpen(true);
  }

  function toggleEvent(event: WebhookEvent) {
    setFormEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  function handleToggleActive(webhook: IWebhook) {
    updateMutation.mutate({ id: webhook.id, request: { isActive: !webhook.isActive } });
  }

  function handleSubmit() {
    const request = {
      name: formName,
      url: formUrl,
      events: formEvents,
      registryType: formRegistryType !== 'all' ? (Number(formRegistryType) as RegistryType) : undefined,
      isActive: formActive,
      secret: formSecret || undefined,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, request }, { onSuccess: () => setDialogOpen(false) });
    } else {
      createMutation.mutate(request, { onSuccess: () => setDialogOpen(false) });
    }
  }

  function handleDelete() {
    if (!deleting) return;
    deleteMutation.mutate(deleting.id, { onSuccess: () => setDeleteDialogOpen(false) });
  }

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
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold">Webhooks</CardTitle>
            <CardDescription>HTTP callbacks triggered by registry events.</CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Webhook
          </Button>
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
                  <div className="flex items-center gap-2">
                    {webhook.lastStatusCode != null && (
                      <Badge variant={getStatusCodeVariant(webhook.lastStatusCode)}>
                        {webhook.lastStatusCode}
                      </Badge>
                    )}
                    <Switch
                      checked={webhook.isActive}
                      onCheckedChange={() => handleToggleActive(webhook)}
                      disabled={updateMutation.isPending}
                      aria-label="Toggle webhook"
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(webhook)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => { setDeleting(webhook); setDeleteDialogOpen(true); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
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

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Webhook' : 'Add Webhook'}</DialogTitle>
            <DialogDescription>
              Configure an HTTP endpoint to receive registry event notifications.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="whName">Name</Label>
                <Input id="whName" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. CI Trigger" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whRegistry">Registry Filter</Label>
                <Select value={formRegistryType} onValueChange={setFormRegistryType}>
                  <SelectTrigger id="whRegistry"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Registries</SelectItem>
                    <SelectItem value={String(RegistryType.Docker)}>Docker</SelectItem>
                    <SelectItem value={String(RegistryType.NuGet)}>NuGet</SelectItem>
                    <SelectItem value={String(RegistryType.NPM)}>NPM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="whUrl">Endpoint URL</Label>
              <Input id="whUrl" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} placeholder="https://example.com/webhook" />
            </div>
            <div className="space-y-2">
              <Label>Events</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_EVENTS.map((event) => (
                  <label key={event} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={formEvents.includes(event)}
                      onCheckedChange={() => toggleEvent(event)}
                    />
                    {WEBHOOK_EVENT_LABELS[event]}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="whSecret">
                Secret <span className="text-muted-foreground font-normal">(optional — used for HMAC signature)</span>
              </Label>
              <Input
                id="whSecret"
                type="password"
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
                placeholder={editing ? '(unchanged)' : 'Optional signing secret'}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="whActive" checked={formActive} onCheckedChange={setFormActive} />
              <Label htmlFor="whActive">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!formName || !formUrl || formEvents.length === 0 || createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Webhook</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">{deleting?.name}</span>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
