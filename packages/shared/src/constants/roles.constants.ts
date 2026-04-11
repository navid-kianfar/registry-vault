import { Role, Permission } from '../enums';
import type { IRoleDefinition } from '../interfaces';

export const ROLE_DEFINITIONS: IRoleDefinition[] = [
  {
    role: Role.Admin,
    label: 'Admin',
    description: 'Full access to all resources and settings',
    permissions: [
      Permission.RegistryRead,
      Permission.RegistryWrite,
      Permission.RegistryDelete,
      Permission.RegistryAdmin,
      Permission.UserManage,
      Permission.TeamManage,
      Permission.SettingsManage,
      Permission.AuditLogRead,
      Permission.WebhookManage,
    ],
  },
  {
    role: Role.Maintainer,
    label: 'Maintainer',
    description: 'Read/write access to registries and packages',
    permissions: [
      Permission.RegistryRead,
      Permission.RegistryWrite,
      Permission.AuditLogRead,
    ],
  },
  {
    role: Role.Reader,
    label: 'Reader',
    description: 'Read-only access to registries and packages',
    permissions: [
      Permission.RegistryRead,
    ],
  },
];
