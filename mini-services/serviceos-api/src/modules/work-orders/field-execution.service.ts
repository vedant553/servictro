import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { EXECUTION_STATUSES } from './domain/work-order-state';
import type { TenantContext } from '../../common/tenant/tenant-context';

/**
 * Technician field execution (Blueprint MOB-03, Workflow C): checklist
 * results with authorized exceptions, typed measurements, observations,
 * parts usage, completion summary and the customer acknowledgement.
 */
@Injectable()
export class FieldExecutionService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  private async loadExecutable(ctx: TenantContext, tx: Prisma.TransactionClient, workOrderId: string) {
    const wo = await tx.workOrder.findFirst({
      where: { id: workOrderId },
      include: {
        assignments: { where: { status: { in: ['offered', 'accepted', 'active'] } } },
        checklistTemplateVersion: true,
      },
    });
    if (!wo) throw Errors.notFound('Work order');
    const assigned = wo.assignments.some((a) => a.userId === ctx.user.id);
    const manager = ctx.permissions.includes('work_orders:execute') && ctx.role !== 'technician';
    if (!assigned && !manager) {
      throw new DomainError('NOT_ASSIGNED', 'You can only capture execution data on work orders assigned to you', 403);
    }
    if (!EXECUTION_STATUSES.includes(wo.status)) {
      throw new DomainError(
        'WORK_ORDER_NOT_EXECUTABLE',
        `Execution data can only be captured while the work order is scheduled, in progress or on hold (current: ${wo.status})`,
        409,
      );
    }
    return wo;
  }

  async saveChecklist(
    ctx: TenantContext,
    workOrderId: string,
    items: Array<{ itemKey: string; outcome: string; value?: number; unit?: string; note?: string; exceptionReason?: string }>,
  ) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const wo = await this.loadExecutable(ctx, tx, workOrderId);
      if (!wo.checklistTemplateVersion) {
        throw new DomainError('NO_CHECKLIST_ASSIGNED', 'This work order has no checklist template snapshot', 422);
      }
      const definition = wo.checklistTemplateVersion.definition as {
        items: Array<{ key: string; type: string; required: boolean; unit?: string; minValue?: number; maxValue?: number }>;
      };
      const definitionByItem = new Map(definition.items.map((i) => [i.key, i]));

      for (const item of items) {
        const def = definitionByItem.get(item.itemKey);
        if (!def) {
          throw new DomainError(
            'CHECKLIST_ITEM_UNKNOWN',
            `Checklist item ${item.itemKey} is not part of the assigned template version`,
            422,
            [{ field: item.itemKey, reason: 'unknown item for this template version' }],
          );
        }
        if (item.outcome === 'exception' && (!item.exceptionReason || item.exceptionReason.trim().length < 4)) {
          throw new DomainError(
            'EXCEPTION_REASON_REQUIRED',
            'Skipping a required item requires an authorized exception reason',
            422,
            [{ field: `${item.itemKey}.exceptionReason`, reason: 'required' }],
          );
        }
        if (def.type === 'measurement') {
          if (item.value === undefined || item.value === null) {
            if (['pass', 'fail'].includes(item.outcome)) {
              throw new DomainError('MEASUREMENT_VALUE_REQUIRED', `Item ${item.itemKey} requires a measured value`, 422);
            }
          } else {
            if (def.minValue !== undefined && item.value < def.minValue) {
              throw new DomainError(
                'MEASUREMENT_OUT_OF_RANGE',
                `Item ${item.itemKey}: value ${item.value} below the approved minimum ${def.minValue}`,
                422,
              );
            }
            if (def.maxValue !== undefined && item.value > def.maxValue) {
              throw new DomainError(
                'MEASUREMENT_OUT_OF_RANGE',
                `Item ${item.itemKey}: value ${item.value} above the approved maximum ${def.maxValue}`,
                422,
              );
            }
          }
        }
        await tx.checklistResult.upsert({
          where: {
            tenantId_workOrderId_templateVersionId_itemKey: {
              workOrderId,
              tenantId: ctx.tenantId,
              templateVersionId: wo.checklistTemplateVersionId as string,
              itemKey: item.itemKey,
            },
          },
          create: {
            workOrderId,
            templateVersionId: wo.checklistTemplateVersionId as string,
            itemKey: item.itemKey,
            outcome: item.outcome as never,
            valueNumeric: item.value !== undefined ? new Prisma.Decimal(item.value) : null,
            unit: item.unit ?? def.unit ?? null,
            note: item.note ?? null,
            exceptionReason: item.exceptionReason ?? null,
            performedById: ctx.user.id,
            observedAt: new Date(),
          },
          update: {
            outcome: item.outcome as never,
            valueNumeric: item.value !== undefined ? new Prisma.Decimal(item.value) : null,
            unit: item.unit ?? def.unit ?? null,
            note: item.note ?? null,
            exceptionReason: item.exceptionReason ?? null,
            performedById: ctx.user.id,
            observedAt: new Date(),
          },
        });
      }
      await tx.workOrderEvent.create({
        data: {
          workOrderId,
          eventType: 'checklist_saved',
          actorUserId: ctx.user.id,
          metadata: { items: items.length },
        },
      });
      await tx.workOrder.update({ where: { id: workOrderId }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'checklist.saved',
        resourceType: 'work_order',
        resourceId: workOrderId,
        requestId: ctx.requestId,
        metadata: { items: items.length },
      });
    });
    return { success: true, saved: items.length };
  }

  async addMeasurement(
    ctx: TenantContext,
    workOrderId: string,
    dto: { measurementKey: string; measuredValue: number; unit: string; phase?: string; instrumentId?: string; calibrationReference?: string; note?: string },
  ) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const wo = await this.loadExecutable(ctx, tx, workOrderId);
      const measurement = await tx.serviceMeasurement.create({
        data: {
          workOrderId,
          assetId: wo.assetId,
          measurementKey: dto.measurementKey,
          measuredValue: new Prisma.Decimal(dto.measuredValue),
          unit: dto.unit,
          phase: dto.phase ?? null,
          instrumentId: dto.instrumentId ?? null,
          calibrationReference: dto.calibrationReference ?? null,
          note: dto.note ?? null,
          recordedById: ctx.user.id,
          deviceObservedAt: new Date(),
        },
      });
      await tx.workOrderEvent.create({
        data: { workOrderId, eventType: 'measurement_added', actorUserId: ctx.user.id, metadata: { key: dto.measurementKey } },
      });
      // Touch the aggregate so incremental job-pack sync (updatedAt cursor)
      // propagates peer captures to other devices (DATA-07).
      await tx.workOrder.update({ where: { id: workOrderId }, data: { updatedAt: new Date() } });
      return measurement;
    });
  }

  async addObservation(ctx: TenantContext, workOrderId: string, dto: { text: string; kind?: string }) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      await this.loadExecutable(ctx, tx, workOrderId);
      const observation = await tx.serviceObservation.create({
        data: {
          workOrderId,
          kind: dto.kind ?? 'observation',
          text: dto.text,
          recordedById: ctx.user.id,
          deviceObservedAt: new Date(),
        },
      });
      await tx.workOrderEvent.create({
        data: { workOrderId, eventType: 'observation_added', actorUserId: ctx.user.id },
      });
      // Touch the aggregate so incremental job-pack sync (updatedAt cursor)
      // propagates peer captures to other devices (DATA-07).
      await tx.workOrder.update({ where: { id: workOrderId }, data: { updatedAt: new Date() } });
      return observation;
    });
  }

  async addPartsUsage(
    ctx: TenantContext,
    workOrderId: string,
    dto: { partCode: string; description?: string; quantity: number; unit?: string; serialOrBatch?: string; note?: string },
  ) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      await this.loadExecutable(ctx, tx, workOrderId);
      const usage = await tx.partUsage.create({
        data: {
          workOrderId,
          partCode: dto.partCode,
          description: dto.description ?? null,
          quantity: new Prisma.Decimal(dto.quantity),
          unit: dto.unit ?? 'nos',
          serialOrBatch: dto.serialOrBatch ?? null,
          note: dto.note ?? null,
          recordedById: ctx.user.id,
        },
      });
      await tx.workOrderEvent.create({
        data: { workOrderId, eventType: 'parts_recorded', actorUserId: ctx.user.id, metadata: { partCode: dto.partCode } },
      });
      // Touch the aggregate so incremental job-pack sync (updatedAt cursor)
      // propagates peer captures to other devices (DATA-07).
      await tx.workOrder.update({ where: { id: workOrderId }, data: { updatedAt: new Date() } });
      return usage;
    });
  }

  async recordCompletionSummary(ctx: TenantContext, workOrderId: string, completionSummary: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      await this.loadExecutable(ctx, tx, workOrderId);
      await tx.workOrder.update({
        where: { id: workOrderId },
        data: { completionSummary, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'work_order.completion_summary',
        resourceType: 'work_order',
        resourceId: workOrderId,
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }

  /**
   * Customer acknowledgement (Blueprint MOB-03): name/role + method. This is
   * an acknowledgement of work performed, clearly NOT a safety certificate
   * (documents + UI label this explicitly).
   */
  async captureAcknowledgement(
    ctx: TenantContext,
    workOrderId: string,
    dto: {
      acknowledgedByName: string;
      acknowledgedByRole?: string;
      method: string;
      signatureAttachmentId?: string;
      notSignedReason?: string;
    },
  ) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id: workOrderId },
        include: { serviceReports: { orderBy: { reportVersion: 'desc' }, take: 1 } },
      });
      if (!wo) throw Errors.notFound('Work order');
      if (!['in_progress', 'pending_review', 'completed'].includes(wo.status)) {
        throw new DomainError(
          'ACKNOWLEDGEMENT_NOT_CAPTUREABLE',
          `Acknowledgement can be captured from in_progress onward (current: ${wo.status})`,
          409,
        );
      }
      if (dto.method === 'not_signed' && (!dto.notSignedReason || dto.notSignedReason.trim().length < 4)) {
        throw new DomainError('NOT_SIGNED_REASON_REQUIRED', 'A reason is required when the customer does not sign', 422);
      }
      const report = wo.serviceReports[0];
      if (!report) {
        throw new DomainError('REPORT_REQUIRED', 'Generate the service report before capturing acknowledgement', 422);
      }
      if (dto.signatureAttachmentId) {
        const attachment = await tx.attachment.findFirst({
          where: { id: dto.signatureAttachmentId, status: 'available' },
        });
        if (!attachment) throw Errors.notFound('Signature attachment');
      }
      await tx.serviceReport.update({
        where: { id: report.id },
        data: {
          acknowledgedByName: dto.acknowledgedByName.trim(),
          acknowledgedByRole: dto.acknowledgedByRole ?? null,
          acknowledgedAt: new Date(),
          acknowledgementMethod: dto.method as never,
          signatureAttachmentId: dto.signatureAttachmentId ?? null,
          notSignedReason: dto.notSignedReason ?? null,
        },
      });
      await tx.workOrderEvent.create({
        data: { workOrderId, eventType: 'acknowledgement_captured', actorUserId: ctx.user.id, metadata: { method: dto.method } },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'report.acknowledgement_captured',
        resourceType: 'work_order',
        resourceId: workOrderId,
        requestId: ctx.requestId,
        metadata: { method: dto.method },
      });
    });
    return { success: true };
  }
}
