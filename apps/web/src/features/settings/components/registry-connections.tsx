import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RegistryBadge } from '@/components/shared/registry-badge';
import { ExternalLink, User, Plus, Pencil, Trash2, KeyRound, RefreshCw, Stethoscope, Wrench } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentStatusBadge } from '@/components/shared/agent-status-badge';
import { Notice } from '@/components/shared/notice';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { useTestAgent } from '@/services/queries/agent.queries';
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
import { useRepairRegistry } from '@/services/queries/bulk-operations.queries';
import type { IRegistryConnection, IRegistryRepairResult } from '@registry-vault/shared';

/** The agent refuses to start below this, so a shorter key can never work. */
const MIN_AGENT_KEY_LENGTH = 16;

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

  const repairMutation = useRepairRegistry();
  const [repairDialogOpen, setRepairDialogOpen] = useState(false);
  const [repairing, setRepairing] = useState<IRegistryConnection | null>(null);
  const [repairScan, setRepairScan] = useState<IRegistryRepairResult | null>(null);

  const [formType, setFormType] = useState<RegistryType>(RegistryType.Docker);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formAuthType, setFormAuthType] = useState<CredentialAuthType>(CredentialAuthType.None);
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formHeaderName, setFormHeaderName] = useState('');
  const [formAgentUrl, setFormAgentUrl] = useState('');
  const [formAgentKey, setFormAgentKey] = useState('');

  const isAdmin = useIsAdmin();
  const testAgent = useTestAgent();
  const [searchParams, setSearchParams] = useSearchParams();

  function openCreate() {
    setEditing(null);
    setFormType(RegistryType.Docker);
    setFormName('');
    setFormUrl('');
    setFormAuthType(CredentialAuthType.None);
    setFormUsername('');
    setFormPassword('');
    setFormHeaderName('');
    setFormAgentUrl('');
    setFormAgentKey('');
    testAgent.reset();
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
    setFormAgentUrl(conn.agent?.url ?? '');
    setFormAgentKey('');
    testAgent.reset();
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
    const isDocker = formType === RegistryType.Docker;
    // An empty agent URL on a connection that had one removes the agent; an
    // empty key means "keep the stored one", so it is omitted rather than sent.
    const agentFields = isDocker
      ? {
          agentUrl: editing?.agent || formAgentUrl ? formAgentUrl : undefined,
          agentApiKey: formAgentKey || undefined,
        }
      : {};

    if (editing) {
      updateMutation.mutate(
        { id: editing.id, request: { name: formName, url: formUrl, ...agentFields } },
        {
          onSuccess: () => {
            saveCredentialIfNeeded(editing.id);
            closeDialog();
          },
        },
      );
    } else {
      createMutation.mutate(
        { registryType: formType, name: formName, url: formUrl, ...agentFields },
        {
          onSuccess: (response) => {
            saveCredentialIfNeeded(response.data.id);
            closeDialog();
          },
        },
      );
    }
  }

  function closeDialog() {
    setDialogOpen(false);
    // Drop the deep-link parameter so a refresh does not reopen the dialog.
    if (searchParams.has('edit')) {
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }

  function handleTestAgent() {
    testAgent.mutate({
      connectionId: editing?.id,
      request: { url: formAgentUrl, apiKey: formAgentKey || undefined },
    });
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

  function handleRepairDialogChange(open: boolean) {
    setRepairDialogOpen(open);
    if (!open) {
      setRepairing(null);
      setRepairScan(null);
    }
  }

  /** `apply: false` reports what is broken; `true` deletes those tags. */
  function handleRepairScan(apply: boolean) {
    if (!repairing) return;
    repairMutation.mutate(
      { registryConnectionId: repairing.id, apply },
      {
        onSuccess: (response) => {
          // After a repair, keep the (now empty) result so the dialog shows
          // what is left rather than a stale pre-repair list.
          setRepairScan(response.data);
        },
      },
    );
  }

  const hasCredential = (connId: string) => credentials?.some((c) => c.registryConnectionId === connId) ?? false;
  const isPending = createMutation.isPending || updateMutation.isPending;

  const editParam = searchParams.get('edit');
  // Every "Set up an agent" action in the app lands here with ?edit=<id>.
  useEffect(() => {
    if (!editParam || !connections) return;
    const target = connections.find((conn) => conn.id === editParam);
    if (!target) return;
    setEditing((current) => {
      if (current?.id === target.id) return current;
      setFormType(target.registryType);
      setFormName(target.name);
      setFormUrl(target.url);
      setFormAgentUrl(target.agent?.url ?? '');
      setFormAgentKey('');
      setDialogOpen(true);
      return target;
    });
  }, [editParam, connections]);

  const isAgentKeyTooShort = formAgentKey.length > 0 && formAgentKey.length < MIN_AGENT_KEY_LENGTH;
  // The API refuses an agent URL change that does not carry the key again: it
  // cannot know the stored key still belongs to the new address.
  const hasAgentUrlChanged =
    formType === RegistryType.Docker && formAgentUrl !== (editing?.agent?.url ?? '');
  const isAgentKeyRequired = hasAgentUrlChanged && formAgentUrl.length > 0;
  const isAgentKeyMissing = isAgentKeyRequired && formAgentKey.length === 0;
  // Changing where the registry lives invalidates the secret stored against it.
  const hasRegistryUrlChanged = !!editing && formUrl !== editing.url;

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
    <TooltipProvider>
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
                    {connection.isEmbedded && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                            <Badge variant="outline" className="text-[11px]">Embedded</Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          This registry runs inside the Registry Vault container. Its address and
                          agent key come from the container's environment.
                        </TooltipContent>
                      </Tooltip>
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
                  {connection.registryType === RegistryType.Docker && (
                    connection.agent ? (
                      <AgentStatusBadge agent={connection.agent} showVersion />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No agent — pull counts, garbage collection and scans are unavailable.{' '}
                        <button
                          type="button"
                          onClick={() => openEdit(connection)}
                          className="rounded text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          Add one
                        </button>
                      </p>
                    )
                  )}
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
                      aria-label={`Sync ${connection.name}`}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                    </Button>
                    {connection.registryType === RegistryType.Docker && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => { setRepairing(connection); setRepairDialogOpen(true); }}
                        title="Scan for half-deleted tags"
                        aria-label={`Scan ${connection.name} for half-deleted tags`}
                      >
                        <Stethoscope className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {connection.agent && (
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={`Open maintenance for ${connection.name}`}
                        aria-label={`Open maintenance for ${connection.name}`}
                      >
                        <Link to={`/registry/${connection.id}/maintenance`}>
                          <Wrench className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(connection)}
                      title={`Edit ${connection.name}`}
                      aria-label={`Edit ${connection.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {/* An embedded registry comes from the container's env: no
                        delete could ever succeed, so none is offered. */}
                    {!connection.isEmbedded && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => { setDeleting(connection); setDeleteDialogOpen(true); }}
                        title={`Delete ${connection.name}`}
                        aria-label={`Delete ${connection.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
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
      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
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
              {hasRegistryUrlChanged && (
                <Notice tone="warning">
                  Saving a new URL clears the stored credential for this registry. Re-enter its
                  password or token under Authentication below, or the next sync will fail.
                </Notice>
              )}
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
            {formType === RegistryType.Docker && (
              <div className="border-t pt-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Registry agent (optional)
                </p>

                <div className="space-y-2">
                  <Label htmlFor="agentUrl">Agent URL</Label>
                  <Input
                    id="agentUrl"
                    value={formAgentUrl}
                    disabled={editing?.isEmbedded}
                    readOnly={editing?.isEmbedded}
                    onChange={(e) => setFormAgentUrl(e.target.value)}
                    placeholder="http://registry:5080"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    The agent's management API. It is reached by Registry Vault, not by your
                    browser, so an internal address is fine.
                  </p>
                  {editing?.agent && !formAgentUrl && (
                    <Notice tone="warning">
                      Saving with an empty URL removes the agent from this connection. Pull counts
                      and scan results already collected are kept.
                    </Notice>
                  )}
                </div>

                {isAdmin && (
                  <div className="space-y-2">
                    <Label htmlFor="agentApiKey">
                      API Key
                      {editing?.agent && !isAgentKeyRequired && (
                        <span className="text-muted-foreground font-normal ml-1">(leave blank to keep current)</span>
                      )}
                      {isAgentKeyRequired && (
                        <span className="text-muted-foreground font-normal ml-1">(required)</span>
                      )}
                    </Label>
                    <Input
                      id="agentApiKey"
                      type="password"
                      value={formAgentKey}
                      disabled={editing?.isEmbedded}
                      readOnly={editing?.isEmbedded}
                      onChange={(e) => setFormAgentKey(e.target.value)}
                      placeholder={editing?.agent ? '••••••••' : 'Enter the agent API key'}
                      autoComplete="new-password"
                      aria-invalid={isAgentKeyTooShort || isAgentKeyMissing}
                      aria-describedby="agentApiKeyHelp"
                    />
                    <p
                      id="agentApiKeyHelp"
                      className={`text-xs ${isAgentKeyTooShort || isAgentKeyMissing ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {isAgentKeyTooShort
                        ? `The agent requires a key of at least ${MIN_AGENT_KEY_LENGTH} characters.`
                        : isAgentKeyMissing
                          ? 'Enter the API key for this agent — changing the agent URL requires it, because the stored key belongs to the old address.'
                          : 'Stored encrypted. It is never sent back to the browser.'}
                    </p>
                  </div>
                )}

                {editing?.isEmbedded && (
                  <p className="text-xs text-muted-foreground">
                    Set by the container's environment (AGENT_API_KEY). Change it there and restart.
                  </p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    disabled={!formAgentUrl || testAgent.isPending}
                    onClick={handleTestAgent}
                  >
                    <Stethoscope className="h-4 w-4" />
                    {testAgent.isPending ? 'Testing…' : 'Test agent'}
                  </Button>

                  {testAgent.isSuccess && testAgent.data && (
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm">
                        <span className="font-medium">Agent online</span>
                        <span className="text-muted-foreground">
                          {' '}· v{testAgent.data.data.version} · registry {testAgent.data.data.registryVersion}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {testAgent.data.data.features.map((feature) => (
                          <Badge key={feature} variant="outline" className="px-1 py-0 font-mono text-[10px]">
                            {feature}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {testAgent.isError && (
                    <p className="text-sm text-destructive">
                      Could not reach the agent — {testAgent.error.message}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!formName || !formUrl || isAgentKeyTooShort || isAgentKeyMissing || isPending}
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

      {/* Repair half-deleted tags */}
      <Dialog open={repairDialogOpen} onOpenChange={handleRepairDialogChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Repair Half-Deleted Tags</DialogTitle>
            <DialogDescription>
              Scans <span className="font-medium text-foreground">{repairing?.name}</span> for tags
              whose image content is missing — they still appear in the registry but cannot be
              pulled. Repairing deletes those tags. Nothing is deleted until you confirm.
            </DialogDescription>
          </DialogHeader>

          {repairScan && (
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
              {repairScan.applied ? (
                <>
                  <p className="text-sm">
                    Repaired <span className="font-medium">{repairScan.repairedTags}</span> tag(s)
                    across {repairScan.repositories.length} repositories.
                  </p>
                  {repairScan.failures.map((failure) => (
                    <div key={`${failure.repository}:${failure.tag}`} className="text-xs text-destructive">
                      <span className="font-mono">{failure.repository}:{failure.tag}</span> — {failure.reason}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Disk space is reclaimed when the registry next garbage-collects.
                  </p>
                </>
              ) : repairScan.danglingTags === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Scanned {repairScan.scannedRepositories} repositories — nothing to repair.
                </p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="font-medium">{repairScan.danglingTags}</span> half-deleted tag(s)
                    across {repairScan.repositories.length} repositories:
                  </p>
                  {repairScan.repositories.map((repo) => (
                    <div key={repo.repository} className="text-xs">
                      <span className="font-mono font-medium">{repo.repository}</span>
                      <span className="text-muted-foreground"> — {repo.danglingTags.length} tag(s)</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => handleRepairDialogChange(false)}>Close</Button>
            <Button
              variant="outline"
              onClick={() => handleRepairScan(false)}
              disabled={repairMutation.isPending}
            >
              {repairMutation.isPending ? 'Scanning...' : 'Scan'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleRepairScan(true)}
              disabled={
                repairMutation.isPending ||
                !repairScan ||
                repairScan.applied ||
                repairScan.danglingTags === 0
              }
            >
              {repairScan && !repairScan.applied && repairScan.danglingTags > 0
                ? `Delete ${repairScan.danglingTags} tag(s)`
                : 'Repair'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
