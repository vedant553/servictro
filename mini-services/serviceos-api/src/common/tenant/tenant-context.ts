import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@serviceos/contracts';
import type { Permission } from '@serviceos/contracts';

/**
 * Request-scoped tenant context, resolved server-side from the JWT and the
 * tenant_memberships table. A client-supplied X-Tenant-Id header is only a
 * selection hint validated against membership (Tech Spec §10.1, §15.2).
 */
export interface TenantContext {
  user: { id: string; email: string; displayName: string };
  tenantId: string;
  role: Role;
  permissions: readonly Permission[];
  requestId: string;
}

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    if (!request.tenantContext) {
      throw new Error('TenantContext missing — route must be protected by JwtAuthGuard');
    }
    return request.tenantContext as TenantContext;
  },
);
