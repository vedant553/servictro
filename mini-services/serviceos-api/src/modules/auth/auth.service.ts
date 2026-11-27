import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ROLE_PERMISSIONS, type Role } from '@serviceos/contracts';
import type { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EnvToken, type Env } from '../../common/config/env';
import { DomainError, Errors } from '../../common/errors/domain.error';
import { generateOpaqueToken, hashPassword, sha256hex, verifyPassword } from '../../common/auth/password';
import type { AccessTokenPayload } from '../../common/auth/jwt-auth.guard';
import { childLogger } from '../../common/logging/logger';
import type { RegisterDto } from './dto/auth.dto';

const REFRESH_COOKIE = 'serviceos_rt';

export interface MembershipView {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: Role;
  status: string;
}

export interface AuthResult {
  accessToken: string;
  expiresInMinutes: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: { id: string; email: string; displayName: string };
  memberships: MembershipView[];
  selectedTenantId: string | null;
}

/**
 * Authentication + organization onboarding (ADR-006): local credentials with
 * scrypt hashing, short-lived JWT access tokens and rotating opaque refresh
 * tokens stored hashed. The identity model (identity_issuer/subject) keeps
 * the door open for a managed OIDC provider without domain changes.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly jwt: JwtService,
    @Inject(EnvToken) private readonly env: Env,
  ) {}

  // -------------------------------------------------------------------------
  // Registration & invitation acceptance
  // -------------------------------------------------------------------------

  async register(dto: RegisterDto, requestId: string): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    if (dto.invitationToken) {
      return this.acceptInvitationForNewUser(email, dto, requestId);
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw Errors.duplicate('email');

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: { email, displayName: dto.displayName.trim(), passwordHash },
    });

    const tenant = await this.prisma.tenant.create({
      data: {
        slug: await this.uniqueSlug(dto.organizationName),
        name: dto.organizationName.trim(),
        settings: {
          slaResponseMinutes: { low: 480, medium: 240, high: 120, critical: 60 },
          slaResolutionMinutes: { low: 4320, medium: 2880, high: 1440, critical: 480 },
        },
      },
    });
    await this.prisma.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: 'owner', status: 'active' },
    });

    // Post-commit tenant-scoped side effects (audit + welcome notification).
    await this.tenantDb.run(tenant.id, async (tx) => {
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'tenant.created',
        resourceType: 'tenant',
        resourceId: tenant.id,
        requestId,
        metadata: { name: tenant.name, slug: tenant.slug },
      });
      await this.notifications.create(
        tx,
        tenant.id,
        user.id,
        'system',
        'Welcome to ServiceOS',
        `Organization "${tenant.name}" is ready. Invite your service team from Team settings.`,
        'tenant',
        tenant.id,
      );
    });

    childLogger({ requestId, tenantId: tenant.id }).info('auth.register');
    const result = await this.buildAuthResult(user.id, tenant.id);
    await this.persistRefreshToken(user.id, result.refreshToken, result.refreshTokenExpiresAt);
    return result;
  }

  private async acceptInvitationForNewUser(
    email: string,
    dto: RegisterDto,
    requestId: string,
  ): Promise<AuthResult> {
    const invitation = await this.findValidInvitation(dto.invitationToken as string);
    if (invitation.email.toLowerCase() !== email) {
      throw new DomainError('INVITATION_EMAIL_MISMATCH', 'This invitation was issued to a different email address', 422);
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new DomainError('USER_EXISTS', 'An account with this email already exists — sign in and accept the invitation from Team', 409);
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: { email, displayName: dto.displayName.trim(), passwordHash },
    });
    await this.prisma.membership.create({
      data: {
        tenantId: invitation.tenantId,
        userId: user.id,
        role: invitation.role,
        status: 'active',
        invitedBy: invitation.invitedById,
      },
    });
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', acceptedAt: new Date(), acceptedByUserId: user.id },
    });

    await this.tenantDb.run(invitation.tenantId, async (tx) => {
      await this.audit.record(tx, {
        tenantId: invitation.tenantId,
        actorUserId: user.id,
        action: 'membership.joined',
        resourceType: 'membership',
        resourceId: user.id,
        requestId,
        metadata: { role: invitation.role, via: 'invitation' },
      });
      await this.notifications.create(
        tx,
        invitation.tenantId,
        user.id,
        'membership',
        'Welcome to the team',
        `You joined as ${invitation.role.replace(/_/g, ' ')}.`,
        'membership',
        user.id,
      );
    });
    return this.buildAuthResultAndPersist(user.id, invitation.tenantId);
  }

  /** Authenticated user accepts a pending invitation addressed to their email. */
  async acceptInvitation(userId: string, token: string, requestId: string): Promise<AuthResult> {
    const invitation = await this.findValidInvitation(token);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('User');
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new DomainError('INVITATION_EMAIL_MISMATCH', 'This invitation was issued to a different email address', 422);
    }
    const existingMembership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
    });
    if (existingMembership?.status === 'active') {
      throw new DomainError('ALREADY_MEMBER', 'You are already a member of this organization', 409);
    }
    await this.prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
      create: { tenantId: invitation.tenantId, userId, role: invitation.role, status: 'active', invitedBy: invitation.invitedById },
      update: { role: invitation.role, status: 'active' },
    });
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', acceptedAt: new Date(), acceptedByUserId: userId },
    });
    await this.tenantDb.run(invitation.tenantId, async (tx) => {
      await this.audit.record(tx, {
        tenantId: invitation.tenantId,
        actorUserId: userId,
        action: 'membership.joined',
        resourceType: 'membership',
        resourceId: userId,
        requestId,
        metadata: { role: invitation.role, via: 'invitation' },
      });
    });
    return this.buildAuthResultAndPersist(userId, invitation.tenantId);
  }

  private async findValidInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256hex(token) } });
    if (!invitation || invitation.status !== 'pending') {
      throw new DomainError('INVITATION_INVALID', 'This invitation is no longer valid', 404);
    }
    if (invitation.expiresAt < new Date()) {
      throw new DomainError('INVITATION_EXPIRED', 'This invitation has expired', 422);
    }
    return invitation;
  }

  // -------------------------------------------------------------------------
  // Login / refresh / logout
  // -------------------------------------------------------------------------

  async login(email: string, password: string, requestId: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !ok || user.status !== 'active') {
      // Uniform error: never reveal whether the email exists (OWASP).
      throw Errors.invalidCredentials();
    }
    const memberships = await this.listMemberships(user.id);
    const defaultTenantId = memberships.length === 1 ? memberships[0].tenantId : null;
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    childLogger({ requestId, userId: user.id }).info('auth.login');
    const result = await this.buildAuthResult(user.id, defaultTenantId);
    await this.persistRefreshToken(user.id, result.refreshToken, result.refreshTokenExpiresAt);
    return result;
  }

  /**
   * Rotating refresh: a presented refresh token is revoked and replaced. If a
   * previously revoked token is replayed, every session of that user is
   * invalidated (token reuse detection).
   */
  async refresh(rawToken: string, requestId: string): Promise<AuthResult> {
    const tokenHash = sha256hex(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored) throw Errors.tokenExpired();
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      childLogger({ requestId, userId: stored.userId }).warn('auth.refresh_reuse_detected');
      throw Errors.tokenExpired();
    }
    if (stored.expiresAt < new Date()) throw Errors.tokenExpired();
    if (stored.user.status !== 'active') throw Errors.unauthenticated();

    const memberships = await this.listMemberships(stored.userId);
    const defaultTenantId = memberships.length === 1 ? memberships[0].tenantId : null;
    const result = await this.buildAuthResult(stored.userId, defaultTenantId);
    await this.prisma.$transaction(async (tx) => {
      const replacement = await tx.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: sha256hex(result.refreshToken),
          expiresAt: result.refreshTokenExpiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedById: replacement.id },
      });
    });
    childLogger({ requestId, userId: stored.userId }).info('auth.refresh');
    return result;
  }

  async logout(rawToken: string | undefined, requestId: string): Promise<{ success: boolean }> {
    if (rawToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256hex(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    childLogger({ requestId }).info('auth.logout');
    return { success: true };
  }

  async switchTenant(userId: string, tenantId: string, requestId: string): Promise<AuthResult> {
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (!membership || membership.status !== 'active') throw Errors.membershipInactive();
    childLogger({ requestId, userId, tenantId }).info('auth.switch_tenant');
    // Only the access token is re-issued; the existing refresh cookie stays.
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      email: user.email,
      tenantId,
      typ: 'access',
    });
    return {
      accessToken,
      expiresInMinutes: this.env.accessTokenTtlMinutes,
      refreshToken: '',
      refreshTokenExpiresAt: new Date(0),
      user: { id: user.id, email: user.email, displayName: user.displayName },
      memberships: await this.listMemberships(userId),
      selectedTenantId: tenantId,
    };
  }

  // -------------------------------------------------------------------------
  // /me
  // -------------------------------------------------------------------------

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.notFound('User');
    const memberships = await this.listMemberships(userId);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      memberships: memberships.map((m) => ({
        ...m,
        permissions: ROLE_PERMISSIONS[m.role] ?? [],
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async listMemberships(userId: string): Promise<MembershipView[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId, status: 'active' },
      include: { tenant: { select: { id: true, name: true, slug: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .filter((r) => r.tenant.status === 'active')
      .map((r) => ({
        tenantId: r.tenantId,
        tenantName: r.tenant.name,
        tenantSlug: r.tenant.slug,
        role: r.role,
        status: r.status,
      }));
  }

  private async buildAuthResult(userId: string, tenantId: string | null): Promise<AuthResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const memberships = await this.listMemberships(userId);
    const payload: AccessTokenPayload = {
      sub: userId,
      email: user.email,
      typ: 'access',
      ...(tenantId ? { tenantId } : {}),
    };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = generateOpaqueToken('rt');
    const refreshTokenExpiresAt = new Date(Date.now() + this.env.refreshTokenTtlDays * 86_400_000);
    // On initial issue (login/register) we persist the refresh token directly;
    // on rotation the caller persists the replacement.
    return {
      accessToken,
      expiresInMinutes: this.env.accessTokenTtlMinutes,
      refreshToken,
      refreshTokenExpiresAt,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      memberships,
      selectedTenantId: tenantId,
    };
  }

  private async buildAuthResultAndPersist(userId: string, tenantId: string | null): Promise<AuthResult> {
    const result = await this.buildAuthResult(userId, tenantId);
    await this.persistRefreshToken(userId, result.refreshToken, result.refreshTokenExpiresAt);
    return result;
  }

  /** Persist the initial refresh token (login/register paths). */
  async persistRefreshToken(userId: string, refreshToken: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256hex(refreshToken), expiresAt },
    });
  }

  cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.env.appUrl.startsWith('https'),
      path: '/api/v1/auth',
      maxAge: this.env.refreshTokenTtlDays * 86_400_000,
    };
  }

  get refreshCookieName(): string {
    return REFRESH_COOKIE;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org';
    for (let i = 0; i < 8; i++) {
      const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const exists = await this.prisma.tenant.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}
