import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Shield, Calendar, Clock, Users, Pencil, Trash2, KeyRound } from 'lucide-react';
import { Role } from '@registry-vault/shared';
import { useAuth } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/shared/empty-state';
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
import { useUser, useUpdateUser, useDeleteUser, useChangeUserPassword } from '@/services/queries/rbac.queries';
import { formatRelativeTime, formatDate } from '@/lib/formatters';

const ROLE_LABELS: Record<Role, string> = {
  [Role.Admin]: 'Admin',
  [Role.Maintainer]: 'Maintainer',
  [Role.Reader]: 'Reader',
};

const ROLE_COLORS: Record<Role, string> = {
  [Role.Admin]: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  [Role.Maintainer]: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  [Role.Reader]: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

function getInitials(displayName: string): string {
  return displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  // Admin resetting another user's password doesn't need the current password
  const isAdminReset = currentUser?.role === Role.Admin && currentUser?.id !== userId;

  const { data: user, isLoading } = useUser(userId!);
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();
  const changePasswordMutation = useChangeUserPassword();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const [formEmail, setFormEmail] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formRole, setFormRole] = useState<Role>(Role.Reader);
  const [formIsActive, setFormIsActive] = useState(true);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  function openEdit() {
    if (!user) return;
    setFormEmail(user.email);
    setFormDisplayName(user.displayName);
    setFormRole(user.role);
    setFormIsActive(user.isActive);
    setEditOpen(true);
  }

  function handleEdit() {
    updateMutation.mutate(
      { id: userId!, request: { email: formEmail, displayName: formDisplayName, role: formRole, isActive: formIsActive } },
      { onSuccess: () => setEditOpen(false) },
    );
  }

  function handleDelete() {
    deleteMutation.mutate(userId!, {
      onSuccess: () => navigate('/access/users'),
    });
  }

  function openPasswordDialog() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordOpen(true);
  }

  function handleChangePassword() {
    if (newPassword !== confirmPassword) return;
    changePasswordMutation.mutate(
      { id: userId!, request: { currentPassword: currentPassword || undefined, newPassword } },
      { onSuccess: () => setPasswordOpen(false) },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/access/users')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/access/users')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="py-12 text-center text-muted-foreground">User not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate('/access/users')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Users
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openPasswordDialog}>
            <KeyRound className="h-4 w-4" /> Change Password
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openEdit}>
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg font-medium">
            {getInitials(user.displayName)}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{user.displayName}</h1>
          <p className="text-muted-foreground">@{user.username}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4" />
                Email
              </div>
              <span className="text-sm font-medium">{user.email}</span>
            </div>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                Role
              </div>
              <Badge variant="outline" className={`${ROLE_COLORS[user.role]} text-xs`}>
                {ROLE_LABELS[user.role]}
              </Badge>
            </div>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`}
                />
                Status
              </div>
              <Badge
                variant="outline"
                className={
                  user.isActive
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs'
                    : 'bg-gray-500/10 text-gray-500 border-gray-500/20 text-xs'
                }
              >
                {user.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Created
              </div>
              <span className="text-sm font-medium">{formatDate(user.createdAt)}</span>
            </div>
            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                Last Login
              </div>
              <span className="text-sm font-medium">
                {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : 'Never'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Teams
              <Badge variant="secondary" className="text-xs ml-auto">
                {user.teamIds.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {user.teamIds.length === 0 ? (
              <EmptyState title="No teams" description="This user is not a member of any team." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {user.teamIds.map((teamId) => (
                  <Badge
                    key={teamId}
                    variant="secondary"
                    className="cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => navigate(`/access/teams/${teamId}`)}
                  >
                    Team {teamId.slice(0, 8)}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user profile and role.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="editDisplayName">Display Name</Label>
              <Input id="editDisplayName" value={formDisplayName} onChange={(e) => setFormDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editEmail">Email</Label>
              <Input id="editEmail" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editRole">Role</Label>
              <Select value={String(formRole)} onValueChange={(v) => setFormRole(Number(v) as Role)}>
                <SelectTrigger id="editRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={String(Role.Reader)}>Reader</SelectItem>
                  <SelectItem value={String(Role.Maintainer)}>Maintainer</SelectItem>
                  <SelectItem value={String(Role.Admin)}>Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editStatus">Status</Label>
              <Select value={formIsActive ? 'active' : 'inactive'} onValueChange={(v) => setFormIsActive(v === 'active')}>
                <SelectTrigger id="editStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isAdminReset ? 'Reset Password' : 'Change Password'}</DialogTitle>
            <DialogDescription>
              {isAdminReset
                ? `Set a new password for @${user.username}. As an admin you do not need to know the current password.`
                : `Set a new password for @${user.username}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!isAdminReset && (
              <div className="space-y-2">
                <Label htmlFor="currentPwd">Current Password</Label>
                <Input id="currentPwd" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="newPwd">New Password</Label>
              <Input id="newPwd" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPwd">Confirm New Password</Label>
              <Input id="confirmPwd" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>Cancel</Button>
            <Button
              onClick={handleChangePassword}
              disabled={!newPassword || newPassword !== confirmPassword || changePasswordMutation.isPending}
            >
              {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-medium text-foreground">@{user.username}</span>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
