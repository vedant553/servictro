import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { Errors } from '../../common/errors/domain.error';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';
import type { TenantContext } from '../../common/tenant/tenant-context';

/** Customer sites / plant locations (Blueprint SITE-01). */
@Injectable()
export class SitesService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: TenantContext, query: { customerId?: string; search?: string; cursor?: string; limit?: string }) {
    const page = parsePageQuery(query);
    const where: Prisma.SiteWhereInput = {
      deletedAt: null,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { siteCode: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.site.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: {
          customer: { select: { id: true, legalName: true, accountCode: true } },
          _count: { select: { assets: true } },
        },
      }),
    );
    return pageResult(
      rows.map((r) => ({
        id: r.id,
        siteCode: r.siteCode,
        name: r.name,
        status: r.status,
        address: r.address,
        timezone: r.timezone,
        customer: r.customer,
        assetCount: r._count.assets,
        createdAt: r.createdAt,
      })),
      page.limit,
    );
  }

  async get(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const site = await tx.site.findFirst({
        where: { id, deletedAt: null },
        include: {
          customer: { select: { id: true, legalName: true, accountCode: true } },
          assets: {
            where: { deletedAt: null },
            select: { id: true, assetCode: true, serialNumber: true, assetFamily: true, manufacturer: true, model: true, status: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      if (!site) throw Errors.notFound('Site');
      return site;
    });
  }

  async create(ctx: TenantContext, dto: Record<string, unknown>) {
    const site = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const customer = await tx.customerAccount.findFirst({
        where: { id: String(dto.customerId), deletedAt: null },
      });
      if (!customer) throw Errors.notFound('Customer');
      const clash = await tx.site.findFirst({ where: { siteCode: String(dto.siteCode), deletedAt: null } });
      if (clash) throw Errors.duplicate('site code');
      const created = await tx.site.create({
        data: {
          customerId: customer.id,
          siteCode: String(dto.siteCode).trim(),
          name: String(dto.name).trim(),
          address: (dto.address ?? {}) as Prisma.InputJsonValue,
          latitude: dto.latitude ? new Prisma.Decimal(String(dto.latitude)) : null,
          longitude: dto.longitude ? new Prisma.Decimal(String(dto.longitude)) : null,
          timezone: (dto.timezone as string) ?? 'Asia/Kolkata',
          accessInstructions: (dto.accessInstructions as string) ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'site.created',
        resourceType: 'site',
        resourceId: created.id,
        requestId: ctx.requestId,
        metadata: { siteCode: created.siteCode, customerId: customer.id },
      });
      return created;
    });
    return this.get(ctx, site.id);
  }

  async update(ctx: TenantContext, id: string, dto: Record<string, unknown>) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const current = await tx.site.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw Errors.notFound('Site');
      const expected = dto.expectedVersion as number | undefined;
      if (expected !== undefined && expected !== current.version) throw Errors.versionConflict();
      await tx.site.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: String(dto.name).trim() } : {}),
          ...(dto.status !== undefined ? { status: dto.status as never } : {}),
          ...(dto.address !== undefined ? { address: dto.address as Prisma.InputJsonValue } : {}),
          ...(dto.accessInstructions !== undefined ? { accessInstructions: dto.accessInstructions as string } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'site.updated',
        resourceType: 'site',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { fields: Object.keys(dto).filter((k) => k !== 'expectedVersion') },
      });
    });
    return this.get(ctx, id);
  }
}
