import { SetMetadata } from '@nestjs/common';
import { Role } from '@registry-vault/shared/enums';

export const ROLES_KEY = 'roles';
export const ANY_ROLE_KEY = 'anyRole';

/**
 * Restrict a route to the listed roles.
 *
 * Without it, `RolesGuard` requires an administrator for anything that is not a
 * GET or HEAD, so a new write route is closed until someone decides otherwise.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Opt a write route out of that admin-only default: any authenticated user may
 * call it. For routes that act on the caller themselves — logging out, changing
 * your own password — where the handler does its own ownership check.
 */
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true);
