import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { Errors } from '../../common/errors/domain.error';
import { parsePageQuery, pageResult, allowSort } from '../../common/pagination/pagination';
import type { TenantContext } from '../../common/tenant/tenant-context';

/**
 * Customer CRM (Blueprint CRM-01): accounts, contacts, duplicate warnings.
 * All access is tenant-scoped through TenantDbService transactions.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(ctx: TenantContext, query: { search?: string; status?: string; cursor?: string; limit?: string; sort?: string }) {
    const page = parsePageQuery(query);
    allowSort(query.sort, ['legalName', 'createdAt'], 'createdAt');
    const where: Prisma.CustomerAccountWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { legalName: { contains: query.search, mode: 'insensitive' } },
              { accountCode: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.customerAccount.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: { _count: { select: { sites: true, contacts: true, contracts: true } } },
      }),
    );
    return pageResult(
      rows.map((r) => ({
        id: r.id,
        accountCode: r.accountCode,
        legalName: r.legalName,
        segment: r.segment,
        status: r.status,
        siteCount: r._count.sites,
        contactCount: r._count.contacts,
        contractCount: r._count.contracts,
        createdAt: r.createdAt,
      })),
      page.limit,
    );
  }

  async get(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const customer = await tx.customerAccount.findFirst({
        where: { id, deletedAt: null },
        include: {
          contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
          sites: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { assets: true } } } },
          _count: { select: { requests: true, workOrders: true, contracts: true } },
        },
      });
      if (!customer) throw Errors.notFound('Customer');
      return customer;
    });
  }

  /** Duplicate warnings (CRM-01): likely-existing accounts by name/code. */
  async duplicates(ctx: TenantContext, legalName: string) {
    return this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.customerAccount.findMany({
        where: { deletedAt: null, legalName: { equals: legalName, mode: 'insensitive' } },
        select: { id: true, accountCode: true, legalName: true, status: true },
        take: 5,
      }),
    );
  }

  async create(ctx: TenantContext, dto: Record<string, unknown>) {
    const legalName = String(dto.legalName).trim();
    const created = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      if (dto.accountCode) {
        const clash = await tx.customerAccount.findFirst({
          where: { accountCode: String(dto.accountCode), deletedAt: null },
        });
        if (clash) throw Errors.duplicate('account code');
      }
      const accountCode = dto.accountCode
        ? String(dto.accountCode)
        : await this.numbering.next(tx, ctx.tenantId, 'customer', 'CUS');
      const customer = await tx.customerAccount.create({
        data: {
          accountCode,
          legalName,
          segment: (dto.segment as string) ?? null,
          billingAddress: (dto.billingAddress ?? {}) as Prisma.InputJsonValue,
          notes: (dto.notes as string) ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'customer.created',
        resourceType: 'customer',
        resourceId: customer.id,
        requestId: ctx.requestId,
        metadata: { accountCode, legalName },
      });
      return customer;
    });
    return this.get(ctx, created.id);
  }

  async update(ctx: TenantContext, id: string, dto: Record<string, unknown>) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const current = await tx.customerAccount.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw Errors.notFound('Customer');
      const expected = dto.expectedVersion as number | undefined;
      if (expected !== undefined && expected !== current.version) throw Errors.versionConflict();
      await tx.customerAccount.update({
        where: { id },
        data: {
          ...(dto.legalName !== undefined ? { legalName: String(dto.legalName).trim() } : {}),
          ...(dto.status !== undefined ? { status: dto.status as never } : {}),
          ...(dto.segment !== undefined ? { segment: dto.segment as string } : {}),
          ...(dto.billingAddress !== undefined ? { billingAddress: dto.billingAddress as Prisma.InputJsonValue } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes as string } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'customer.updated',
        resourceType: 'customer',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { fields: Object.keys(dto).filter((k) => k !== 'expectedVersion') },
      });
    });
    return this.get(ctx, id);
  }

  async softDelete(ctx: TenantContext, id: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const current = await tx.customerAccount.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw Errors.notFound('Customer');
      await tx.customerAccount.update({ where: { id }, data: { deletedAt: new Date(), status: 'archived' } });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'customer.archived',
        resourceType: 'customer',
        resourceId: id,
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Contacts
  // -------------------------------------------------------------------------

  async createContact(ctx: TenantContext, customerId: string, dto: Record<string, unknown>) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const customer = await tx.customerAccount.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!customer) throw Errors.notFound('Customer');
      if (dto.isPrimary) {
        await tx.customerContact.updateMany({
          where: { customerId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const contact = await tx.customerContact.create({
        data: {
          customerId,
          name: String(dto.name).trim(),
          role: (dto.role as string) ?? null,
          email: dto.email ? String(dto.email).toLowerCase() : null,
          phone: (dto.phone as string) ?? null,
          isPrimary: Boolean(dto.isPrimary),
          notes: (dto.notes as string) ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'customer_contact.created',
        resourceType: 'customer_contact',
        resourceId: contact.id,
        requestId: ctx.requestId,
        metadata: { customerId },
      });
      return contact;
    });
  }

  async deleteContact(ctx: TenantContext, customerId: string, contactId: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const contact = await tx.customerContact.findFirst({
        where: { id: contactId, customerId, deletedAt: null },
      });
      if (!contact) throw Errors.notFound('Contact');
      await tx.customerContact.update({ where: { id: contactId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'customer_contact.deleted',
        resourceType: 'customer_contact',
        resourceId: contactId,
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }
}
