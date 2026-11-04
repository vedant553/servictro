import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDbService, type TenantTx } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { NumberingService } from '../../common/numbering/numbering.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContractsService } from '../contracts/contracts.service';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';
import { WORK_ORDER_OPEN_STATUSES, assertWorkOrderTransition, checklistComplete } from './domain/work-order-state';
import { Defaults } from '../../common/config/defaults';
import type { TenantContext } from '../../common/tenant/tenant-context';
import type { WorkOrderStatus } from '@serviceos/contracts';

/**
 * Work order lifecycle (Blueprint WO-01/WO-02/DIS-01; Tech Spec §9.2/§12).
 *
 * One transaction per state change: aggregate update + work_order_events +
 * audit_events + outbox_events commit atomically (Tech Spec §9.3). SLA policy
 * is snapshotted at creation so later tenant config changes never rewrite
 * history (Tech Spec §12.4).
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly numbering: NumberingService,
    private readonly notifications: NotificationsService,
    private readonly contracts: ContractsService,
    private readonly requests: ServiceRequestsService,
  ) {}

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async list(
    ctx: TenantContext,
    query: {
      status?: string; customerId?: string; siteId?: string; assetId?: string; assignedTo?: string;
      overdue?: string; search?: string; cursor?: string; limit?: string;
    },
  ) {
    const page = parsePageQuery(query);
    const baseWhere: Prisma.WorkOrderWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.assetId ? { assetId: query.assetId } : {}),
      ...(query.assignedTo ? { assignments: { some: { userId: query.assignedTo, status: { in: ['offered', 'accepted', 'active'] } } } } : {}),
      ...(query.overdue === 'true'
        ? { status: { in: WORK_ORDER_OPEN_STATUSES.filter((s) => s !== 'completed') }, resolutionDueAt: { lt: new Date() } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { workOrderNo: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // Technicians only ever see their own assigned jobs (MOB-01 invariant).
    const where: Prisma.WorkOrderWhereInput =
      ctx.role === 'technician' && !query.assignedTo
        ? { ...baseWhere, assignments: { some: { userId: ctx.user.id, status: { in: ['offered', 'accepted', 'active'] } } } }
        : baseWhere;
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.workOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: {
          customer: { select: { id: true, legalName: true, accountCode: true } },
          site: { select: { id: true, name: true, siteCode: true } },
          asset: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true } },
          assignments: {
            where: { status: { in: ['offered', 'accepted', 'active'] } },
            include: { user: { select: { id: true, displayName: true } } },
          },
          serviceReports: { select: { id: true, reportVersion: true, status: true }, orderBy: { reportVersion: 'desc' }, take: 1 },
        },
      }),
    );
    return pageResult(rows, page.limit);
  }

  async get(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const wo = await this.loadForDetail(tx, id);
      this.assertCanView(ctx, wo);
      return wo;
    });
  }

  /** Technician "My Jobs": only assigned jobs + the bounded job pack (MOB-01). */
  async myJobs(ctx: TenantContext, query: { cursor?: string; limit?: string; status?: string }) {
    if (ctx.role !== 'technician' && ctx.role !== 'coordinator' && ctx.role !== 'service_manager') {
      // Any role may call /my-jobs; the filter is what matters.
    }
    const page = parsePageQuery(query);
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.workOrder.findMany({
        where: {
          assignments: { some: { userId: ctx.user.id, status: { in: ['offered', 'accepted', 'active'] } } },
          ...(query.status ? { status: query.status as never } : {}),
        },
        orderBy: [{ scheduledStartAt: 'asc' }, { createdAt: 'desc' }],
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: {
          customer: { select: { id: true, legalName: true } },
          site: { select: { id: true, name: true, siteCode: true, address: true, accessInstructions: true, timezone: true } },
          asset: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true, manufacturer: true, model: true, specification: true } },
        },
      }),
    );
    return pageResult(rows, page.limit);
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  async create(ctx: TenantContext, dto: Record<string, unknown>) {
    const created = await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.createInternal(tx, ctx, dto, null),
    );
    return this.get(ctx, created.id);
  }

  /**
   * Convert an accepted request into a work order — ONE transaction:
   * work order + request linkage + state history + audit + outbox (§9.3).
   */
  async convertRequest(ctx: TenantContext, requestId: string, dto: Record<string, unknown>) {
    const created = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const request = await tx.serviceRequest.findFirst({ where: { id: requestId } });
      if (!request) throw Errors.notFound('Service request');
      if (!['accepted', 'triaged'].includes(request.status)) {
        throw new DomainError(
          'REQUEST_NOT_CONVERTIBLE',
          `Only triaged or accepted requests can be converted (current: ${request.status})`,
          409,
        );
      }
      // Entitlement check displayed to the coordinator (SR-02): coverage is a
      // recommendation; an authorized user may override with a reason.
      const coverage = request.assetId ? await this.contracts.coverageForAsset(tx, request.assetId) : null;
      if (coverage && !coverage.covered && !dto.coverageOverrideReason) {
        throw new DomainError(
          'CONTRACT_NOT_COVERED',
          'Asset has no active warranty/AMC coverage — provide a coverageOverrideReason to proceed',
          422,
          [{ field: 'coverageOverrideReason', reason: 'required when asset is out of coverage' }],
        );
      }
      const wo = await this.createInternal(
        tx,
        ctx,
        {
          customerId: request.customerId,
          siteId: request.siteId,
          assetId: request.assetId,
          title: request.subject,
          description: request.description,
          type: dto.type,
          priority: dto.priority,
          severity: request.severity,
          requiredSkills: dto.requiredSkills,
          checklistTemplateId: dto.checklistTemplateId,
        },
        request.id,
      );
      await this.requests.markConverted(tx, ctx.tenantId, requestId);
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'work_order.converted_from_request',
        resourceType: 'work_order',
        resourceId: wo.id,
        requestId: ctx.requestId,
        metadata: {
          requestNo: request.requestNo,
          covered: coverage?.covered ?? null,
          coverageOverrideReason: dto.coverageOverrideReason ?? null,
        },
      });
      return wo;
    });
    return this.get(ctx, created.id);
  }

  // -------------------------------------------------------------------------
  // Assignment
  // -------------------------------------------------------------------------

  async assign(ctx: TenantContext, workOrderId: string, dto: { userId: string; assignmentRole?: string }) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const wo = await tx.workOrder.findFirst({ where: { id: workOrderId } });
      if (!wo) throw Errors.notFound('Work order');
      if (wo.status === 'closed' || wo.status === 'cancelled') {
        throw new DomainError('WORK_ORDER_NOT_ASSIGNABLE', `A ${wo.status} work order cannot be assigned`, 409);
      }
      // Membership + skill check: technician must be an active member of THIS tenant.
      const membership = await tx.membership.findFirst({
        where: { tenantId: ctx.tenantId, userId: dto.userId, status: 'active' },
      });
      if (!membership) throw new DomainError('USER_NOT_IN_TENANT', 'That user is not an active member of this organization', 422);
      if (membership.role !== 'technician' && !['coordinator', 'service_manager'].includes(membership.role)) {
        throw new DomainError('USER_NOT_FIELD_ROLE', 'Work orders are assigned to technicians (or coordinators acting as leads)', 422);
      }
      // Replace existing active assignments (single-technician model for MVP;
      // crew scheduling is a documented later step).
      await tx.workOrderAssignment.updateMany({
        where: { workOrderId, status: { in: ['offered', 'accepted', 'active'] } },
        data: { status: 'rejected', completedAt: new Date() },
      });
      await tx.workOrderAssignment.create({
        data: {
          workOrderId,
          userId: dto.userId,
          assignmentRole: dto.assignmentRole ?? 'technician',
          status: 'offered',
        },
      });
      await tx.workOrderEvent.create({
        data: {
          workOrderId,
          eventType: 'assigned',
          actorUserId: ctx.user.id,
          metadata: { userId: dto.userId, role: dto.assignmentRole ?? 'technician' },
        },
      });
      await tx.workOrder.update({ where: { id: workOrderId }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'work_order.assigned',
        resourceType: 'work_order',
        resourceId: workOrderId,
        requestId: ctx.requestId,
        metadata: { userId: dto.userId },
      });
      await this.notifications.create(
        tx,
        ctx.tenantId,
        dto.userId,
        'work_order_assigned',
        `Assigned: ${wo.workOrderNo}`,
        `${wo.title} — ${wo.priority} priority. Check My Jobs for the full job pack.`,
        'work_order',
        workOrderId,
      );
      await this.outbox.publish(tx, {
        tenantId: ctx.tenantId,
        eventType: 'work_order.assigned',
        aggregateType: 'work_order',
        aggregateId: workOrderId,
        payload: { workOrderNo: wo.workOrderNo, userId: dto.userId },
      });
    });
    return this.get(ctx, workOrderId);
  }

  // -------------------------------------------------------------------------
  // Scheduling / scope updates
  // -------------------------------------------------------------------------

  /** Update the schedule window and scope of an open work order (DIS-01). */
  async updateOpen(ctx: TenantContext, id: string, dto: Record<string, unknown>) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const wo = await tx.workOrder.findFirst({ where: { id } });
      if (!wo) throw Errors.notFound('Work order');
      if (['closed', 'cancelled'].includes(wo.status)) {
        throw new DomainError('WORK_ORDER_IMMUTABLE', 'Closed or cancelled work orders cannot be edited (corrections create a new report version)', 409);
      }
      const expected = dto.expectedVersion as number | undefined;
      if (expected !== undefined && expected !== wo.version) throw Errors.versionConflict();
      const start = dto.scheduledStartAt !== undefined ? (dto.scheduledStartAt ? new Date(String(dto.scheduledStartAt)) : null) : wo.scheduledStartAt;
      const end = dto.scheduledEndAt !== undefined ? (dto.scheduledEndAt ? new Date(String(dto.scheduledEndAt)) : null) : wo.scheduledEndAt;
      if (start && end && end <= start) {
        throw new DomainError('SCHEDULE_WINDOW_INVALID', 'Scheduled end must be after the scheduled start', 422);
      }
      await tx.workOrder.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: String(dto.title).trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description as string } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority as never } : {}),
          ...(dto.requiredSkills !== undefined ? { requiredSkills: dto.requiredSkills as string[] } : {}),
          scheduledStartAt: start,
          scheduledEndAt: end,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'work_order.scheduled_updated',
        resourceType: 'work_order',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { fields: Object.keys(dto).filter((k) => k !== 'expectedVersion') },
      });
    });
    return this.get(ctx, id);
  }

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------

  async transition(ctx: TenantContext, id: string, dto: { toStatus: string; reason?: string; expectedVersion?: number }) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id },
        include: {
          assignments: { where: { status: { in: ['offered', 'accepted', 'active'] } } },
          checklistTemplateVersion: true,
          checklistResults: true,
          serviceReports: { orderBy: { reportVersion: 'desc' }, take: 1 },
        },
      });
      if (!wo) throw Errors.notFound('Work order');
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== wo.version) throw Errors.versionConflict();
      const to = dto.toStatus as WorkOrderStatus;
      assertWorkOrderTransition(wo.status, to);

      const isAssignedTechnician = wo.assignments.some((a) => a.userId === ctx.user.id);
      const isManager =
        ctx.permissions.includes('work_orders:transition') && ctx.role !== 'technician';

      // Technicians may only execute transitions on their own jobs; managers
      // may transition anything they are permitted to (privilege escalation
      // guard — a technician cannot manage others' jobs, §22.1 test case).
      if (!isManager && !isAssignedTechnician) {
        throw new DomainError('NOT_ASSIGNED', 'You can only execute work orders assigned to you', 403);
      }

      switch (to) {
        case 'scheduled': {
          if (!wo.scheduledStartAt) {
            throw new DomainError(
              'SCHEDULE_WINDOW_REQUIRED',
              'A scheduled visit must include a time window (or transition to on_hold with a reason)',
              422,
            );
          }
          break;
        }
        case 'in_progress': {
          if (wo.assignments.length === 0) {
            throw new DomainError('ASSIGNMENT_REQUIRED', 'Assign a technician before starting work', 422);
          }
          if (isAssignedTechnician && !isManager) {
            await tx.workOrderAssignment.updateMany({
              where: { workOrderId: id, userId: ctx.user.id },
              data: { status: 'active', acceptedAt: new Date() },
            });
          }
          break;
        }
        case 'pending_review': {
          if (!wo.completionSummary) {
            throw new DomainError(
              'COMPLETION_SUMMARY_REQUIRED',
              'Record the work performed summary before submitting for review',
              422,
              [{ field: 'completionSummary', reason: 'required' }],
            );
          }
          if (wo.checklistTemplateVersion) {
            const definition = wo.checklistTemplateVersion.definition as {
              items: Array<{ key: string; required: boolean }>;
            };
            const results = new Map(
              wo.checklistResults.map((r) => [r.itemKey, { outcome: r.outcome, exceptionReason: r.exceptionReason }]),
            );
            const { complete, missing } = checklistComplete(definition, results);
            if (!complete) {
              throw new DomainError(
                'CHECKLIST_INCOMPLETE',
                'Required checklist items are incomplete',
                422,
                missing.slice(0, 10).map((key) => ({ field: key, reason: 'required item missing a definite outcome' })),
              );
            }
          }
          break;
        }
        case 'completed': {
          const latestReport = wo.serviceReports[0];
          if (!latestReport || !['approved', 'published'].includes(latestReport.status)) {
            throw new DomainError(
              'REPORT_APPROVAL_REQUIRED',
              'A service report must be generated and approved before completion',
              422,
            );
          }
          if (!isManager) {
            throw Errors.permissionDenied('work_orders:review');
          }
          break;
        }
        case 'closed': {
          const latestReport = wo.serviceReports[0];
          if (!latestReport || latestReport.status !== 'published') {
            throw new DomainError('REPORT_NOT_PUBLISHED', 'Publish the service report before closing', 422);
          }
          if (!latestReport.acknowledgedAt) {
            throw new DomainError(
              'ACKNOWLEDGEMENT_REQUIRED',
              'Capture the customer acknowledgement before closing',
              422,
            );
          }
          break;
        }
        case 'cancelled': {
          if (!dto.reason || dto.reason.trim().length < 4) {
            throw new DomainError(
              'REASON_REQUIRED',
              'Cancellation requires a reason',
              422,
              [{ field: 'reason', reason: 'required' }],
            );
          }
          break;
        }
        default:
          break;
      }

      await tx.workOrder.update({
        where: { id },
        data: {
          status: to,
          version: { increment: 1 },
          ...(to === 'completed' ? { completedAt: new Date() } : {}),
          ...(to === 'closed' ? { closedAt: new Date() } : {}),
          ...(to === 'cancelled' ? { cancelledReason: dto.reason ?? null } : {}),
        },
      });
      await tx.workOrderEvent.create({
        data: {
          workOrderId: id,
          eventType: 'status_changed',
          fromStatus: wo.status,
          toStatus: to,
          actorUserId: ctx.user.id,
          reason: dto.reason ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: `work_order.status.${to}`,
        resourceType: 'work_order',
        resourceId: id,
        requestId: ctx.requestId,
        metadata: { from: wo.status, to, reason: dto.reason },
      });
      // Notify assigned technicians about status changes on their jobs.
      for (const assignment of wo.assignments) {
        if (assignment.userId !== ctx.user.id) {
          await this.notifications.create(
            tx,
            ctx.tenantId,
            assignment.userId,
            'work_order_status',
            `${wo.workOrderNo} → ${to.replace(/_/g, ' ')}`,
            dto.reason ? `Reason: ${dto.reason}` : 'Work order status changed.',
            'work_order',
            id,
          );
        }
      }
    });
    return this.get(ctx, id);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async createInternal(
    tx: TenantTx,
    ctx: TenantContext,
    dto: Record<string, unknown>,
    requestId: string | null,
  ) {
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
    // Snapshot the checklist template version at creation (ADR-018).
    let templateVersionId: string | null = null;
    if (dto.checklistTemplateId) {
      const template = await tx.checklistTemplate.findFirst({
        where: { id: String(dto.checklistTemplateId), status: 'active' },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!template || template.versions.length === 0) throw Errors.notFound('Checklist template');
      templateVersionId = template.versions[0].id;
    } else if (asset) {
      const template = await tx.checklistTemplate.findFirst({
        where: { assetFamily: asset.assetFamily, status: 'active' },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      templateVersionId = template?.versions[0]?.id ?? null;
    }

    // SLA policy snapshot: contract targets override tenant defaults (§12.4).
    const severity = (dto.severity as string) ?? 'medium';
    const coverage = asset ? await this.contracts.coverageForAsset(tx, asset.id) : null;
    const activeCoverage = coverage?.contracts.find((c) => c.coverageType !== 'parts_only');
    let contractResponse: number | null = null;
    let contractResolution: number | null = null;
    let contractNo: string | null = null;
    if (activeCoverage) {
      const contractRow = await tx.serviceContract.findUnique({
        where: { id: activeCoverage.contractId },
        select: { responseTargetMinutes: true, resolutionTargetMinutes: true, contractNo: true },
      });
      contractResponse = contractRow?.responseTargetMinutes ?? null;
      contractResolution = contractRow?.resolutionTargetMinutes ?? null;
      contractNo = contractRow?.contractNo ?? null;
    }
    const tenantSettings = await tx.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });
    const settings = (tenantSettings?.settings ?? {}) as {
      slaResponseMinutes?: Record<string, number>;
      slaResolutionMinutes?: Record<string, number>;
    };
    const responseTarget =
      contractResponse ?? settings.slaResponseMinutes?.[severity] ?? Defaults.slaResponseMinutes[severity];
    const resolutionTarget =
      contractResolution ?? settings.slaResolutionMinutes?.[severity] ?? Defaults.slaResolutionMinutes[severity];
    const slaPolicy = {
      basis: contractResponse !== null ? 'contract' : 'tenant_default',
      severity,
      responseMinutes: responseTarget,
      resolutionMinutes: resolutionTarget,
      contractNo,
    };
    const now = Date.now();
    const workOrderNo = await this.numbering.next(tx, ctx.tenantId, 'work_order', 'WO');
    const created = await tx.workOrder.create({
      data: {
        workOrderNo,
        requestId,
        customerId: customer.id,
        siteId: site.id,
        assetId: asset?.id ?? null,
        title: String(dto.title).trim(),
        description: (dto.description as string) ?? null,
        type: dto.type as never,
        status: 'draft',
        priority: (dto.priority as string) as never,
        scheduledStartAt: dto.scheduledStartAt ? new Date(String(dto.scheduledStartAt)) : null,
        scheduledEndAt: dto.scheduledEndAt ? new Date(String(dto.scheduledEndAt)) : null,
        responseDueAt: new Date(now + responseTarget * 60_000),
        resolutionDueAt: new Date(now + resolutionTarget * 60_000),
        slaPolicy: slaPolicy as Prisma.InputJsonValue,
        checklistTemplateVersionId: templateVersionId,
        requiredSkills: (dto.requiredSkills as string[]) ?? [],
        createdById: ctx.user.id,
      },
    });
    await tx.workOrderEvent.create({
      data: { workOrderId: created.id, eventType: 'created', toStatus: 'draft', actorUserId: ctx.user.id },
    });
    await this.audit.record(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.id,
      action: 'work_order.created',
      resourceType: 'work_order',
      resourceId: created.id,
      requestId: ctx.requestId,
      metadata: { workOrderNo, type: created.type, fromRequest: requestId },
    });
    return created;
  }

  private async loadForDetail(tx: TenantTx, id: string) {
    const wo = await tx.workOrder.findFirst({
      where: { id },
      include: {
        customer: { select: { id: true, legalName: true, accountCode: true } },
        site: { select: { id: true, name: true, siteCode: true, address: true, accessInstructions: true, timezone: true } },
        asset: {
          select: {
            id: true, assetCode: true, serialNumber: true, assetFamily: true, manufacturer: true, model: true,
            specification: true, commissioningDate: true,
          },
        },
        request: { select: { id: true, requestNo: true, subject: true, status: true, severity: true } },
        checklistTemplateVersion: { include: { template: { select: { name: true, templateKey: true } } } },
        checklistResults: { orderBy: { createdAt: 'asc' } },
        measurements: { orderBy: { serverReceivedAt: 'desc' } },
        observations: { orderBy: { createdAt: 'desc' } },
        partsUsage: true,
        assignments: {
          where: { status: { in: ['offered', 'accepted', 'active'] } },
          include: { user: { select: { id: true, displayName: true, email: true } } },
        },
        events: { orderBy: { occurredAt: 'desc' }, take: 30 },
        serviceReports: { orderBy: { reportVersion: 'desc' } },
        plannedVisit: { select: { id: true, dueAt: true, status: true } },
      },
    });
    if (!wo) throw Errors.notFound('Work order');
    return wo;
  }

  private assertCanView(ctx: TenantContext, wo: { assignments: Array<{ userId: string }> }): void {
    if (ctx.role === 'technician') {
      const assigned = wo.assignments.some((a) => a.userId === ctx.user.id);
      if (!assigned) {
        throw new DomainError('NOT_ASSIGNED', 'You can only view work orders assigned to you', 403);
      }
    }
  }
}
