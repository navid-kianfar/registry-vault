import { Role } from '@registry-vault/shared';
import { useAuth } from '@/providers/auth-provider';

/** Most writes — settings, registries, retention, bulk operations, agent — are administrator-only. */
export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.role === Role.Admin;
}

/**
 * Curating image content — requesting a scan, deleting a single tag — is open
 * to Maintainers as well as Admins; the API answers 403 for Readers. Kept
 * separate from `useIsAdmin` so the two permissions cannot drift apart.
 */
export function useCanCurate(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return user.role === Role.Admin || user.role === Role.Maintainer;
}
