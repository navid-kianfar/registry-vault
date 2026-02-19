import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useGeneralSettings, useUpdateGeneralSettings } from '@/services/queries/settings.queries';
import { Role } from '@registryvault/shared';
import type { IGeneralSettings } from '@registryvault/shared';
import { AlertTriangle, Save } from 'lucide-react';

const ROLE_LABELS: Record<number, string> = {
  [Role.Admin]: 'Admin',
  [Role.Maintainer]: 'Maintainer',
  [Role.Reader]: 'Reader',
};

export default function GeneralSettingsForm() {
  const { data: settings, isLoading } = useGeneralSettings();
  const updateSettings = useUpdateGeneralSettings();

  const [form, setForm] = useState<IGeneralSettings>({
    instanceName: '',
    instanceUrl: '',
    allowSelfRegistration: false,
    defaultRole: Role.Reader,
    sessionTimeoutMinutes: 30,
    maintenanceMode: false,
  });

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  function handleSave() {
    updateSettings.mutate(form);
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">General Settings</CardTitle>
        <CardDescription>Configure your RegistryVault instance.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="instanceName">Instance Name</Label>
            <Input
              id="instanceName"
              value={form.instanceName}
              onChange={(e) => setForm((prev) => ({ ...prev, instanceName: e.target.value }))}
              placeholder="My RegistryVault"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instanceUrl">Instance URL</Label>
            <Input
              id="instanceUrl"
              value={form.instanceUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, instanceUrl: e.target.value }))}
              placeholder="https://registry.example.com"
            />
          </div>
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="defaultRole">Default Role</Label>
            <Select
              value={String(form.defaultRole)}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, defaultRole: Number(value) }))
              }
            >
              <SelectTrigger id="defaultRole">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(Role.Admin)}>Admin</SelectItem>
                <SelectItem value={String(Role.Maintainer)}>Maintainer</SelectItem>
                <SelectItem value={String(Role.Reader)}>Reader</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sessionTimeout">Session Timeout (minutes)</Label>
            <Input
              id="sessionTimeout"
              type="number"
              min={1}
              value={form.sessionTimeoutMinutes}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  sessionTimeoutMinutes: Number(e.target.value),
                }))
              }
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="selfRegistration" className="text-sm font-medium">
                Allow Self Registration
              </Label>
              <p className="text-xs text-muted-foreground">
                Allow new users to create accounts without an invitation.
              </p>
            </div>
            <Switch
              id="selfRegistration"
              checked={form.allowSelfRegistration}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, allowSelfRegistration: checked }))
              }
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-destructive/50 bg-destructive/5 p-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <Label htmlFor="maintenanceMode" className="text-sm font-medium">
                  Maintenance Mode
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                When enabled, the registry will reject all push and pull requests.
              </p>
            </div>
            <Switch
              id="maintenanceMode"
              checked={form.maintenanceMode}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, maintenanceMode: checked }))
              }
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateSettings.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
