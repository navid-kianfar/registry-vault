import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@registry-vault/shared/enums';

import { ANY_ROLE_KEY, ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

interface RequestWithUser {
  method: string;
  user?: { userId: string; username: string; role: Role };
}

/** Methods that only read. Everything else is a write and defaults to admin-only. */
const READ_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'] as const;

/**
 * Authorization for every route, registered globally after the JWT guard.
 *
 * The default is deny: anything that is not a GET or HEAD needs an
 * administrator unless the route says otherwise with `@Roles(...)` or
 * `@AnyRole()`. A write route added later is therefore closed until someone
 * chooses to open it, rather than open until someone notices.
 *
 * Reads stay available to any authenticated user unless decorated — a handful
 * of them return secrets and carry `@Roles(Role.Admin)` for that reason.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // `@Public()` routes (login, health) never reach authentication, so there
    // is no role to check; the JWT guard has already let them through.
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.resolveRequiredRoles(context);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const role = request.user?.role;

    if (role === undefined || !required.includes(role)) {
      throw new ForbiddenException(
        required.length === 1 && required[0] === Role.Admin
          ? 'This operation requires an administrator account'
          : 'Your role does not allow this operation',
      );
    }

    return true;
  }

  /** The roles this route accepts, or undefined when any authenticated user may call it. */
  private resolveRequiredRoles(context: ExecutionContext): Role[] | undefined {
    const declared = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (declared && declared.length > 0) return declared;

    const allowsAnyRole = this.reflector.getAllAndOverride<boolean | undefined>(ANY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowsAnyRole) return undefined;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (READ_METHODS.includes(request.method)) return undefined;

    return [Role.Admin];
  }
}
