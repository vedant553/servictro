import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantDbService } from '../common/tenant/tenant-db.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { MaintenanceService } from '../modules/maintenance/maintenance.service';
import { RenewalRemindersService } from '../modules/maintenance/renewal-reminders.service';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { EnvToken, type Env } from '../common/config/env';
import { childLogger } from '../common/logging/logger';

const log = childLogger({ service: 'serviceos-worker' });

/**
 * Worker processes (Tech Spec §3.1, §14): outbox dispatch, PM generation and
 * renewal reminders — the durable, idempotent background half of the product.
 *
 * Least privilege (audit SEC-03): the poller connects as `serviceos_worker`
 * (see prisma/migrations/20261101154951) — it may claim/update outbox events,
 * read maintenance plans and service contracts across tenants, and update its
 * heartbeat. Nothing else: no DDL, no INSERT/DELETE, no customer data. All
 * business handling runs inside tenant-scoped transactions (app role, RLS).
 *
 * Multi-instance safety (audit DATA-06): outbox events are claimed with
 * FOR UPDATE SKIP LOCKED + an expiring lease; PM/renewal passes are time-
 * gated on the heartbeat row (UPDATE ... WHERE last_pass < threshold), so two
 * instances never double-run a pass. The heartbeat also feeds /health/worker.
 */
@Injectable()
export class WorkerRunner implements OnModuleDestroy {
  /** Cross-tenant poller (least-privilege worker role). Handlers stay tenant-scoped. */
  private readonly poller: PrismaClient;
  private timers: NodeJS.Timeout[] = [];
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private processingOutbox = false;

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly notifications: NotificationsService,
    private readonly maintenance: MaintenanceService,
    private readonly renewalReminders: RenewalRemindersService,
    private readonly outboxDispatcher: OutboxDispatcher,
    @Inject(EnvToken) private readonly env: Env,
  ) {
    this.poller = new PrismaClient({
      datasourceUrl: env.databaseWorkerUrl,
      log: ['warn', 'error'],
    });
  }

  async start(): Promise<void> {
    log.info({ workerId: this.workerId, role: 'serviceos_worker (least privilege)' }, 'worker starting');
    await this.beat('last_outbox_poll_at');
    this.timers.push(setInterval(() => void this.outboxCycle(), this.env.workerPollMs));
    this.timers.push(setInterval(() => void this.pmCycle(), 6 * 3_600_000));
    this.timers.push(setInterval(() => void this.renewalCycle(), 24 * 3_600_000));
    this.timers.push(setInterval(() => void this.beat('last_outbox_poll_at').catch(() => undefined), 30_000));
    // Initial passes shortly after boot.
    setTimeout(() => void this.outboxCycle(), 5_000);
    setTimeout(() => void this.pmCycle(), 20_000);
    setTimeout(() => void this.renewalCycle(), 60_000);
  }

  async onModuleDestroy(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.poller.$disconnect().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Cycles (claim → process → heartbeat)
  // -------------------------------------------------------------------------

  private async outboxCycle(): Promise<void> {
    if (this.processingOutbox) return;
    this.processingOutbox = true;
    try {
      await this.outboxDispatcher.dispatchOnce(this.poller, this.workerId);
      await this.beat('last_outbox_poll_at');
    } catch (error) {
      log.error({ err: error }, 'outbox_poll_failed');
    } finally {
      this.processingOutbox = false;
    }
  }

  private async pmCycle(): Promise<void> {
    const pmLog = childLogger({ service: 'serviceos-worker', job: 'pm' });
    // Time-gate on the heartbeat row: only one instance proceeds per window.
    const won = await this.tryAcquirePass('last_pm_pass_at', 6 * 3_600).catch(() => false);
    if (!won) return;
    try {
      const plans = await this.poller.maintenancePlan.findMany({
        where: { status: 'active' },
        select: { id: true, tenantId: true },
      });
      let total = 0;
      for (const plan of plans) {
        try {
          total += await this.maintenance.generateVisits({ tenantId: plan.tenantId }, plan.id);
        } catch (error) {
          pmLog.warn({ planId: plan.id, err: error }, 'pm_generation_failed');
        }
      }
      if (total > 0) pmLog.info({ plans: plans.length, created: total }, 'pm_visits_generated');
    } catch (error) {
      pmLog.error({ err: error }, 'pm_generation_poll_failed');
    }
  }

  private async renewalCycle(): Promise<void> {
    // Time-gate: one renewal pass per 12h window cluster-wide.
    const won = await this.tryAcquirePass('last_renewal_pass_at', 12 * 3_600).catch(() => false);
    if (!won) return;
    try {
      const { where } = RenewalRemindersService.discoveryQuery(new Date());
      const contracts = await this.poller.serviceContract.findMany({
        where,
        select: { id: true, tenantId: true, contractNo: true, endDate: true, renewalStatus: true },
      });
      await this.renewalReminders.runPass(contracts);
    } catch (error) {
      log.error({ err: error }, 'renewal_poll_failed');
    }
  }

  // -------------------------------------------------------------------------
  // Heartbeat (monitoring — audit INFRA-07)
  // -------------------------------------------------------------------------

  private async beat(field: 'last_outbox_poll_at'): Promise<void> {
    await this.poller.workerHeartbeat.update({
      where: { id: 'singleton' },
      data: { workerId: this.workerId, lastOutboxPollAt: new Date() },
    });
  }

  /**
   * Atomically claim a pass window: the UPDATE only matches when THIS pass
   * column's previous run is older than the threshold — a second instance's
   * UPDATE affects zero rows and skips. Row-level locking serializes
   * concurrent attempts.
   */
  private async tryAcquirePass(
    field: 'last_pm_pass_at' | 'last_renewal_pass_at',
    minIntervalSeconds: number,
  ): Promise<boolean> {
    // Whitelisted column (compile-time union) — safe as raw SQL.
    const column = Prisma.raw(field);
    const rows = await this.poller.$queryRaw<Array<{ won: boolean }>>`
      UPDATE worker_heartbeats
         SET ${column} = now(),
             worker_id = ${this.workerId},
             updated_at = now()
       WHERE id = 'singleton'
         AND (${column} IS NULL OR ${column} < now() - (${minIntervalSeconds} * interval '1 second'))
      RETURNING true AS won`;
    return (rows[0]?.won ?? false) === true;
  }
}
