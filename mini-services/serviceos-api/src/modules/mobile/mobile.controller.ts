import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsObject,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { FieldExecutionService } from '../work-orders/field-execution.service';
import { DomainError } from '../../common/errors/domain.error';
import { Defaults } from '../../common/config/env';

class MutationDto {
  @ApiProperty({ format: 'uuid', description: 'Client-generated idempotency id' })
  @IsUUID('all')
  operationId!: string;

  @ApiProperty({ enum: ['work_order'] })
  @IsIn(['work_order'])
  entityType!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  entityId!: string;

  @ApiProperty({ enum: ['transition', 'checklist', 'observation', 'measurement', 'completion', 'acknowledgement'] })
  @IsIn(['transition', 'checklist', 'observation', 'measurement', 'completion', 'acknowledgement'])
  operation!: string;

  @ApiProperty({ example: 12, description: 'Base entity version for optimistic concurrency' })
  @IsInt()
  baseVersion!: number;

  @ApiProperty({ example: { toStatus: 'in_progress', note: 'Started inspection' } })
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiProperty({ example: '2026-11-02T05:30:00Z', description: 'Device clock — server time stays authoritative' })
  @IsISO8601()
  deviceObservedAt!: string;
}

class SyncPushDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  deviceId!: string;

  @ApiProperty({ type: [MutationDto], description: 'At most 500 mutations per push (validated)' })
  @IsArray()
  @ArrayMaxSize(500, { message: 'At most 500 mutations per push' })
  @ValidateNested({ each: true })
  @Type(() => MutationDto)
  mutations!: MutationDto[];
}

/**
 * Mobile sync API (Tech Spec §8.5) — the server-authoritative contract for
 * the offline-first technician client (PWA today, Expo app per ADR-008).
 * Results per mutation: accepted | duplicate | conflict | rejected.
 *
 * Idempotency is ATOMIC (audit DATA-02): the mobile_sync_operations row is
 * INSERTED FIRST as a claim (unique on tenant_id + operation_id) — a
 * concurrent replay of the same operationId can never pass the claim, so the
 * operation is applied exactly once even when two devices/tabs push the same
 * queued mutation simultaneously. The claim is then finalized with the
 * outcome; a crash between apply and finalize leaves an honest `pending`
 * row that replays report as duplicate/pending for user reconciliation.
 */
@ApiTags('mobile')
@ApiBearerAuth()
@Controller('mobile')
@RequirePermissions('work_orders:execute')
export class MobileController {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly workOrders: WorkOrdersService,
    private readonly fieldExecution: FieldExecutionService,
  ) {}

  @Get('job-packs')
  @ApiOperation({
    summary: 'Bounded job pack: assigned work orders with everything needed offline',
    description:
      'Pass `since` (a previous syncedAt/nextSince cursor) to fetch only work orders changed after it (incremental sync). ' +
      'Responses are bounded by `limit` (default 100, max 200); when hasMore=true, call again with since=nextUntilComplete.',
  })
  async jobPacks(
    @CurrentTenant() ctx: TenantContext,
    @Query('since') since?: string,
    @Query('limit') limitParam?: string,
  ) {
    const limit = clampInt(limitParam, Defaults.jobPackDefaultLimit, 1, Defaults.jobPackMaxLimit);
    let sinceDate: Date | undefined;
    if (since) {
      sinceDate = new Date(since);
      if (Number.isNaN(sinceDate.getTime())) {
        throw new DomainError('SYNC_CURSOR_INVALID', 'since must be an ISO-8601 timestamp', 422);
      }
    }
    const syncedAt = new Date();

    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      // Bounded query (audit DATA-07): a technician can never pull an
      // unbounded result set, with or without a cursor.
      const jobs = await tx.workOrder.findMany({
        where: {
          assignments: { some: { userId: ctx.user.id, status: { in: ['offered', 'accepted', 'active'] } } },
          status: { in: ['ready', 'scheduled', 'in_progress', 'on_hold'] },
          ...(sinceDate ? { updatedAt: { gt: sinceDate } } : {}),
        },
        include: {
          customer: { select: { id: true, legalName: true, accountCode: true } },
          site: { select: { id: true, name: true, siteCode: true, address: true, accessInstructions: true, timezone: true } },
          asset: { select: { id: true, assetCode: true, serialNumber: true, assetFamily: true, manufacturer: true, model: true, specification: true } },
          checklistTemplateVersion: { include: { template: { select: { name: true, templateKey: true } } } },
          checklistResults: true,
          measurements: true,
          observations: true,
          partsUsage: true,
          serviceReports: { select: { id: true, reportVersion: true, status: true } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
      const hasMore = jobs.length > limit;
      const page = hasMore ? jobs.slice(0, limit) : jobs;
      return {
        syncedAt: syncedAt.toISOString(),
        since: sinceDate?.toISOString() ?? null,
        // Continue incremental pagination with the last row's updatedAt.
        nextSince: hasMore ? page[page.length - 1].updatedAt.toISOString() : syncedAt.toISOString(),
        hasMore,
        limit,
        jobs: page.map((j) => ({
          ...j,
          checklistDefinition: j.checklistTemplateVersion?.definition ?? null,
        })),
      };
    });
  }

  @Post('sync/push')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Push queued offline mutations (atomic idempotency, conflict-aware)' })
  async push(@CurrentTenant() ctx: TenantContext, @Body() dto: SyncPushDto) {
    const results: Array<{
      operationId: string;
      result: 'accepted' | 'duplicate' | 'conflict' | 'rejected' | 'pending';
      originalResult?: string;
      serverVersion?: number;
      serverReceivedAt: string;
      error?: string;
    }> = [];

    for (const mutation of dto.mutations) {
      const serverReceivedAt = new Date();

      // ATOMIC CLAIM — the insert is serialized by the unique index on
      // (tenant_id, operation_id): exactly one concurrent caller succeeds.
      const claimed = await this.tenantDb.run(ctx.tenantId, async (tx) => {
        try {
          return await tx.mobileSyncOperation.create({
            data: {
              operationId: mutation.operationId,
              deviceId: dto.deviceId,
              userId: ctx.user.id,
              entityType: mutation.entityType,
              entityId: mutation.entityId,
              result: 'pending',
              responsePayload: { claimedAt: serverReceivedAt.toISOString() },
            },
          });
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') return null; // concurrent duplicate
          throw error;
        }
      });

      if (!claimed) {
        // Idempotent replay: report the STORED outcome — never re-apply.
        const existing = await this.tenantDb.run(ctx.tenantId, (tx) =>
          tx.mobileSyncOperation.findUnique({
            where: { tenantId_operationId: { tenantId: ctx.tenantId, operationId: mutation.operationId } },
          }),
        );
        results.push({
          operationId: mutation.operationId,
          result: existing?.result === 'pending' ? 'pending' : 'duplicate',
          originalResult: existing?.result ?? 'pending',
          serverVersion: existing?.serverVersion ?? undefined,
          serverReceivedAt: existing?.receivedAt.toISOString() ?? serverReceivedAt.toISOString(),
          ...(existing?.result === 'pending' ? { error: 'SYNC_INTERRUPTED' } : {}),
        });
        continue;
      }

      // Apply the operation (each service call owns its tenant transaction).
      let outcome: 'accepted' | 'conflict' | 'rejected' = 'accepted';
      let serverVersion: number | undefined;
      let errorCode: string | undefined;
      try {
        switch (mutation.operation) {
          case 'transition':
            await this.workOrders.transition(ctx, mutation.entityId, {
              toStatus: String(mutation.payload.toStatus),
              reason: mutation.payload.reason as string | undefined,
              expectedVersion: mutation.baseVersion,
            });
            break;
          case 'checklist':
            await this.fieldExecution.saveChecklist(
              ctx,
              mutation.entityId,
              ((mutation.payload.items as Array<Record<string, unknown>>) ?? []).map((i) => ({
                itemKey: String(i.itemKey ?? ''),
                outcome: String(i.outcome ?? 'not_checked'),
                value: i.value !== undefined ? Number(i.value) : undefined,
                unit: i.unit !== undefined ? String(i.unit) : undefined,
                note: i.note !== undefined ? String(i.note) : undefined,
                exceptionReason: i.exceptionReason !== undefined ? String(i.exceptionReason) : undefined,
              })),
            );
            break;
          case 'observation':
            await this.fieldExecution.addObservation(ctx, mutation.entityId, {
              text: String(mutation.payload.text ?? ''),
              kind: mutation.payload.kind as string | undefined,
            });
            break;
          case 'measurement':
            await this.fieldExecution.addMeasurement(ctx, mutation.entityId, {
              measurementKey: String(mutation.payload.measurementKey ?? ''),
              measuredValue: Number(mutation.payload.measuredValue),
              unit: String(mutation.payload.unit ?? ''),
              phase: mutation.payload.phase as string | undefined,
              instrumentId: mutation.payload.instrumentId as string | undefined,
              note: mutation.payload.note as string | undefined,
            });
            break;
          case 'completion':
            await this.fieldExecution.recordCompletionSummary(ctx, mutation.entityId, String(mutation.payload.completionSummary ?? ''));
            break;
          case 'acknowledgement':
            await this.fieldExecution.captureAcknowledgement(ctx, mutation.entityId, {
              acknowledgedByName: String(mutation.payload.acknowledgedByName ?? ''),
              acknowledgedByRole: mutation.payload.acknowledgedByRole as string | undefined,
              method: String(mutation.payload.method ?? 'name_confirmation'),
              notSignedReason: mutation.payload.notSignedReason as string | undefined,
            });
            break;
          default:
            throw new DomainError('SYNC_OPERATION_UNKNOWN', `Unknown operation ${mutation.operation}`, 422);
        }
        const updated = await this.tenantDb.run(ctx.tenantId, (tx) =>
          tx.workOrder.findUnique({ where: { id: mutation.entityId }, select: { version: true } }),
        );
        serverVersion = updated?.version;
      } catch (error) {
        if (error instanceof DomainError) {
          errorCode = error.code;
          outcome =
            error.code === 'VERSION_CONFLICT' || error.code === 'WORK_ORDER_INVALID_TRANSITION' || error.code === 'NOT_ASSIGNED'
              ? 'conflict'
              : 'rejected';
        } else {
          errorCode = 'INTERNAL_ERROR';
          outcome = 'rejected';
        }
      }

      // Finalize the claim with the outcome (idempotent record).
      await this.tenantDb.run(ctx.tenantId, (tx) =>
        tx.mobileSyncOperation.update({
          where: { tenantId_operationId: { tenantId: ctx.tenantId, operationId: mutation.operationId } },
          data: {
            result: outcome,
            serverVersion,
            responsePayload: { error: errorCode ?? null },
          },
        }),
      );
      results.push({
        operationId: mutation.operationId,
        result: outcome,
        serverVersion,
        serverReceivedAt: serverReceivedAt.toISOString(),
        ...(errorCode ? { error: errorCode } : {}),
      });
    }
    return { results };
  }

  @Get('sync/status')
  @ApiOperation({ summary: 'Sync cursor + pending diagnostics for this user/device' })
  async status(@CurrentTenant() ctx: TenantContext, @Query('deviceId') deviceId?: string) {
    const { ops, cursor } = await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const ops = await tx.mobileSyncOperation.findMany({
        where: { userId: ctx.user.id, ...(deviceId ? { deviceId } : {}) },
        orderBy: { receivedAt: 'desc' },
        take: 20,
      });
      const latest = await tx.mobileSyncOperation.findFirst({
        where: { userId: ctx.user.id, ...(deviceId ? { deviceId } : {}) },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true },
      });
      return { ops, cursor: latest?.receivedAt ?? null };
    });
    const lastResults = ops.map((o) => o.result);
    return {
      cursor: cursor?.toISOString() ?? null,
      lastSyncAt: cursor?.toISOString() ?? null,
      lastOperations: ops.map((o) => ({
        operationId: o.operationId,
        entityId: o.entityId,
        result: o.result,
        receivedAt: o.receivedAt,
      })),
      summary: {
        accepted: lastResults.filter((r) => r === 'accepted').length,
        conflicts: lastResults.filter((r) => r === 'conflict').length,
        rejected: lastResults.filter((r) => r === 'rejected').length,
        duplicates: lastResults.filter((r) => r === 'duplicate').length,
      },
    };
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
