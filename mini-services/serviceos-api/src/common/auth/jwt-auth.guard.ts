import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ROLE_PERMISSIONS } from '@serviceos/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { Errors } from '../errors/domain.error';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { TenantContext } from '../tenant/tenant-context';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  tenantId?: string;
  typ: 'access';
}

/**
 * Resolves the authenticated user AND the verified tenant context on every
 * protected request:
 *  1. verify bearer access token,
 *  2. load active user,
 *  3. load ACTIVE memberships,
 *  4. tenant = token claim or X-Tenant-Id header — both validated against
 *     membership; a client-supplied tenant id is never trusted alone
 *     (Tech Spec §15.2).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) throw Errors.unauthenticated();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7), {});
    } catch {
      throw Errors.tokenExpired();
    }
    if (!payload?.sub || payload.typ !== 'access') throw Errors.unauthenticated();

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') throw Errors.unauthenticated();

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id, status: 'active' },
      include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
    });
    if (memberships.length === 0) throw Errors.noActiveTenant();

    const headerTenantId: string | undefined = request.headers['x-tenant-id'];
    const requestedTenantId = headerTenantId || payload.tenantId;

    let selected = requestedTenantId
      ? memberships.find((m) => m.tenantId === requestedTenantId)
      : undefined;
    if (requestedTenantId && !selected) {
      // Header/token names a tenant the user does not belong to → deny.
      throw Errors.membershipInactive();
    }
    if (!selected && memberships.length === 1) {
      selected = memberships[0];
    }
    if (!selected) {
      throw Errors.tenantSelectionRequired();
    }
    if (selected.tenant.status !== 'active') throw Errors.membershipInactive();

    const permissions = ROLE_PERMISSIONS[selected.role] ?? [];
    const tenantContext: TenantContext = {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      tenantId: selected.tenantId,
      role: selected.role,
      permissions,
      requestId: request.requestId ?? '',
    };
    request.user = tenantContext.user;
    request.tenantContext = tenantContext;
    return true;
  }
}
