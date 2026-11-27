import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';
import { coverageLowerBound, daysBetweenUtcDays } from '../maintenance/domain/expiry';
import type { TenantTx } from '../../common/tenant/tenant-db.service';
import type { TenantContext } from '../../common/tenant/tenant-context';

export interface CoverageSummary {
  covered: boolean;
  contracts: Array<{
    contractId: string;
    contractNo: string;
    contractType: string;
    coverageType: string;
    endDate: Date;
    daysRemaining: number;
  }>;
}

/**
 * Warranty / AMC contract management (Blueprint CTR-01, Workflow D).
 * Renewal never overwrites history: the old contract is marked `renewed` and
 * a new contract row carries the new term (Tech Spec §9.2 RenewContract).
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Entitlement lookup used at request triage/conversion (SR-02). */
  async coverageForAsset(tx: TenantTx, assetId: string): Promise<CoverageSummary> {
    const contractAssets = await tx.contractAsset.findMany({
      where: { assetId, contract: { status: 'active' } },
      include: {
        contract: { select: { id: true, contractNo: true, contractType: true, endDate: true } },
      },
    });
    const now = new Date();
    // A contract ending today stays covered through the END of that UTC day
    // (audit DATA-04) — the old `endDate >= now` revoked the final day early.
    const coveredThrough = coverageLowerBound(now);
    const contracts = contractAssets
      .filter((ca) => ca.contract.endDate >= coveredThrough)
      .map((ca) => ({
        contractId: ca.contract.id,
        contractNo: ca.contract.contractNo,
        contractType: ca.contract.contractType,
        coverageType: ca.coverageType,
        endDate: ca.contract.endDate,
        daysRemaining: daysBetweenUtcDays(ca.contract.endDate, now),
      }));
    return { covered: contracts.length > 0, contracts };
  }

  async list(ctx: TenantContext, query: { customerId?: string; type?: string; status?: string; renewalStatus?: string; cursor?: string; limit?: string }) {
    const page = parsePageQuery(query);
    const where: Prisma.ServiceContractWhereInput = {
      deletedAt: null,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.type ? { contractType: query.type as never } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.renewalStatus ? { renewalStatus: query.renewalStatus as never } : {}),
    };
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.serviceContract.findMany({
        where,
        orderBy: [{ endDate: 'asc' }],
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: {
          customer: { select: { id: true, legalName: true, accountCode: true } },
          _count: { select: { assets: true, maintenancePlans: true } },
        },
      }),
    );
    return pageResult(
      rows.map((c) => ({
        id: c.id,
        contractNo: c.contractNo,
        contractType: c.contractType,
        status: c.status,
        renewalStatus: c.renewalStatus,
        startDate: c.startDate,
        endDate: c.endDate,
        daysRemaining: daysBetweenUtcDays(c.endDate, new Date()),
        currencyCode: c.currencyCode,
        amountMinor: c.amountMinor,
        customer: c.customer,
        coveredAssetCount: c._count.assets,
      })),
      page.limit,
    );
  }

  async get(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const contract = await tx.serviceContract.findFirst({
        where: { id, deletedAt: null },
        include: {
          customer: { select: { id: true, legalName: true, accountCode: true } },
          assets: {
            include: {
              asset: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true, status: true } },
            },
          },
          maintenancePlans: { select: { id: true, planCode: true, name: true, status: true } },
        },
      });
      if (!contract) throw Errors.notFound('Contract');
      return contract;
    });
  }

  async create(ctx: TenantContext, dto: Record<string, unknown>) {
    const contract = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const customer = await tx.customerAccount.findFirst({
        where: { id: String(dto.customerId), deletedAt: null },
      });
      if (!customer) throw Errors.notFound('Customer');
      const startDate = new Date(String(dto.startDate));
      const endDate = new Date(String(dto.endDate));
      if (endDate < startDate) {
        throw new DomainError('CONTRACT_DATES_INVALID', 'Contract end date must not precede its start date', 422);
      }
      if (dto.contractNo) {
        const clash = await tx.serviceContract.findFirst({ where: { contractNo: String(dto.contractNo), deletedAt: null } });
        if (clash) throw Errors.duplicate('contract number');
      }
      const contractNo = dto.contractNo
        ? String(dto.contractNo)
        : await this.numbering.next(tx, ctx.tenantId, 'contract', 'CTR');

      // All covered assets must belong to the same tenant customer chain.
      const assetRows = (dto.assets as Array<Record<string, unknown>>) ?? [];
      const assetIds = assetRows.map((a) => String(a.assetId));
      const assets = await tx.asset.findMany({ where: { id: { in: assetIds }, deletedAt: null } });
      if (assets.length !== assetIds.length) throw Errors.notFound('Asset');
      const site = await tx.site.findUnique({ where: { id: assets[0].siteId } });
      if (!site || site.customerId !== customer.id) {
        throw new DomainError('CONTRACT_ASSET_MISMATCH', 'Covered assets must belong to the contract customer', 422);
      }

      const created = await tx.serviceContract.create({
        data: {
          customerId: customer.id,
          contractNo,
          contractType: dto.contractType as never,
          status: 'active',
          startDate,
          endDate,
          currencyCode: (dto.currencyCode as string) ?? 'INR',
          amountMinor: dto.amountMinor !== undefined ? BigInt(Number(dto.amountMinor)) : null,
          responseTargetMinutes: (dto.responseTargetMinutes as number) ?? null,
          resolutionTargetMinutes: (dto.resolutionTargetMinutes as number) ?? null,
          includedVisitsPerYear: (dto.includedVisitsPerYear as number) ?? null,
          terms: dto.terms ? { note: String(dto.terms) } : {},
        },
      });
      await tx.contractAsset.createMany({
        data: assetRows.map((a) => ({
          contractId: created.id,
          assetId: String(a.assetId),
          coverageType: (a.coverageType as string) as never,
          includedVisits: (a.includedVisits as number) ?? null,
          notes: (a.notes as string) ?? null,
        })),
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'contract.created',
        resourceType: 'contract',
        resourceId: created.id,
        requestId: ctx.requestId,
        metadata: { contractNo, type: created.contractType, assetCount: assetRows.length },
      });
      return created;
    });
    return this.get(ctx, contract.id);
  }

  async update(ctx: TenantContext, id: string, dto: Record<string, unknown>) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const current = await tx.serviceContract.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw Errors.notFound('Contract');
      const expected = dto.expectedVersion as number | undefined;
      if (expected !== undefined && expected !== current.version) throw Errors.versionConflict();
      await tx.serviceContract.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status as never } : {}),
          ...(dto.renewalStatus !== undefined ? { renewalStatus: dto.renewalStatus as never } : {}),
          ...(dto.renewalNotes !== undefined ? { renewalNotes: dto.renewalNotes as string } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'contract.updated',
        resourceType: 'contract',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { fields: Object.keys(dto).filter((k) => k !== 'expectedVersion') },
      });
    });
    return this.get(ctx, id);
  }

  /**
   * Renew: old contract is marked `renewed` (history preserved, never
   * destructively overwritten), a new contract carries the next term with the
   * same covered assets.
   */
  async renew(ctx: TenantContext, id: string, dto: { startDate: string; endDate: string; amountMinor?: number; note?: string }) {
    const newContractId = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const old = await tx.serviceContract.findFirst({ where: { id, deletedAt: null } });
      if (!old) throw Errors.notFound('Contract');
      if (old.status !== 'active') {
        throw new DomainError('CONTRACT_NOT_RENEWABLE', `Only active contracts can be renewed (current: ${old.status})`, 409);
      }
      const startDate = new Date(dto.startDate);
      const endDate = new Date(dto.endDate);
      if (endDate <= startDate) throw new DomainError('CONTRACT_DATES_INVALID', 'Renewal end date must follow its start date', 422);
      const coveredAssets = await tx.contractAsset.findMany({ where: { contractId: id } });
      const contractNo = await this.numbering.next(tx, ctx.tenantId, 'contract', 'CTR');
      const created = await tx.serviceContract.create({
        data: {
          customerId: old.customerId,
          contractNo,
          contractType: old.contractType,
          status: 'active',
          startDate,
          endDate,
          currencyCode: old.currencyCode,
          amountMinor: dto.amountMinor !== undefined ? BigInt(dto.amountMinor) : old.amountMinor,
          responseTargetMinutes: old.responseTargetMinutes,
          resolutionTargetMinutes: old.resolutionTargetMinutes,
          includedVisitsPerYear: old.includedVisitsPerYear,
          terms: old.terms as Prisma.InputJsonValue,
        },
      });
      if (coveredAssets.length > 0) {
        await tx.contractAsset.createMany({
          data: coveredAssets.map((ca) => ({
            contractId: created.id,
            assetId: ca.assetId,
            coverageType: ca.coverageType,
            includedVisits: ca.includedVisits,
            notes: ca.notes,
          })),
        });
      }
      await tx.serviceContract.update({
        where: { id },
        data: { status: 'renewed', renewalStatus: 'renewed', renewalNotes: `Renewed as ${contractNo}. ${dto.note ?? ''}`.trim() },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'contract.renewed',
        resourceType: 'contract',
        resourceId: created.id,
        requestId: ctx.requestId,
        metadata: { previousContractId: id, previousContractNo: old.contractNo, newContractNo: contractNo },
      });
      // Notify contract admins + managers.
      await this.notifications.createForRoles(tx, ctx.tenantId, ['owner', 'admin', 'contract_admin'], {
        category: 'amc_renewal',
        title: `Contract ${old.contractNo} renewed`,
        body: `Renewed as ${contractNo} (${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}).`,
        entityType: 'contract',
        entityId: created.id,
      });
      return created.id;
    });
    return this.get(ctx, newContractId);
  }

  /** Contracts expiring within `days` — renewal pipeline + dashboard. */
  async expiringSoon(ctx: TenantContext, days: number) {
    const now = new Date();
    const until = new Date(coverageLowerBound(now).getTime() + (days + 1) * 86_400_000);
    return this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.serviceContract.findMany({
        where: {
          status: 'active',
          renewalStatus: { in: ['not_due', 'due_soon'] },
          endDate: { lte: until, gte: coverageLowerBound(now) },
        },
        include: { customer: { select: { legalName: true } } },
        orderBy: { endDate: 'asc' },
      }),
    );
  }
}
