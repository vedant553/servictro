import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { Errors } from '../../common/errors/domain.error';
import type { TenantContext } from '../../common/tenant/tenant-context';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  async listForUser(userId: string) {
    return this.prisma.membership.findMany({
      where: { userId, status: 'active' },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getCurrent(ctx: TenantContext) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
    if (!tenant) throw Errors.notFound('Organization');
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      legalName: tenant.legalName,
      timezone: tenant.timezone,
      locale: tenant.locale,
      currencyCode: tenant.currencyCode,
      status: tenant.status,
      plan: tenant.plan,
      settings: tenant.settings,
      createdAt: tenant.createdAt,
    };
  }

  async updateCurrent(ctx: TenantContext, dto: Record<string, string>) {
    const updated = await this.prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.legalName !== undefined ? { legalName: dto.legalName } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
        ...(dto.currencyCode !== undefined ? { currencyCode: dto.currencyCode } : {}),
      },
    });
    await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'tenant.updated',
        resourceType: 'tenant',
        resourceId: ctx.tenantId,
        requestId: ctx.requestId,
        metadata: { fields: Object.keys(dto) },
      }),
    );
    return this.getCurrent(ctx);
  }

  /** Create an additional organization; the creator becomes its owner. */
  async createAdditional(ctx: TenantContext, dto: { name: string; timezone?: string; locale?: string; currencyCode?: string }) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: this.slugify(dto.name) } });
    const slug = existing ? `${this.slugify(dto.name)}-${Date.now().toString(36).slice(-4)}` : this.slugify(dto.name);
    const tenant = await this.prisma.tenant.create({
      data: {
        slug,
        name: dto.name,
        timezone: dto.timezone ?? 'Asia/Kolkata',
        locale: dto.locale ?? 'en-IN',
        currencyCode: dto.currencyCode ?? 'INR',
        settings: {},
      },
    });
    await this.prisma.membership.create({
      data: { tenantId: tenant.id, userId: ctx.user.id, role: 'owner', status: 'active' },
    });
    await this.tenantDb.run(tenant.id, (tx) =>
      this.audit.record(tx, {
        tenantId: tenant.id,
        actorUserId: ctx.user.id,
        action: 'tenant.created',
        resourceType: 'tenant',
        resourceId: tenant.id,
        requestId: ctx.requestId,
        metadata: { name: tenant.name, slug: tenant.slug, additional: true },
      }),
    );
    return tenant;
  }

  private slugify(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'org'
    );
  }
}
