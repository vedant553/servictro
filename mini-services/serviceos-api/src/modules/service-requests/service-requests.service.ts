import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContractsService } from '../contracts/contracts.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';
import { assertRequestTransition } from './domain/request-state';
import type { TenantContext } from '../../common/tenant/tenant-context';
import type { RequestStatus } from '@serviceos/contracts';

/**
 * Service request intake, triage and conversion (Blueprint SR-01/SR-02,
 * Workflow B). Each request gets a tenant-scoped human-readable number, an
 * immutable created timestamp, duplicate detection and entitlement context.
 */
@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    private readonly contracts: ContractsService,
  ) {}

  async list(
    ctx: TenantContext,
    query: { status?: string; severity?: string; customerId?: string; assetId?: string; search?: string; cursor?: string; limit?: string },
  ) {
    const page = parsePageQuery(query);
    const where: Prisma.ServiceRequestWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.severity ? { severity: query.severity as never } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.assetId ? { assetId: query.assetId } : {}),
      ...(query.search
        ? {
            OR: [
              { requestNo: { contains: query.search, mode: 'insensitive' } },
              { subject: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.serviceRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: {
          customer: { select: { id: true, legalName: true, accountCode: true } },
          site: { select: { id: true, name: true, siteCode: true } },
          asset: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true } },
        },
      }),
    );
    return pageResult(rows, page.limit);
  }

  async get(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const request = await tx.serviceRequest.findFirst({
        where: { id },
        include: {
          customer: { select: { id: true, legalName: true, accountCode: true } },
          site: { select: { id: true, name: true, siteCode: true, address: true } },
          asset: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true, manufacturer: true, model: true } },
          workOrders: { select: { id: true, workOrderNo: true, status: true, title: true } },
        },
      });
      if (!request) throw Errors.notFound('Service request');
      const coverage = request.assetId ? await this.contracts.coverageForAsset(tx, request.assetId) : null;
      // Duplicate detection: open requests for the same asset.
      const possibleDuplicates = request.assetId
        ? await tx.serviceRequest.findMany({
            where: { assetId: request.assetId, id: { not: request.id }, status: { in: ['new', 'triaged', 'accepted', 'needs_information'] } },
            select: { id: true, requestNo: true, subject: true, status: true, createdAt: true },
            take: 5,
          })
        : [];
      return { ...request, coverage, possibleDuplicates };
    });
  }

  async create(ctx: TenantContext, dto: Record<string, unknown>) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const customer = await tx.customerAccount.findFirst({ where: { id: String(dto.customerId), deletedAt: null } });
      if (!customer) throw Errors.notFound('Customer');
      const site = await tx.site.findFirst({ where: { id: String(dto.siteId), deletedAt: null } });
      if (!site || site.customerId !== customer.id) {
        throw new DomainError('SITE_CUSTOMER_MISMATCH', 'The site does not belong to this customer', 422);
      }
      let asset = null as Awaited<ReturnType<typeof tx.asset.findFirst>>;
      if (dto.assetId) {
        asset = await tx.asset.findFirst({ where: { id: String(dto.assetId), deletedAt: null } });
        if (!asset || asset.siteId !== site.id) {
          throw new DomainError('ASSET_SITE_MISMATCH', 'The asset is not installed at this site', 422);
        }
      }
      const requestNo = await this.numbering.next(tx, ctx.tenantId, 'service_request', 'SR');
      const request = await tx.serviceRequest.create({
        data: {
          requestNo,
          customerId: customer.id,
          siteId: site.id,
          assetId: asset?.id ?? null,
          contactId: dto.contactId ? String(dto.contactId) : null,
          source: dto.source as never,
          category: dto.category as never,
          subject: String(dto.subject).trim(),
          description: String(dto.description).trim(),
          severity: dto.severity as never,
          preferredVisitAt: dto.preferredVisitAt ? new Date(String(dto.preferredVisitAt)) : null,
          createdById: ctx.user.id,
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'service_request.created',
        resourceType: 'service_request',
        resourceId: request.id,
        requestId: ctx.requestId,
        metadata: { requestNo, severity: request.severity, assetId: asset?.id },
      });
      // Notify coordinators/managers for triage (SR-01 / Tech Spec §14.4).
      await this.notifications.createForRoles(tx, ctx.tenantId, ['service_manager', 'coordinator', 'admin', 'owner'], {
        category: 'request_created',
        title: `New request ${requestNo}`,
        body: `${request.subject} — ${customer.legalName}${site ? ` / ${site.name}` : ''} (${request.severity})`,
        entityType: 'service_request',
        entityId: request.id,
      });
      await this.outbox.publish(tx, {
        tenantId: ctx.tenantId,
        eventType: 'request.created',
        aggregateType: 'service_request',
        aggregateId: request.id,
        payload: { requestNo, severity: request.severity },
      });
      return request;
    });
  }

  async triage(ctx: TenantContext, id: string, dto: { severity?: string; category?: string; duplicateOfId?: string }) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const request = await tx.serviceRequest.findFirst({ where: { id } });
      if (!request) throw Errors.notFound('Service request');
      assertRequestTransition(request.status, 'triaged');
      await tx.serviceRequest.update({
        where: { id },
        data: {
          status: 'triaged',
          severity: (dto.severity as never) ?? request.severity,
          category: (dto.category as never) ?? request.category,
          triagedAt: new Date(),
          triagedById: ctx.user.id,
          // First meaningful internal response counts for SLA measurement.
          firstResponseAt: request.firstResponseAt ?? new Date(),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'service_request.triaged',
        resourceType: 'service_request',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { severity: dto.severity, duplicateOf: dto.duplicateOfId },
      });
    });
    return this.get(ctx, id);
  }

  async accept(ctx: TenantContext, id: string, note?: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const request = await tx.serviceRequest.findFirst({ where: { id } });
      if (!request) throw Errors.notFound('Service request');
      assertRequestTransition(request.status, 'accepted');
      await tx.serviceRequest.update({
        where: { id },
        data: { status: 'accepted', acceptedAt: new Date(), firstResponseAt: request.firstResponseAt ?? new Date(), version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'service_request.accepted',
        resourceType: 'service_request',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { note },
      });
    });
    return this.get(ctx, id);
  }

  async requestInformation(ctx: TenantContext, id: string, note: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const request = await tx.serviceRequest.findFirst({ where: { id } });
      if (!request) throw Errors.notFound('Service request');
      assertRequestTransition(request.status, 'needs_information');
      await tx.serviceRequest.update({
        where: { id },
        data: { status: 'needs_information', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'service_request.info_requested',
        resourceType: 'service_request',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { note },
      });
    });
    return this.get(ctx, id);
  }

  async reject(ctx: TenantContext, id: string, reason: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const request = await tx.serviceRequest.findFirst({ where: { id } });
      if (!request) throw Errors.notFound('Service request');
      assertRequestTransition(request.status, 'rejected');
      if (!reason || reason.trim().length < 4) {
        throw new DomainError('REASON_REQUIRED', 'A rejection reason is required', 422, [{ field: 'reason', reason: 'required' }]);
      }
      await tx.serviceRequest.update({
        where: { id },
        data: { status: 'rejected', rejectedReason: reason.trim(), version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'service_request.rejected',
        resourceType: 'service_request',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { reason },
      });
    });
    return this.get(ctx, id);
  }

  async close(ctx: TenantContext, id: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const request = await tx.serviceRequest.findFirst({ where: { id } });
      if (!request) throw Errors.notFound('Service request');
      assertRequestTransition(request.status, 'closed');
      await tx.serviceRequest.update({
        where: { id },
        data: { status: 'closed', closedAt: new Date(), version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'service_request.closed',
        resourceType: 'service_request',
        resourceId: id,
        requestId: ctx.requestId,
      });
    });
    return this.get(ctx, id);
  }

  /** Called by WorkOrdersService inside the conversion transaction. */
  async markConverted(tx: Prisma.TransactionClient, tenantId: string, requestId: string): Promise<void> {
    await tx.serviceRequest.update({
      where: { id: requestId },
      data: { status: 'converted', convertedAt: new Date(), version: { increment: 1 } },
    });
  }

  async setStatusInternal(tx: Prisma.TransactionClient, id: string, status: RequestStatus): Promise<void> {
    await tx.serviceRequest.update({ where: { id }, data: { status, version: { increment: 1 } } });
  }
}
