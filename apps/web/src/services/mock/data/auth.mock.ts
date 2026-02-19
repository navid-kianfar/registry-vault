import type { IAuthUser, IRegistryCredential } from '@registryvault/shared';
import { Role } from '@registryvault/shared';

// Simulates env-based admin credentials (in real backend, would come from process.env)
export const ADMIN_CREDENTIALS = { username: 'admin', password: 'admin123' };

export const mockAuthUsers: Array<IAuthUser & { password: string }> = [
  {
    id: 'auth-1',
    username: 'admin',
    email: 'admin@registryvault.io',
    displayName: 'Admin User',
    role: Role.Admin,
    password: 'admin123',
  },
  {
    id: 'auth-2',
    username: 'john.doe',
    email: 'john@myorg.io',
    displayName: 'John Doe',
    role: Role.Maintainer,
    password: 'password',
  },
  {
    id: 'auth-3',
    username: 'viewer',
    email: 'viewer@myorg.io',
    displayName: 'Read Only',
    role: Role.Reader,
    password: 'password',
  },
];

export const registryCredentials: IRegistryCredential[] = [
  {
    id: 'cred-1',
    registryConnectionId: 'conn-1',
    registryName: 'Primary Docker Registry',
    username: 'registry-admin',
    createdAt: '2025-06-15T10:00:00Z',
    updatedAt: '2026-01-15T14:00:00Z',
    lastUsedAt: '2026-02-19T08:15:00Z',
  },
  {
    id: 'cred-2',
    registryConnectionId: 'conn-2',
    registryName: 'Internal NuGet Feed',
    username: 'nuget-service',
    createdAt: '2025-06-15T10:00:00Z',
    updatedAt: '2025-12-01T09:00:00Z',
    lastUsedAt: '2026-02-19T07:55:12Z',
  },
  {
    id: 'cred-3',
    registryConnectionId: 'conn-3',
    registryName: 'Private NPM Registry',
    username: 'npm-service',
    createdAt: '2025-06-15T10:00:00Z',
    updatedAt: '2026-02-01T11:00:00Z',
    lastUsedAt: '2026-02-19T06:45:00Z',
  },
];
