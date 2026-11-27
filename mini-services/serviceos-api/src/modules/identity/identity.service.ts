import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { generateOpaqueToken, sha256hex } from '../../common/auth/password';
import { EnvToken, type Env } from '../../common/config/env';
import { Inject } from '@nestjs/common';
import type { TenantContext } from '../../common/tenant/tenant-context';

const INVITATION_TTL_DAYS = 7;

/**
 * Team management: memberships, roles, skills and invitations. Invariant: a
 * tenant always keeps at least one ACTIVE owner (Tech Spec §15.4 — role
 * changes are privileged, audited actions).
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(EnvToken) private readonly env: Env,
  ) {}

  async listMembers(ctx: TenantContext) {
    return this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.membership.findMany({
        where: { tenantId: ctx.tenantId, status: { not: 'revoked' } },
        include: { user: { select: { id: true, email: true, displayName: true, lastLoginAt: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async listInvitations(ctx: TenantContext) {
    return this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.invitation.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Creates an invitation. The token is returned ONCE so an admin can deliver
   * it manually — the dev email adapter never pretends to send (ADR-011).
   */
  async invite(ctx: TenantContext, dto: { email: string; role: string; title?: string }) {
    const email = dto.email.trim().toLowerCase();
    const existingMembership = await this.prisma.membership.findFirst({
      where: { tenantId: ctx.tenantId, user: { email }, status: { in: ['active', 'invited', 'suspended'] } },
    });
    if (existingMembership) throw Errors.duplicate('team member');

    const token = generateOpaqueToken('inv');
    const invitation = await this.prisma.invitation.create({
      data: {
        tenantId: ctx.tenantId,
        email,
        role: dto.role as never,
        tokenHash: sha256hex(token),
        invitedById: ctx.user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    });
    await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'invitation.created',
        resourceType: 'invitation',
        resourceId: invitation.id,
        requestId: ctx.requestId,
        metadata: { email, role: dto.role },
      }),
    );
    return {
      id: invitation.id,
      email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      // One-time secret; accepting URL is handed to the inviter for delivery.
      acceptUrl: `${this.env.appUrl}/register?invite=${token}`,
    };
  }

  async resend(ctx: TenantContext, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, tenantId: ctx.tenantId },
    });
    if (!invitation) throw Errors.notFound('Invitation');
    if (invitation.status !== 'pending') throw new DomainError('INVITATION_NOT_PENDING', 'Only pending invitations can be resent', 409);
    const token = generateOpaqueToken('inv');
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { tokenHash: sha256hex(token), expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000) },
    });
    await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'invitation.resent',
        resourceType: 'invitation',
        resourceId: invitation.id,
        requestId: ctx.requestId,
      }),
    );
    return { id: invitation.id, acceptUrl: `${this.env.appUrl}/register?invite=${token}` };
  }

  async revoke(ctx: TenantContext, invitationId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, tenantId: ctx.tenantId },
    });
    if (!invitation) throw Errors.notFound('Invitation');
    await this.prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'revoked' } });
    await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'invitation.revoked',
        resourceType: 'invitation',
        resourceId: invitation.id,
        requestId: ctx.requestId,
      }),
    );
    return { success: true };
  }

  async updateMembership(ctx: TenantContext, userId: string, dto: { role?: string; status?: string; skills?: string }) {
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: ctx.tenantId, userId } },
    });
    if (!membership) throw Errors.notFound('Team member');

    // Invariant: never remove/suspend/demote the last active owner.
    if (membership.role === 'owner' && membership.status === 'active') {
      if (dto.role !== undefined && dto.role !== 'owner') {
        await this.ensureNotLastOwner(ctx.tenantId, userId);
      }
      if (dto.status === 'suspended') {
        await this.ensureNotLastOwner(ctx.tenantId, userId);
      }
    }

    const skills = dto.skills !== undefined ? dto.skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const updated = await this.prisma.membership.update({
      where: { tenantId_userId: { tenantId: ctx.tenantId, userId } },
      data: {
        ...(dto.role !== undefined ? { role: dto.role as never } : {}),
        ...(dto.status !== undefined ? { status: dto.status as never } : {}),
        ...(skills !== undefined ? { skills } : {}),
      },
    });
    await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'membership.updated',
        resourceType: 'membership',
        resourceId: userId,
        requestId: ctx.requestId,
        metadata: { role: dto.role, status: dto.status },
      }),
    );
    return updated;
  }

  private async ensureNotLastOwner(tenantId: string, userId: string): Promise<void> {
    const activeOwners = await this.prisma.membership.count({
      where: { tenantId, role: 'owner', status: 'active', NOT: { userId } },
    });
    if (activeOwners === 0) {
      throw new DomainError('LAST_OWNER', 'The organization must keep at least one active owner', 422);
    }
  }
}
