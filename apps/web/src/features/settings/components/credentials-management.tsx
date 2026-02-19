import { useState } from 'react';
import { KeyRound, Plus, Pencil, Trash2, Shield, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
  useRegistryCredentials,
  useCreateCredential,
  useUpdateCredential,
  useDeleteCredential,
} from '@/services/queries/auth.queries';
import { useRegistryConnections } from '@/services/queries/settings.queries';
import { formatRelativeTime } from '@/lib/formatters';
import type { IRegistryCredential } from '@registryvault/shared';

function CredentialRow({
  credential,
  onEdit,
  onDelete,
}: {
  credential: IRegistryCredential;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <KeyRound className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{credential.registryName}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Shield className="h-3 w-3" />
            {credential.username}
          </span>
          {credential.lastUsedAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last used {formatRelativeTime(credential.lastUsedAt)}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function CredentialsManagement() {
  const { data: credentials, isLoading } = useRegistryCredentials();
  const { data: connections } = useRegistryConnections();
  const createMutation = useCreateCredential();
  const updateMutation = useUpdateCredential();
  const deleteMutation = useDeleteCredential();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<IRegistryCredential | null>(null);
  const [deletingCredential, setDeletingCredential] = useState<IRegistryCredential | null>(null);

  const [formConnectionId, setFormConnectionId] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');

  function openCreate() {
    setEditingCredential(null);
    setFormConnectionId('');
    setFormUsername('');
    setFormPassword('');
    setDialogOpen(true);
  }

  function openEdit(cred: IRegistryCredential) {
    setEditingCredential(cred);
    setFormConnectionId(cred.registryConnectionId);
    setFormUsername(cred.username);
    setFormPassword('');
    setDialogOpen(true);
  }

  function openDelete(cred: IRegistryCredential) {
    setDeletingCredential(cred);
    setDeleteDialogOpen(true);
  }

  function handleSubmit() {
    if (editingCredential) {
      updateMutation.mutate(
        { id: editingCredential.id, request: { username: formUsername, ...(formPassword ? { password: formPassword } : {}) } },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createMutation.mutate(
        { registryConnectionId: formConnectionId, username: formUsername, password: formPassword },
        { onSuccess: () => setDialogOpen(false) },
      );
    }
  }

  function handleDelete() {
    if (!deletingCredential) return;
    deleteMutation.mutate(deletingCredential.id, {
      onSuccess: () => setDeleteDialogOpen(false),
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Registry Credentials</h3>
          <p className="text-xs text-muted-foreground">Manage authentication credentials for your registry connections.</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Credential
        </Button>
      </div>

      {!credentials?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <KeyRound className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No credentials configured</p>
            <p className="text-xs text-muted-foreground mt-1">Add credentials to authenticate with your registries.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {credentials.map((cred) => (
            <CredentialRow
              key={cred.id}
              credential={cred}
              onEdit={() => openEdit(cred)}
              onDelete={() => openDelete(cred)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCredential ? 'Edit Credential' : 'Add Credential'}</DialogTitle>
            <DialogDescription>
              {editingCredential
                ? 'Update the credential for this registry connection.'
                : 'Add authentication credentials for a registry connection.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="connection">Registry Connection</Label>
              <Select
                value={formConnectionId}
                onValueChange={setFormConnectionId}
                disabled={!!editingCredential}
              >
                <SelectTrigger id="connection">
                  <SelectValue placeholder="Select a registry..." />
                </SelectTrigger>
                <SelectContent>
                  {connections?.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id}>
                      {conn.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="Enter username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">
                Password
                {editingCredential && (
                  <span className="text-muted-foreground font-normal ml-1">(leave blank to keep current)</span>
                )}
              </Label>
              <Input
                id="password"
                type="password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder={editingCredential ? '••••••••' : 'Enter password'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !formUsername || (!editingCredential && (!formConnectionId || !formPassword)) ||
                createMutation.isPending || updateMutation.isPending
              }
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Credential</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the credential for{' '}
              <span className="font-medium text-foreground">{deletingCredential?.registryName}</span>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
