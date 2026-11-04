import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';
import { EnvToken, type Env } from '../../common/config/env';
import { AssetSpecificationSchema } from './domain/asset-specification.schema';
import type { TenantContext } from '../../common/tenant/tenant-context';

/**
 * Installed asset registry (Blueprint AST-01/AST-02, Workflow A).
 * Asset-first: every request, work order, contract and document attaches to
 * the asset record; serial uniqueness is tenant-scoped, never global.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    @Inject(EnvToken) private readonly env: Env,
  ) {}

  async list(
    ctx: TenantContext,
    query: { search?: string; family?: string; siteId?: string; customerId?: string; status?: string; cursor?: string; limit?: string },
  ) {
    const page = parsePageQuery(query);
    const where: Prisma.AssetWhereInput = {
      deletedAt: null,
      ...(query.family ? { assetFamily: query.family as never } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.customerId ? { site: { customerId: query.customerId } } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { assetCode: { contains: query.search, mode: 'insensitive' } },
              { serialNumber: { contains: query.search, mode: 'insensitive' } },
              { manufacturer: { contains: query.search, mode: 'insensitive' } },
              { model: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: {
          site: {
            select: { id: true, name: true, siteCode: true, customer: { select: { id: true, legalName: true, accountCode: true } } },
          },
        },
      }),
    );
    return pageResult(
      rows.map((a) => ({
        id: a.id,
        assetCode: a.assetCode,
        serialNumber: a.serialNumber,
        assetFamily: a.assetFamily,
        manufacturer: a.manufacturer,
        model: a.model,
        status: a.status,
        commissioningDate: a.commissioningDate,
        specification: a.specification,
        site: a.site,
        createdAt: a.createdAt,
      })),
      page.limit,
    );
  }

  /** Full asset record with site/customer context, documents and coverage. */
  async get(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id, deletedAt: null },
        include: {
          site: {
            select: {
              id: true, name: true, siteCode: true, address: true, timezone: true, accessInstructions: true,
              customer: { select: { id: true, legalName: true, accountCode: true } },
            },
          },
          parent: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true } },
          documents: {
            include: { attachment: { select: { id: true, originalName: true, contentType: true, sizeBytes: true, status: true } } },
            orderBy: { createdAt: 'desc' },
          },
          contractAssets: {
            include: {
              contract: { select: { id: true, contractNo: true, contractType: true, status: true, startDate: true, endDate: true, currencyCode: true, amountMinor: true } },
            },
            where: { contract: { status: 'active' } },
          },
          _count: { select: { requests: true, workOrders: true, measurements: true, plannedVisits: true } },
        },
      });
      if (!asset) throw Errors.notFound('Asset');
      return {
        ...asset,
        coverage: asset.contractAssets.map((ca) => ({
          contractId: ca.contract.id,
          contractNo: ca.contract.contractNo,
          contractType: ca.contract.contractType,
          coverageType: ca.coverageType,
          startDate: ca.contract.startDate,
          endDate: ca.contract.endDate,
        })),
      };
    });
  }

  async create(ctx: TenantContext, dto: Record<string, unknown>) {
    const spec = this.validateSpecification(dto.specification);
    const asset = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const site = await tx.site.findFirst({ where: { id: String(dto.siteId), deletedAt: null } });
      if (!site) throw Errors.notFound('Site');
      if (dto.assetCode) {
        const clash = await tx.asset.findFirst({ where: { assetCode: String(dto.assetCode), deletedAt: null } });
        if (clash) throw Errors.duplicate('asset code');
      }
      if (dto.serialNumber) {
        const clash = await tx.asset.findFirst({ where: { serialNumber: String(dto.serialNumber), deletedAt: null } });
        if (clash) throw Errors.duplicate('serial number');
      }
      if (dto.parentAssetId) {
        const parent = await tx.asset.findFirst({ where: { id: String(dto.parentAssetId), deletedAt: null } });
        if (!parent) throw Errors.notFound('Parent asset');
      }
      const assetCode = dto.assetCode
        ? String(dto.assetCode)
        : await this.numbering.next(tx, ctx.tenantId, 'asset', 'AST');
      const created = await tx.asset.create({
        data: {
          siteId: site.id,
          parentAssetId: dto.parentAssetId ? String(dto.parentAssetId) : null,
          assetCode,
          serialNumber: (dto.serialNumber as string) ?? null,
          assetFamily: dto.assetFamily as never,
          manufacturer: (dto.manufacturer as string) ?? null,
          model: (dto.model as string) ?? null,
          commissioningDate: dto.commissioningDate ? new Date(String(dto.commissioningDate)) : null,
          specification: (spec ?? { schemaVersion: 1 }) as Prisma.InputJsonValue,
          notes: (dto.notes as string) ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'asset.registered',
        resourceType: 'asset',
        resourceId: created.id,
        requestId: ctx.requestId,
        metadata: { assetCode, family: created.assetFamily, siteId: site.id },
      });
      return created;
    });
    return this.get(ctx, asset.id);
  }

  async update(ctx: TenantContext, id: string, dto: Record<string, unknown>) {
    const spec = dto.specification !== undefined ? this.validateSpecification(dto.specification) : undefined;
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const current = await tx.asset.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw Errors.notFound('Asset');
      const expected = dto.expectedVersion as number | undefined;
      if (expected !== undefined && expected !== current.version) throw Errors.versionConflict();
      if (dto.serialNumber !== undefined && dto.serialNumber !== current.serialNumber) {
        const clash = await tx.asset.findFirst({ where: { serialNumber: String(dto.serialNumber), deletedAt: null, NOT: { id } } });
        if (clash) throw Errors.duplicate('serial number');
      }
      await tx.asset.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status as never } : {}),
          ...(dto.serialNumber !== undefined ? { serialNumber: (dto.serialNumber as string) || null } : {}),
          ...(dto.manufacturer !== undefined ? { manufacturer: dto.manufacturer as string } : {}),
          ...(dto.model !== undefined ? { model: dto.model as string } : {}),
          ...(dto.commissioningDate !== undefined
            ? { commissioningDate: dto.commissioningDate ? new Date(String(dto.commissioningDate)) : null }
            : {}),
          ...(spec !== undefined ? { specification: spec as Prisma.InputJsonValue } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes as string } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'asset.updated',
        resourceType: 'asset',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { fields: Object.keys(dto).filter((k) => k !== 'expectedVersion') },
      });
    });
    return this.get(ctx, id);
  }

  /**
   * Unified asset timeline: requests, work orders, measurements and planned
   * visits merged, newest first (Workflow A: "view complete equipment history").
   */
  async timeline(ctx: TenantContext, id: string, limit = 50) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const asset = await tx.asset.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!asset) throw Errors.notFound('Asset');
      const [requests, workOrders, measurements, visits] = await Promise.all([
        tx.serviceRequest.findMany({
          where: { assetId: id },
          select: { id: true, requestNo: true, subject: true, severity: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' }, take: limit,
        }),
        tx.workOrder.findMany({
          where: { assetId: id },
          select: { id: true, workOrderNo: true, title: true, status: true, priority: true, createdAt: true, completedAt: true },
          orderBy: { createdAt: 'desc' }, take: limit,
        }),
        tx.serviceMeasurement.findMany({
          where: { assetId: id },
          select: { id: true, measurementKey: true, measuredValue: true, unit: true, serverReceivedAt: true },
          orderBy: { serverReceivedAt: 'desc' }, take: limit,
        }),
        tx.plannedVisit.findMany({
          where: { assetId: id },
          select: { id: true, dueAt: true, status: true },
          orderBy: { dueAt: 'desc' }, take: limit,
        }),
      ]);
      const events = [
        ...requests.map((r) => ({ kind: 'service_request' as const, occurredAt: r.createdAt, ...r })),
        ...workOrders.map((w) => ({ kind: 'work_order' as const, occurredAt: w.createdAt, ...w })),
        ...measurements.map((m) => ({ kind: 'measurement' as const, occurredAt: m.serverReceivedAt, ...m })),
        ...visits.map((v) => ({ kind: 'planned_visit' as const, occurredAt: v.dueAt, ...v })),
      ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      return events.slice(0, limit);
    });
  }

  /**
   * QR asset identification (Workflow A): encodes the scan URL. Resolution
   * requires an authenticated session — the code itself carries no data.
   */
  async qr(ctx: TenantContext, id: string) {
    const asset = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.asset.findFirst({ where: { id, deletedAt: null }, select: { id: true, assetCode: true } }),
    );
    if (!asset) throw Errors.notFound('Asset');
    const url = `${this.env.appUrl}/scan/${asset.id}`;
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220, errorCorrectionLevel: 'M' });
    return { assetCode: asset.assetCode, url, qrSvg };
  }

  /** Link an uploaded attachment as a typed asset document (AST-02). */
  async linkDocument(ctx: TenantContext, assetId: string, dto: { attachmentId: string; documentType: string; title?: string; revision?: string; notes?: string }) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const asset = await tx.asset.findFirst({ where: { id: assetId, deletedAt: null } });
      if (!asset) throw Errors.notFound('Asset');
      const attachment = await tx.attachment.findFirst({
        where: { id: dto.attachmentId, status: 'available' },
      });
      if (!attachment) throw Errors.notFound('Attachment');
      const doc = await tx.assetDocument.create({
        data: {
          assetId,
          attachmentId: attachment.id,
          documentType: dto.documentType as never,
          title: dto.title ?? null,
          revision: dto.revision ?? null,
          notes: dto.notes ?? null,
          uploadedById: ctx.user.id,
        },
      });
      await tx.attachment.update({
        where: { id: attachment.id },
        data: { ownerType: 'asset_document', ownerId: doc.id },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'asset_document.linked',
        resourceType: 'asset',
        resourceId: assetId,
        requestId: ctx.requestId,
        metadata: { documentType: dto.documentType, attachmentId: attachment.id },
      });
      return doc;
    });
  }

  private validateSpecification(input: unknown): Record<string, unknown> | null {
    if (input === undefined || input === null) return null;
    const parsed = AssetSpecificationSchema.safeParse(input);
    if (!parsed.success) {
      const details = parsed.error.issues.slice(0, 8).map((i) => ({
        field: i.path.join('.') || 'specification',
        reason: i.message,
      }));
      throw new DomainError('SPECIFICATION_INVALID', 'Asset specification failed schema v1 validation', 422, details);
    }
    return parsed.data as Record<string, unknown>;
  }
}
