import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../errors/domain.error';
import { REQUIRE_PERMISSIONS_KEY } from './require-permissions.decorator';

/** Server-side RBAC enforcement for protected routes. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const ctx = request.tenantContext;
    if (!ctx) throw Errors.unauthenticated();

    const missing = required.filter((p) => !ctx.permissions.includes(p as never));
    if (missing.length > 0) throw Errors.permissionDenied(missing.join(', '));
    return true;
  }
}
