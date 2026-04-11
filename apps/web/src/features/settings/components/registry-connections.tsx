import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { ExternalLink, User, Plus, Pencil, Trash2, KeyRound, RefreshCw } from 'lucide-react';
import { RegistryType, CredentialAuthType } from '@registry-vault/shared';
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
  useRegistryConnections,
  useCreateRegistryConnection,
  useUpdateRegistryConnection,
  useDeleteRegistryConnection,
  useSyncRegistryConnection,
  useSyncAllRegistries,
} from '@/services/queries/settings.queries';
import {
  useRegistryCredentials,
  useCreateCredential,
  useUpdateCredential,
  useDeleteCredential,
} from '@/services/queries/auth.queries';
import type { IRegistryConnection } from '@registry-vault/shared';

const REGISTRY_TYPE_PLACEHOLDERS: Record<RegistryType, string> = {
  [RegistryType.Docker]: 'http://registry.example.com:5000',
  [RegistryType.NuGet]: 'http://nuget.example.com/v3/index.json',
  [RegistryType.NPM]: 'http://npm.example.com',
};

export default function RegistryConnections() {
  const { data: connections, isLoading } = useRegistryConnections();
  const { data: credentials } = useRegistryCredentials();
  const createMutation = useCreateRegistryConnection();
  const updateMutation = useUpdateRegistryConnection();
  const deleteMutation = useDeleteRegistryConnection();
  const syncMutation = useSyncRegistryConnection();
  const syncAllMutation = useSyncAllRegistries();
  const createCredentialMutation = useCreateCredential();
  const updateCredentialMutation = useUpdateCredential();
  const deleteCredentialMutation = useDeleteCredential();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IRegistryConnection | null>(null);
  const [deleting, setDeleting] = useState<IRegistryConnection | null>(null);

  const [formType, setFormType] = useState<RegistryType>(RegistryType.Docker);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formAuthType, setFormAuthType] = useState<CredentialAuthType>(CredentialAuthType.None);
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formHeaderName, setFormHeaderName] = useState('');

  function openCreate() {
    setEditing(null);
    setFormType(RegistryType.Docker);
    setFormName('');
    setFormUrl('');
    setFormAuthType(CredentialAuthType.None);
    setFormUsername('');
    setFormPassword('');
    setFormHeaderName('');
    setDialogOpen(true);
  }

  function openEdit(conn: IRegistryConnection) {
    setEditing(conn);
    setFormType(conn.registryType);
    setFormName(conn.name);
    setFormUrl(conn.url);
    const existingCred = credentials?.find((c) => c.registryConnectionId === conn.id);
    setFormAuthType(existingCred?.authType ?? CredentialAuthType.None);
    setFormUsername(existingCred?.username ?? conn.username ?? '');
    setFormPassword('');
    setFormHeaderName(existingCred?.headerName ?? '');
    setDialogOpen(true);
  }

  function saveCredentialIfNeeded(connectionId: string) {
    if (formAuthType === CredentialAuthType.None) {
      // If switching to None, delete any existing credential
      const existingCred = credentials?.find((c) => c.registryConnectionId === connectionId);
      if (existingCred) {
        deleteCredentialMutation.mutate(existingCred.id);
      }
      return;
    }
    const existingCred = credentials?.find((c) => c.registryConnectionId === connectionId);
    if (existingCred) {
      updateCredentialMutation.mutate({
        id: existingCred.id,
        request: {
          authType: formAuthType,
          username: formUsername || undefined,
          password: formPassword || undefined,
          headerName: formHeaderName || undefined,
        },
      });
    } else if (formPassword) {
      createCredentialMutation.mutate({
        registryConnectionId: connectionId,
        authType: formAuthType,
        username: formUsername || undefined,
        password: formPassword,
        headerName: formHeaderName || undefined,
      });
    }
  }

  function handleSubmit() {
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, request: { name: formName, url: formUrl } },
        {
          onSuccess: () => {
            saveCredentialIfNeeded(editing.id);
            setDialogOpen(false);
          },
        },
      );
    } else {
      createMutation.mutate(
        { registryType: formType, name: formName, url: formUrl },
        {
          onSuccess: (response) => {
            saveCredentialIfNeeded(response.data.id);
            setDialogOpen(false);
          },
        },
      );
    }
  }

  function handleDelete() {
    if (!deleting) return;
    // Remove associated credential first (if any)
    const existingCred = credentials?.find((c) => c.registryConnectionId === deleting.id);
    if (existingCred) {
      deleteCredentialMutation.mutate(existingCred.id);
    }
    deleteMutation.mutate(deleting.id, { onSuccess: () => setDeleteDialogOpen(false) });
  }

  const hasCredential = (connId: string) => credentials?.some((c) => c.registryConnectionId === connId) ?? false;
  const isPending = createMutation.isPending || updateMutation.isPending;

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
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold">Registry Connections</CardTitle>
            <CardDescription>Connected container and package registries. Credentials are stored securely.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending || syncMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${syncAllMutation.isPending ? 'animate-spin' : ''}`} />
              Sync All
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Registry
            </Button>
          </div>
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
                      <Badge variant="secondary" className="text-[11px]">Default</Badge>
                    )}
                    {hasCredential(connection.id) && (
                      <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-label="Credentials configured" />
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

                <div className="ml-4 flex items-center gap-3">
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
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => syncMutation.mutate(connection.id)}
                      disabled={syncMutation.isPending || syncAllMutation.isPending}
                      title="Sync this registry"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(connection)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => { setDeleting(connection); setDeleteDialogOpen(true); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {connections?.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No registry connections configured. Add one to get started.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Registry Connection' : 'Add Registry Connection'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the endpoint and credentials for this registry.'
                : 'Enter the details of your registry server.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="regType">Registry Type</Label>
                <Select
                  value={String(formType)}
                  onValueChange={(v) => {
                    setFormType(Number(v) as RegistryType);
                    setFormUrl('');
                  }}
                >
                  <SelectTrigger id="regType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(RegistryType.Docker)}>Docker</SelectItem>
                    <SelectItem value={String(RegistryType.NuGet)}>NuGet</SelectItem>
                    <SelectItem value={String(RegistryType.NPM)}>NPM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="regName">Name</Label>
              <Input
                id="regName"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Production Docker Registry"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="regUrl">Endpoint URL</Label>
              <Input
                id="regUrl"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder={REGISTRY_TYPE_PLACEHOLDERS[formType]}
              />
              <p className="text-xs text-muted-foreground">
                The full URL of your registry server, including port if non-standard.
              </p>
            </div>
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Authentication</p>
              <div className="space-y-2">
                <Label htmlFor="regAuthType">Auth Type</Label>
                <Select
                  value={String(formAuthType)}
                  onValueChange={(v) => {
                    setFormAuthType(Number(v) as CredentialAuthType);
                    setFormUsername('');
                    setFormPassword('');
                    setFormHeaderName('');
                  }}
                >
                  <SelectTrigger id="regAuthType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(CredentialAuthType.None)}>None</SelectItem>
                    <SelectItem value={String(CredentialAuthType.BasicAuth)}>Basic Auth (username + password)</SelectItem>
                    <SelectItem value={String(CredentialAuthType.ApiKey)}>API Key (custom header)</SelectItem>
                    <SelectItem value={String(CredentialAuthType.BearerToken)}>Bearer Token</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formAuthType === CredentialAuthType.BasicAuth && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="regUsername">Username</Label>
                    <Input
                      id="regUsername"
                      value={formUsername}
                      onChange={(e) => setFormUsername(e.target.value)}
                      placeholder="e.g. service-account"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="regPassword">
                      Password
                      {editing && <span className="text-muted-foreground font-normal ml-1">(leave blank to keep current)</span>}
                    </Label>
                    <Input
                      id="regPassword"
                      type="password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder={editing ? '••••••••' : 'Enter password'}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}

              {formAuthType === CredentialAuthType.ApiKey && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="regHeaderName">Header Name</Label>
                    <Input
                      id="regHeaderName"
                      value={formHeaderName}
                      onChange={(e) => setFormHeaderName(e.target.value)}
                      placeholder="e.g. X-NuGet-ApiKey"
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">The HTTP header that carries the API key.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="regPassword">
                      API Key
                      {editing && <span className="text-muted-foreground font-normal ml-1">(leave blank to keep current)</span>}
                    </Label>
                    <Input
                      id="regPassword"
                      type="password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder={editing ? '••••••••' : 'Enter API key'}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}

              {formAuthType === CredentialAuthType.BearerToken && (
                <div className="space-y-2">
                  <Label htmlFor="regPassword">
                    Token
                    {editing && <span className="text-muted-foreground font-normal ml-1">(leave blank to keep current)</span>}
                  </Label>
                  <Input
                    id="regPassword"
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder={editing ? '••••••••' : 'Enter bearer token'}
                    autoComplete="new-password"
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!formName || !formUrl || isPending}
            >
              {isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Registry Connection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">{deleting?.name}</span>? This will also
              remove associated credentials and may affect linked packages.
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
