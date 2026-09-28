import { useState } from 'react';
import { Plus, RotateCcw, Terminal, Trash2 } from 'lucide-react';
import type { IRegistryUser, RegistryUserRole } from '@registry-vault/shared';
import { RegistryType } from '@registry-vault/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CopyCommand } from '@/components/shared/copy-command';
import { EmptyState } from '@/components/shared/empty-state';
import { TableSkeleton } from '@/components/shared/loading-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useIsAdmin } from '@/hooks/use-is-admin';
import { useRegistryConnection } from '@/hooks/use-registry-connection';
import {
  agentErrorMessage,
  useCreateRegistryUser,
  useDeleteRegistryUser,
  useRegistryUsers,
  useUpdateRegistryUser,
} from '@/services/queries/agent.queries';
import { formatDateTime, formatRelativeTime, formatRelativeTimeOr } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { RegistryTabs } from '../components/registry-tabs';
import {
  AgentOfflineNotice,
  NoAgentEmptyState,
  featureReason,
  hasFeature,
} from '../components/agent-states';
import {
  PasswordRevealContent,
  RegistryUserPasswordDialog,
  type GeneratedCredentials,
} from '../components/registry-user-password-dialog';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const MIN_PASSWORD_LENGTH = 12;
const USERNAME_ERROR =
  'Use lowercase letters, numbers, dot, dash or underscore, 2–64 characters, starting with a letter or number.';

const ROLE_OPTIONS: readonly { value: RegistryUserRole; label: string }[] = [
  { value: 'pull', label: 'pull — pull images only' },
  { value: 'push', label: 'push — pull and push images' },
  { value: 'admin', label: 'admin — pull, push, delete tags and list the catalog' },
] as const;

type PendingConfirm =
  | { kind: 'role'; user: IRegistryUser; nextRole: RegistryUserRole }
  | { kind: 'reset'; user: IRegistryUser }
  | { kind: 'delete'; user: IRegistryUser };

function RoleBadge({ role }: { role: RegistryUserRole }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono text-[11px]',
        role === 'admin' &&
          'border-[hsl(var(--severity-medium))]/40 text-[hsl(var(--severity-medium))]',
      )}
    >
      {role}
    </Badge>
  );
}

export default function RegistryUsersPage() {
  const { connectionId, connection } = useRegistryConnection();
  const isAdmin = useIsAdmin();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<RegistryUserRole>('push');
  const [shouldGenerate, setShouldGenerate] = useState(true);
  const [newPassword, setNewPassword] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [addDialogCredentials, setAddDialogCredentials] = useState<GeneratedCredentials | null>(null);
  const [resetCredentials, setResetCredentials] = useState<GeneratedCredentials | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const hasUsersFeature = hasFeature(connection, 'users');
  const users = useRegistryUsers(connectionId, hasUsersFeature && isAdmin);
  const createUser = useCreateRegistryUser(connectionId ?? '');
  const updateUser = useUpdateRegistryUser(connectionId ?? '');
  const deleteUser = useDeleteRegistryUser(connectionId ?? '');

  if (!connection) return <TableSkeleton rows={4} />;

  const hasAgent = connection.registryType === RegistryType.Docker && !!connection.agent;
  if (!hasAgent) {
    return (
      <div className="space-y-6">
        <PageHeader title="Registry logins" />
        <NoAgentEmptyState connectionId={connectionId!} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <RegistryTabs connectionId={connectionId!} connection={connection} />
        <PageHeader title="Registry logins" />
        <EmptyState
          icon={<Terminal className="h-6 w-6 text-muted-foreground" />}
          title="Registry logins are administrator-only"
          description="These are credentials that can push to and pull from the registry. Ask an administrator if you need one."
        />
      </div>
    );
  }

  if (!hasUsersFeature) {
    return (
      <div className="space-y-6">
        <RegistryTabs connectionId={connectionId!} connection={connection} />
        <PageHeader title="Registry logins" />
        <EmptyState
          icon={<Terminal className="h-6 w-6 text-muted-foreground" />}
          title="Registry logins are not in use"
          description={featureReason('users')}
        />
      </div>
    );
  }

  function resetAddForm() {
    setNewUsername('');
    setNewRole('push');
    setShouldGenerate(true);
    setNewPassword('');
    setCreateError(null);
    setAddDialogCredentials(null);
  }

  function handleCreate() {
    setCreateError(null);
    createUser.mutate(
      {
        username: newUsername,
        role: newRole,
        password: shouldGenerate ? undefined : newPassword,
      },
      {
        onSuccess: (response) => {
          const generated = response.data.password;
          if (!generated) {
            setIsAddOpen(false);
            resetAddForm();
            return;
          }
          // Swap this dialog's content rather than closing it, so the list does
          // not flash between the form and the one-time password.
          setAddDialogCredentials({ username: response.data.user.username, password: generated });
        },
        onError: (error: Error) => setCreateError(agentErrorMessage(error)),
      },
    );
  }

  function handleConfirm() {
    if (!pendingConfirm) return;
    const confirmation = pendingConfirm;
    setPendingConfirm(null);

    switch (confirmation.kind) {
      case 'role':
        updateUser.mutate({
          username: confirmation.user.username,
          request: { role: confirmation.nextRole },
        });
        return;
      case 'reset':
        updateUser.mutate(
          { username: confirmation.user.username, request: { resetPassword: true } },
          {
            onSuccess: (response) => {
              if (!response.data.password) return;
              setResetCredentials({
                username: response.data.user.username,
                password: response.data.password,
              });
            },
          },
        );
        return;
      case 'delete':
        deleteUser.mutate(confirmation.user.username);
        return;
      default: {
        const exhaustive: never = confirmation;
        throw new Error(`Unhandled confirmation: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  function handleRoleChange(user: IRegistryUser, nextRole: RegistryUserRole) {
    if (nextRole === user.role) return;
    // Admin can delete tags and read the catalogue — both directions get a stop.
    if (nextRole === 'admin' || user.role === 'admin') {
      setPendingConfirm({ kind: 'role', user, nextRole });
      return;
    }
    updateUser.mutate({ username: user.username, request: { role: nextRole } });
  }

  const isUsernameValid = USERNAME_PATTERN.test(newUsername);
  const isPasswordValid = shouldGenerate || newPassword.length >= MIN_PASSWORD_LENGTH;
  const rows = users.data ?? [];

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <RegistryTabs connectionId={connectionId!} connection={connection} />

        <PageHeader
          title="Registry logins"
          description="Accounts that can docker login to this registry. These are not Registry Vault users — they have no access to this web app."
        >
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              resetAddForm();
              setIsAddOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add login
          </Button>
        </PageHeader>

        <CopyCommand command={`docker login ${connection.url}`} />

        {users.isError && (
          <AgentOfflineNotice
            agentUrl={connection.agent?.url}
            message={agentErrorMessage(users.error)}
            onRetry={() => void users.refetch()}
          />
        )}

        {users.isLoading ? (
          <TableSkeleton rows={4} />
        ) : rows.length === 0 && !users.isError ? (
          <EmptyState
            icon={<Terminal className="h-6 w-6 text-muted-foreground" />}
            title="No registry logins yet"
            description="Create one so CI and developers can docker login to this registry."
            action={
              <Button
                onClick={() => {
                  resetAddForm();
                  setIsAddOpen(true);
                }}
              >
                Add login
              </Button>
            }
          />
        ) : (
          <Table>
            <caption className="sr-only">
              Registry logins for {connection.name}
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 sm:px-4">Username</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="hidden sm:table-cell">Last used</TableHead>
                <TableHead className="px-2 text-right sm:px-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => (
                <TableRow key={user.username}>
                  <TableCell className="px-2 sm:px-4">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-mono text-sm">{user.username}</span>
                    </div>
                    <p className="text-xs text-muted-foreground sm:hidden">
                      created {formatRelativeTime(user.createdAt)} · used{' '}
                      {formatRelativeTimeOr(user.lastUsedAt, 'never')}
                    </p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <RoleBadge role={user.role} />
                  </TableCell>
                  <TableCell
                    className="hidden md:table-cell"
                    title={formatDateTime(user.createdAt)}
                  >
                    {formatRelativeTime(user.createdAt)}
                  </TableCell>
                  <TableCell
                    className={cn('hidden sm:table-cell', !user.lastUsedAt && 'text-muted-foreground')}
                    title={user.lastUsedAt ? formatDateTime(user.lastUsedAt) : undefined}
                  >
                    {formatRelativeTimeOr(user.lastUsedAt)}
                  </TableCell>
                  <TableCell className="px-2 sm:px-4">
                    <div className="flex items-center justify-end gap-1">
                      <Select
                        value={user.role}
                        onValueChange={(value) => handleRoleChange(user, value as RegistryUserRole)}
                      >
                        <SelectTrigger
                          className="h-8 w-[92px] text-xs"
                          aria-label={`Role for ${user.username}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pull">pull</SelectItem>
                          <SelectItem value="push">push</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 sm:h-8 sm:w-8"
                        aria-label={`Reset password for ${user.username}`}
                        title="Reset password"
                        onClick={() => setPendingConfirm({ kind: 'reset', user })}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive hover:text-destructive sm:h-8 sm:w-8"
                        aria-label={`Delete ${user.username}`}
                        title="Delete login"
                        onClick={() => setPendingConfirm({ kind: 'delete', user })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Add login — becomes the one-time reveal once the agent generates a password */}
        <Dialog
          open={isAddOpen}
          onOpenChange={(open) => {
            if (!open && addDialogCredentials) {
              // Dismissed without the explicit button, with a password on screen.
              setIsAddOpen(false);
              resetAddForm();
              return;
            }
            setIsAddOpen(open);
            if (!open) resetAddForm();
          }}
        >
          <DialogContent
            className={cn('max-h-[85vh] overflow-y-auto sm:max-w-lg', addDialogCredentials && '[&>button]:hidden')}
          >
            {addDialogCredentials ? (
              <PasswordRevealContent
                credentials={addDialogCredentials}
                registryUrl={connection.url}
                onDone={() => {
                  setIsAddOpen(false);
                  resetAddForm();
                }}
              />
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Add registry login</DialogTitle>
                  <DialogDescription>
                    Creates an account that can docker login to {connection.name}.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="newUsername">Username</Label>
                    <Input
                      id="newUsername"
                      value={newUsername}
                      autoComplete="off"
                      aria-invalid={newUsername.length > 0 && !isUsernameValid}
                      aria-describedby="newUsernameHelp"
                      onChange={(event) => setNewUsername(event.target.value)}
                      placeholder="e.g. ci"
                    />
                    <p
                      id="newUsernameHelp"
                      className={cn(
                        'text-xs',
                        newUsername.length > 0 && !isUsernameValid
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                      )}
                    >
                      {newUsername.length > 0 && !isUsernameValid
                        ? USERNAME_ERROR
                        : 'Lowercase letters, numbers, dot, dash and underscore. 2–64 characters.'}
                    </p>
                    {createError && <p className="text-xs text-destructive">{createError}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="newRole">Role</Label>
                    <Select value={newRole} onValueChange={(value) => setNewRole(value as RegistryUserRole)}>
                      <SelectTrigger id="newRole">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="generatePassword">Generate a password for me</Label>
                      <p className="text-xs text-muted-foreground">
                        The password is shown once after the account is created.
                      </p>
                    </div>
                    <Switch
                      id="generatePassword"
                      checked={shouldGenerate}
                      onCheckedChange={setShouldGenerate}
                    />
                  </div>

                  {!shouldGenerate && (
                    <div className="space-y-1.5">
                      <Label htmlFor="newPassword">Password</Label>
                      <Input
                        id="newPassword"
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        aria-invalid={newPassword.length > 0 && !isPasswordValid}
                        aria-describedby="newPasswordHelp"
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                      <p
                        id="newPasswordHelp"
                        className={cn(
                          'text-xs',
                          newPassword.length > 0 && !isPasswordValid
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                        )}
                      >
                        At least {MIN_PASSWORD_LENGTH} characters.
                      </p>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={!isUsernameValid || !isPasswordValid || createUser.isPending}
                  >
                    {createUser.isPending ? 'Creating…' : 'Create login'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        <RegistryUserPasswordDialog
          credentials={resetCredentials}
          registryUrl={connection.url}
          onClose={() => setResetCredentials(null)}
        />

        <Dialog open={!!pendingConfirm} onOpenChange={(open) => !open && setPendingConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {pendingConfirm?.kind === 'delete' && `Delete ${pendingConfirm.user.username}?`}
                {pendingConfirm?.kind === 'reset' &&
                  `Reset the password for ${pendingConfirm.user.username}?`}
                {pendingConfirm?.kind === 'role' &&
                  (pendingConfirm.nextRole === 'admin'
                    ? `Give ${pendingConfirm.user.username} the admin role?`
                    : `Remove admin from ${pendingConfirm.user.username}?`)}
              </DialogTitle>
              <DialogDescription>
                {pendingConfirm?.kind === 'delete' &&
                  `It can no longer pull from or push to ${connection.name}. Images it pushed are not affected.`}
                {pendingConfirm?.kind === 'reset' &&
                  'The current password stops working immediately. Anything using it — CI, a server, a local docker login — fails until it is updated.'}
                {pendingConfirm?.kind === 'role' &&
                  (pendingConfirm.nextRole === 'admin'
                    ? 'Admin can delete tags and list the whole catalog, on top of pull and push.'
                    : 'It will no longer be able to delete tags or list the catalog. Anything automated that relies on that will start failing.')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button autoFocus variant="outline" onClick={() => setPendingConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant={pendingConfirm?.kind === 'role' ? 'default' : 'destructive'}
                onClick={handleConfirm}
              >
                {pendingConfirm?.kind === 'delete' && 'Delete'}
                {pendingConfirm?.kind === 'reset' && 'Reset password'}
                {pendingConfirm?.kind === 'role' && 'Change role'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
