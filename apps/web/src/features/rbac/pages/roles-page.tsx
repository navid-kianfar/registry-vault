import { Shield, Lock } from 'lucide-react';
import { Permission, Role, ROLE_DEFINITIONS } from '@registryvault/shared';
import type { IRoleDefinition } from '@registryvault/shared';
import { PageHeader } from '@/components/shared/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.RegistryRead]: 'Registry Read',
  [Permission.RegistryWrite]: 'Registry Write',
  [Permission.RegistryDelete]: 'Registry Delete',
  [Permission.RegistryAdmin]: 'Registry Admin',
  [Permission.UserManage]: 'User Manage',
  [Permission.TeamManage]: 'Team Manage',
  [Permission.SettingsManage]: 'Settings Manage',
  [Permission.AuditLogRead]: 'Audit Log Read',
  [Permission.WebhookManage]: 'Webhook Manage',
};

const ROLE_COLORS: Record<Role, string> = {
  [Role.Admin]: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  [Role.Maintainer]: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  [Role.Reader]: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

const ROLE_ICON_BG: Record<Role, string> = {
  [Role.Admin]: 'bg-blue-500/10',
  [Role.Maintainer]: 'bg-emerald-500/10',
  [Role.Reader]: 'bg-gray-500/10',
};

const ROLE_ICON_TEXT: Record<Role, string> = {
  [Role.Admin]: 'text-blue-600',
  [Role.Maintainer]: 'text-emerald-600',
  [Role.Reader]: 'text-gray-600',
};

const PERMISSION_COLORS: Record<Permission, string> = {
  [Permission.RegistryRead]: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  [Permission.RegistryWrite]: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  [Permission.RegistryDelete]: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  [Permission.RegistryAdmin]: 'bg-red-500/10 text-red-600 border-red-500/20',
  [Permission.UserManage]: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  [Permission.TeamManage]: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  [Permission.SettingsManage]: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  [Permission.AuditLogRead]: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  [Permission.WebhookManage]: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
};

function RoleCard({ definition }: { definition: IRoleDefinition }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-base">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${ROLE_ICON_BG[definition.role]}`}>
            <Shield className={`h-5 w-5 ${ROLE_ICON_TEXT[definition.role]}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{definition.label}</span>
              <Badge variant="outline" className={`${ROLE_COLORS[definition.role]} text-xs`}>
                {definition.permissions.length} {definition.permissions.length === 1 ? 'permission' : 'permissions'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground font-normal mt-0.5">
              {definition.description}
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Permissions</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {definition.permissions.map((permission) => (
            <Badge
              key={permission}
              variant="outline"
              className={`${PERMISSION_COLORS[permission]} text-xs px-2 py-0.5`}
            >
              {PERMISSION_LABELS[permission]}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function RolesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="View role definitions and their associated permissions."
      />

      <div className="space-y-4">
        {ROLE_DEFINITIONS.map((definition) => (
          <RoleCard key={definition.role} definition={definition} />
        ))}
      </div>
    </div>
  );
}
