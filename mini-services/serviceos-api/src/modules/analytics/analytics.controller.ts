import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { parsePageQuery } from '../../common/pagination/pagination';
import { startOfUtcDay } from '../maintenance/domain/expiry';

/**
 * Management analytics (Blueprint ANA-01, Workflow E). Every number is a SQL
 * aggregate over live data — nothing is hardcoded (ADR-019). KPI definitions
 * documented in docs/API.md per the Blueprint KPI dictionary.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@RequirePermissions('analytics:read')
export class AnalyticsController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Operations dashboard KPIs (real aggregates)' })
  async overview(@CurrentTenant() ctx: TenantContext) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const ninetyDaysAhead = new Date(Date.now() + 90 * 86_400_000);
    // Contracts ending today are still covered through end-of-day (DATA-04).
    const startOfToday = startOfUtcDay(new Date());

    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const [
        requestCounts,
        woOpen,
        woOverdue,
        woCompleted30d,
        upcomingPm,
        expiringContracts,
        assetTotal,
        assetComplete,
      ] = await Promise.all([
        tx.serviceRequest.groupBy({ by: ['status'], _count: true, where: {} }),
        tx.workOrder.count({ where: { status: { in: ['draft', 'ready', 'scheduled', 'in_progress', 'on_hold', 'pending_review'] } } }),
        tx.workOrder.count({
          where: {
            status: { in: ['draft', 'ready', 'scheduled', 'in_progress', 'on_hold', 'pending_review'] },
            resolutionDueAt: { lt: new Date() },
          },
        }),
        tx.workOrder.count({ where: { status: { in: ['completed', 'closed'] }, completedAt: { gte: thirtyDaysAgo } } }),
        tx.plannedVisit.count({ where: { status: { in: ['planned', 'scheduled'] }, dueAt: { gte: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) } } }),
        tx.serviceContract.count({ where: { status: 'active', endDate: { lte: ninetyDaysAhead, gte: startOfToday } } }),
        tx.asset.count({ where: { deletedAt: null, status: 'active' } }),
        tx.asset.count({
          where: {
            deletedAt: null,
            status: 'active',
            serialNumber: { not: null },
            commissioningDate: { not: null },
          },
        }),
      ]);

      // Avg resolution time computed in SQL for precision.
      const avgRow = await tx.$queryRaw<{ hours: number | null }[]>`
        SELECT COALESCE(avg(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600.0), 0)::float AS hours
        FROM work_orders
        WHERE tenant_id = ${ctx.tenantId}::uuid AND status = 'closed' AND closed_at IS NOT NULL
      `;

      const slaRow = await tx.$queryRaw<{ met: bigint; total: bigint }[]>`
        SELECT
          count(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at <= resolution_due_at)::bigint AS met,
          count(*)::bigint AS total
        FROM work_orders
        WHERE tenant_id = ${ctx.tenantId}::uuid AND status = 'closed'
      `;

      // Technician workload: open work orders per assigned technician.
      const workloadRows = await tx.workOrderAssignment.findMany({
        where: { status: { in: ['offered', 'accepted', 'active'] }, workOrder: { status: { in: ['scheduled', 'in_progress', 'on_hold', 'ready'] } } },
        select: { userId: true, user: { select: { displayName: true } } },
      });
      const workload = new Map<string, { userId: string; displayName: string; openJobs: number }>();
      for (const row of workloadRows) {
        const entry = workload.get(row.userId) ?? { userId: row.userId, displayName: row.user.displayName, openJobs: 0 };
        entry.openJobs++;
        workload.set(row.userId, entry);
      }

      const requestsByStatus = Object.fromEntries(requestCounts.map((r) => [r.status, r._count]));
      const openRequests = (requestsByStatus.new ?? 0) + (requestsByStatus.triaged ?? 0) + (requestsByStatus.accepted ?? 0) + (requestsByStatus.needs_information ?? 0);

      return {
        generatedAt: new Date(),
        requests: {
          open: openRequests,
          byStatus: requestsByStatus,
          newAwaitingTriage: requestsByStatus.new ?? 0,
        },
        workOrders: {
          open: woOpen,
          overdue: woOverdue,
          completedLast30Days: woCompleted30d,
          averageResolutionHours: Number(avgRow[0]?.hours ?? 0),
          slaAttainmentPercent: Number(slaRow[0]?.total ?? 0) > 0 ? Math.round((Number(slaRow[0]?.met ?? 0) / Number(slaRow[0]?.total ?? 1)) * 100) : null,
        },
        maintenance: {
          upcomingPm30Days: upcomingPm,
        },
        contracts: {
          expiringWithin90Days: expiringContracts,
        },
        assets: {
          activeTotal: assetTotal,
          mandatoryFieldsComplete: assetTotal > 0 ? Math.round((assetComplete / assetTotal) * 100) : null,
        },
        technicianWorkload: Array.from(workload.values()).sort((a, b) => b.openJobs - a.openJobs),
      };
    });
  }

  @Get('service')
  @ApiOperation({ summary: 'Service volume and resolution trend (last 30 days)' })
  async service(@CurrentTenant() ctx: TenantContext, @Query('days') days?: string) {
    const windowDays = days && Number(days) > 0 && Number(days) <= 90 ? Number(days) : 30;
    const since = new Date(Date.now() - windowDays * 86_400_000);
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const volume = await tx.$queryRaw<Array<{ day: string; requests: bigint; workOrders: bigint; closed: bigint }>>`
        WITH days AS (
          SELECT generate_series(${since.toISOString()}::date, now()::date, interval '1 day') AS d
        )
        SELECT
          to_char(days.d, 'YYYY-MM-DD') AS day,
          (SELECT count(*) FROM service_requests sr WHERE sr.tenant_id = ${ctx.tenantId}::uuid AND sr.created_at::date = days.d)::bigint AS requests,
          (SELECT count(*) FROM work_orders wo WHERE wo.tenant_id = ${ctx.tenantId}::uuid AND wo.created_at::date = days.d)::bigint AS "workOrders",
          (SELECT count(*) FROM work_orders wo WHERE wo.tenant_id = ${ctx.tenantId}::uuid AND wo.closed_at::date = days.d)::bigint AS closed
        FROM days ORDER BY days.d
      `;
      return {
        windowDays,
        volume: volume.map((v) => ({
          day: v.day,
          requests: Number(v.requests),
          workOrders: Number(v.workOrders),
          closed: Number(v.closed),
        })),
      };
    });
  }
}
