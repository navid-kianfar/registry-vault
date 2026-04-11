import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useGeneralSettings, useUpdateGeneralSettings } from '@/services/queries/settings.queries';
import { AlertTriangle, Save } from 'lucide-react';

export default function GeneralSettingsForm() {
  const { data: settings, isLoading } = useGeneralSettings();
  const updateSettings = useUpdateGeneralSettings();

  const [instanceName, setInstanceName] = useState('');
  const [allowSelfRegistration, setAllowSelfRegistration] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    if (settings) {
      setInstanceName(settings.instanceName);
      setAllowSelfRegistration(settings.allowSelfRegistration);
      setMaintenanceMode(settings.maintenanceMode);
    }
  }, [settings]);

  function handleSave() {
    updateSettings.mutate({ instanceName, allowSelfRegistration, maintenanceMode });
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
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
        <CardDescription>Configure your Registry Vault instance.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="instanceName">Instance Name</Label>
          <Input
            id="instanceName"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            placeholder="My Registry Vault"
          />
          <p className="text-xs text-muted-foreground">Displayed in the sidebar navigation header.</p>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="selfRegistration" className="text-sm font-medium">
                Allow Self Registration
              </Label>
              <p className="text-xs text-muted-foreground">
                Allow new users to sign up without being invited by an admin.
              </p>
            </div>
            <Switch
              id="selfRegistration"
              checked={allowSelfRegistration}
              onCheckedChange={setAllowSelfRegistration}
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
                When enabled, a warning banner is shown across the app and registry operations are paused.
              </p>
            </div>
            <Switch
              id="maintenanceMode"
              checked={maintenanceMode}
              onCheckedChange={setMaintenanceMode}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!instanceName || updateSettings.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateSettings.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
