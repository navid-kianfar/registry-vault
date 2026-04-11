import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { Clock, Hash, Filter, Plus, Pencil, Trash2, Play } from 'lucide-react';
import { RegistryType } from '@registry-vault/shared';
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
import {
  useRetentionPolicies,
  useCreateRetentionPolicy,
  useUpdateRetentionPolicy,
  useDeleteRetentionPolicy,
  useRunRetentionPolicy,
} from '@/services/queries/settings.queries';
import type { IRetentionPolicy } from '@registry-vault/shared';

export default function RetentionPolicies() {
  const { data: policies, isLoading } = useRetentionPolicies();
  const createMutation = useCreateRetentionPolicy();
  const updateMutation = useUpdateRetentionPolicy();
  const deleteMutation = useDeleteRetentionPolicy();
  const runMutation = useRunRetentionPolicy();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IRetentionPolicy | null>(null);
  const [deleting, setDeleting] = useState<IRetentionPolicy | null>(null);

  const [formType, setFormType] = useState<RegistryType>(RegistryType.Docker);
  const [formName, setFormName] = useState('');
  const [formEnabled, setFormEnabled] = useState(false);
  const [formKeepLastN, setFormKeepLastN] = useState('');
  const [formOlderThanDays, setFormOlderThanDays] = useState('');
  const [formTagExclude, setFormTagExclude] = useState('');

  function openCreate() {
    setEditing(null);
    setFormType(RegistryType.Docker);
    setFormName('');
    setFormEnabled(false);
    setFormKeepLastN('');
    setFormOlderThanDays('');
    setFormTagExclude('');
    setDialogOpen(true);
  }

  function openEdit(policy: IRetentionPolicy) {
    setEditing(policy);
    setFormType(policy.registryType);
    setFormName(policy.name);
    setFormEnabled(policy.enabled);
    setFormKeepLastN(policy.keepLastN != null ? String(policy.keepLastN) : '');
    setFormOlderThanDays(policy.olderThanDays != null ? String(policy.olderThanDays) : '');
    setFormTagExclude(policy.tagPatternExclude ?? '');
    setDialogOpen(true);
  }

  function handleToggle(policy: IRetentionPolicy) {
    updateMutation.mutate({ id: policy.id, request: { enabled: !policy.enabled } });
  }

  function handleRunNow(policy: IRetentionPolicy) {
    runMutation.mutate(policy.id);
  }

  function handleSubmit() {
    const request = {
      registryType: formType,
      name: formName,
      enabled: formEnabled,
      keepLastN: formKeepLastN ? Number(formKeepLastN) : undefined,
      olderThanDays: formOlderThanDays ? Number(formOlderThanDays) : undefined,
      tagPatternExclude: formTagExclude || undefined,
    };

    if (editing) {
      updateMutation.mutate(
        { id: editing.id, request },
        { onSuccess: () => setDialogOpen(false) },
      );
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
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold">Retention Policies</CardTitle>
            <CardDescription>
              Automated cleanup rules for images and packages. Use "Run Now" to trigger a policy immediately.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Policy
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {policies?.map((policy) => (
              <div key={policy.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RegistryBadge type={policy.registryType} />
                    <span className="text-sm font-semibold">{policy.name}</span>
                    <Badge variant={policy.enabled ? 'default' : 'secondary'}>
                      {policy.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={policy.enabled}
                      onCheckedChange={() => handleToggle(policy)}
                      disabled={updateMutation.isPending}
                      aria-label="Toggle policy"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => handleRunNow(policy)}
                      disabled={runMutation.isPending}
                    >
                      <Play className="h-3 w-3" />
                      Run Now
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(policy)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => { setDeleting(policy); setDeleteDialogOpen(true); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
                  {!policy.keepLastN && !policy.olderThanDays && (
                    <span className="italic">No criteria set</span>
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

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Retention Policy' : 'Add Retention Policy'}</DialogTitle>
            <DialogDescription>
              Define when images or packages should be automatically cleaned up.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="policyType">Registry Type</Label>
                <Select value={String(formType)} onValueChange={(v) => setFormType(Number(v) as RegistryType)}>
                  <SelectTrigger id="policyType"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(RegistryType.Docker)}>Docker</SelectItem>
                    <SelectItem value={String(RegistryType.NuGet)}>NuGet</SelectItem>
                    <SelectItem value={String(RegistryType.NPM)}>NPM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="policyName">Policy Name</Label>
              <Input id="policyName" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Keep last 10 Docker images" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="keepLastN">Keep Last N Versions</Label>
                <Input
                  id="keepLastN"
                  type="number"
                  min={1}
                  value={formKeepLastN}
                  onChange={(e) => setFormKeepLastN(e.target.value)}
                  placeholder="e.g. 10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="olderThan">Delete Older Than (days)</Label>
                <Input
                  id="olderThan"
                  type="number"
                  min={1}
                  value={formOlderThanDays}
                  onChange={(e) => setFormOlderThanDays(e.target.value)}
                  placeholder="e.g. 30"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tagExclude">
                Exclude Tag Pattern <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="tagExclude"
                value={formTagExclude}
                onChange={(e) => setFormTagExclude(e.target.value)}
                placeholder="e.g. latest, stable, v*"
              />
              <p className="text-xs text-muted-foreground">Tags matching this pattern will never be deleted.</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="policyEnabled" checked={formEnabled} onCheckedChange={setFormEnabled} />
              <Label htmlFor="policyEnabled">Enable policy immediately</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!formName || (!formKeepLastN && !formOlderThanDays) || createMutation.isPending || updateMutation.isPending}
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
            <DialogTitle>Delete Retention Policy</DialogTitle>
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
