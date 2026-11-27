import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDbService, type TenantTx } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';
import { RecurrenceRuleSchema, dueDates, generationKey } from './domain/recurrence';
import type { TenantContext } from '../../common/tenant/tenant-context';

/**
 * Maintenance plans + planned visits (Blueprint PM-01, Workflow D).
 *
 * `generateVisits` is IDEMPOTENT by design: each visit carries a deterministic
 * generation_key unique per tenant, so worker retries or concurrent runs can
 * never produce duplicates (Tech Spec §12.5, §22.1 test case). Visits inside
 * the lead window become draft work orders the coordinator reviews.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(ctx: TenantContext, query: { status?: string; cursor?: string; limit?: string }) {
    const page = parsePageQuery(query);
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.maintenancePlan.findMany({
        where: { ...(query.status ? { status: query.status as never } : {}) },
        include: {
          contract: { select: { id: true, contractNo: true } },
          checklistTemplate: { select: { id: true, name: true, activeVersion: true } },
          _count: { select: { assets: true, plannedVisits: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      }),
    );
    return pageResult(
      rows.map((p) => ({
        id: p.id,
        planCode: p.planCode,
        name: p.name,
        assetFamily: p.assetFamily,
        recurrence: p.recurrence,
        startDate: p.startDate,
        endDate: p.endDate,
        horizonDays: p.horizonDays,
        leadDays: p.leadDays,
        status: p.status,
        contract: p.contract,
        checklistTemplate: p.checklistTemplate,
        assetCount: p._count.assets,
        visitCount: p._count.plannedVisits,
      })),
      page.limit,
    );
  }

  async get(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const plan = await tx.maintenancePlan.findFirst({
        where: { id },
        include: {
          contract: { select: { id: true, contractNo: true, contractType: true, status: true } },
          checklistTemplate: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } },
          assets: { include: { asset: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true, status: true } } } },
          plannedVisits: {
            orderBy: { dueAt: 'asc' },
            take: 50,
            include: { workOrder: { select: { id: true, workOrderNo: true, status: true } } },
          },
        },
      });
      if (!plan) throw Errors.notFound('Maintenance plan');
      return plan;
    });
  }

  async create(ctx: TenantContext, dto: Record<string, unknown>) {
    const rule = this.validateRecurrence(dto.recurrence);
    const plan = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const clash = await tx.maintenancePlan.findFirst({ where: { planCode: String(dto.planCode) } });
      if (clash) throw Errors.duplicate('plan code');
      if (dto.contractId) {
        const contract = await tx.serviceContract.findFirst({ where: { id: String(dto.contractId), deletedAt: null } });
        if (!contract) throw Errors.notFound('Contract');
      }
      let templateVersionId: string | null = null;
      if (dto.checklistTemplateId) {
        const template = await tx.checklistTemplate.findFirst({
          where: { id: String(dto.checklistTemplateId), status: 'active' },
          include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        });
        if (!template || template.versions.length === 0) throw Errors.notFound('Checklist template');
        templateVersionId = template.versions[0].id;
      }
      const assetIds = ((dto.assets as Array<{ assetId: string }>) ?? []).map((a) => a.assetId);
      const assets = await tx.asset.findMany({ where: { id: { in: assetIds }, deletedAt: null } });
      if (assets.length !== assetIds.length) throw Errors.notFound('Asset');
      for (const asset of assets) {
        if (asset.assetFamily !== dto.assetFamily) {
          throw new DomainError('ASSET_FAMILY_MISMATCH', `Asset ${asset.assetCode} does not belong to family ${dto.assetFamily}`, 422);
        }
      }
      const created = await tx.maintenancePlan.create({
        data: {
          contractId: dto.contractId ? String(dto.contractId) : null,
          planCode: String(dto.planCode),
          name: String(dto.name),
          assetFamily: dto.assetFamily as never,
          recurrence: rule as unknown as Prisma.InputJsonValue,
          startDate: new Date(String(dto.startDate)),
          endDate: dto.endDate ? new Date(String(dto.endDate)) : null,
          horizonDays: (dto.horizonDays as number) ?? 90,
          leadDays: (dto.leadDays as number) ?? 14,
          checklistTemplateId: dto.checklistTemplateId ? String(dto.checklistTemplateId) : null,
          status: 'draft',
        },
      });
      if (assetIds.length > 0) {
        await tx.maintenancePlanAsset.createMany({
          data: assetIds.map((assetId) => ({ planId: created.id, assetId })),
        });
      }
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'maintenance_plan.created',
        resourceType: 'maintenance_plan',
        resourceId: created.id,
        requestId: ctx.requestId,
        metadata: { planCode: created.planCode, rule, assetCount: assetIds.length },
      });
      return created;
    });
    return this.get(ctx, plan.id);
  }

  async update(ctx: TenantContext, id: string, dto: Record<string, unknown>) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const plan = await tx.maintenancePlan.findFirst({ where: { id } });
      if (!plan) throw Errors.notFound('Maintenance plan');
      const expected = dto.expectedVersion as number | undefined;
      if (expected !== undefined && expected !== plan.version) throw Errors.versionConflict();
      await tx.maintenancePlan.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status as never } : {}),
          ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(String(dto.endDate)) : null } : {}),
          ...(dto.horizonDays !== undefined ? { horizonDays: Number(dto.horizonDays) } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'maintenance_plan.updated',
        resourceType: 'maintenance_plan',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { fields: Object.keys(dto).filter((k) => k !== 'expectedVersion') },
      });
    });
    return this.get(ctx, id);
  }

  /** Preview the visit dates a plan would generate without persisting. */
  async preview(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const plan = await this.loadPlan(tx, id);
      const rule = this.validateRecurrence(plan.recurrence);
      const horizonEnd = addDays(new Date(), plan.horizonDays);
      const effectiveStart = plan.startDate > new Date() ? plan.startDate : startOfToday();
      const dates = dueDates(effectiveStart, horizonEnd, rule);
      const existing = await tx.plannedVisit.findMany({
        where: { planId: plan.id },
        select: { generationKey: true },
      });
      return {
        planCode: plan.planCode,
        assetCount: await tx.maintenancePlanAsset.count({ where: { planId: plan.id } }),
        dates: dates.map((dueAt) => {
          const dateStr = dueAt.toISOString().slice(0, 10);
          const alreadyGenerated = existing.some((v) => v.generationKey.endsWith(`:${dateStr}`));
          return { dueAt, wouldCreate: !alreadyGenerated };
        }),
      };
    });
  }

  /**
   * Generate planned visits for one plan (idempotent). Called by the worker
   * for every active plan and manually on demand. Returns the number of NEW
   * visits; retries return 0.
   */
  async generateVisits(ctxLike: { tenantId: string; requestId?: string; userId?: string }, planId: string): Promise<number> {
    const { tenantId } = ctxLike;
    let created = 0;
    let draftsCreated = 0;
    await this.tenantDb.run(tenantId, async (tx) => {
      const plan = await this.loadPlan(tx, planId);
      if (plan.status !== 'active') return;
      const rule = this.validateRecurrence(plan.recurrence);
      const horizonEnd = addDays(new Date(), plan.horizonDays);
      const effectiveStart = plan.startDate > new Date() ? plan.startDate : startOfToday();
      const assets = await tx.maintenancePlanAsset.findMany({
        where: { planId: plan.id },
        include: { asset: { select: { id: true, siteId: true } } },
      });
      if (assets.length === 0) return;

      for (const membership of assets) {
        for (const dueAt of dueDates(effectiveStart, horizonEnd, rule)) {
          const key = generationKey(plan.id, membership.assetId, dueAt);
          const exists = await tx.plannedVisit.findUnique({ where: { generationKey: key } });
          if (exists) continue;
          // Site/customer resolve through the asset's site.
          const site = await tx.site.findUnique({ where: { id: membership.asset.siteId } });
          if (!site) continue;
          const visit = await tx.plannedVisit.create({
            data: {
              planId: plan.id,
              assetId: membership.assetId,
              dueAt,
              generationKey: key,
              status: 'planned',
            },
          });
          created++;
          // Draft work order when inside the lead window (coordinator reviews
          // and schedules; Tech Spec §12.5).
          const leadMs = plan.leadDays * 86_400_000;
          if (dueAt.getTime() - Date.now() <= leadMs) {
            const workOrderNo = await this.numbering.next(tx, tenantId, 'work_order', 'WO');
            const templateVersionId = plan.checklistTemplateId
              ? (await tx.checklistTemplateVersion.findFirst({
                  where: { templateId: plan.checklistTemplateId },
                  orderBy: { version: 'desc' },
                }))?.id ?? null
              : null;
            const wo = await tx.workOrder.create({
              data: {
                workOrderNo,
                customerId: site.customerId,
                siteId: site.id,
                assetId: membership.assetId,
                title: `PM — ${plan.name} (${membership.assetId.slice(0, 8)})`,
                description: `Auto-generated from maintenance plan ${plan.planCode}. Review, schedule and assign.`,
                type: 'preventive',
                status: 'draft',
                priority: 'normal',
                scheduledStartAt: dueAt,
                scheduledEndAt: new Date(dueAt.getTime() + 4 * 3_600_000),
                responseDueAt: new Date(dueAt.getTime() + 86_400_000),
                resolutionDueAt: new Date(dueAt.getTime() + 7 * 86_400_000),
                slaPolicy: { basis: 'pm_plan', planCode: plan.planCode } as Prisma.InputJsonValue,
                checklistTemplateVersionId: templateVersionId,
                createdById: ctxLike.userId ?? null,
              },
            });
            await tx.plannedVisit.update({ where: { id: visit.id }, data: { workOrderId: wo.id, status: 'scheduled' } });
            await tx.workOrderEvent.create({
              data: { workOrderId: wo.id, eventType: 'created', toStatus: 'draft', metadata: { fromPlan: plan.planCode } },
            });
            draftsCreated++;
          }
        }
      }
      if (created > 0) {
        await this.audit.record(tx, {
          tenantId,
          actorUserId: ctxLike.userId ?? null,
          action: 'maintenance.generated_visits',
          resourceType: 'maintenance_plan',
          resourceId: plan.id,
          requestId: ctxLike.requestId ?? null,
          metadata: { created, draftsCreated },
        });
        await this.notifications.createForRoles(tx, tenantId, ['service_manager', 'coordinator', 'admin', 'owner'], {
          category: 'pm_due',
          title: `${created} PM visit${created === 1 ? '' : 's'} generated`,
          body: `Plan ${plan.planCode} generated ${created} planned visit(s); ${draftsCreated} draft work order(s) ready for scheduling.`,
          entityType: 'maintenance_plan',
          entityId: plan.id,
        });
      }
    });
    return created;
  }

  /** Visits due/overdue for the coordinator queue. */
  async upcomingVisits(ctx: TenantContext, query: { status?: string; cursor?: string; limit?: string }) {
    const page = parsePageQuery(query);
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.plannedVisit.findMany({
        where: { ...(query.status ? { status: query.status as never } : { status: { in: ['planned', 'scheduled'] } }) },
        orderBy: { dueAt: 'asc' },
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: {
          plan: { select: { id: true, planCode: true, name: true } },
          asset: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true, site: { select: { name: true, customer: { select: { legalName: true } } } } } },
          workOrder: { select: { id: true, workOrderNo: true, status: true } },
        },
      }),
    );
    return pageResult(rows, page.limit);
  }

  async markVisitCompleted(tx: TenantTx, visitId: string): Promise<void> {
    await tx.plannedVisit.update({ where: { id: visitId }, data: { status: 'completed', completedAt: new Date() } });
  }

  private async loadPlan(tx: TenantTx, id: string) {
    const plan = await tx.maintenancePlan.findFirst({ where: { id } });
    if (!plan) throw Errors.notFound('Maintenance plan');
    return plan;
  }

  private validateRecurrence(input: unknown) {
    const parsed = RecurrenceRuleSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(
        'RECURRENCE_INVALID',
        'Recurrence rule must be {frequency: week|month|quarter|half_year|year, interval: 1-60, dayOfMonth?}',
        422,
        parsed.error.issues.slice(0, 5).map((i) => ({ field: i.path.join('.') || 'recurrence', reason: i.message })),
      );
    }
    return parsed.data;
  }
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
