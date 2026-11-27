import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantDbService } from '../common/tenant/tenant-db.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { Defaults } from '../common/config/env';
import { childLogger } from '../common/logging/logger';

const log = childLogger({ service: 'serviceos-worker', job: 'outbox' });

/** A claimed event row (lease held until Defaults.outboxLeaseSeconds). */
export interface ClaimedOutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

/**
 * Transactional-outbox dispatcher (audit DATA-06) — extracted from
 * WorkerRunner so the claim/process protocol is unit/integration testable.
 *
 * Claim protocol (safe for multiple worker instances):
 *  1. atomic claim — UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
 *     LOCKED) sets a lease (locked_until = now + lease). A second instance
 *     can never claim the same rows; row locks release at statement end and
 *     the lease guards processing time;
 *  2. process — handlers run inside tenant-scoped transactions (app role,
 *     RLS-enforced) exactly like the API;
 *  3. finalize — mark publishedAt (success) or attempts++ (failure, retried
 *     until the dead-letter threshold); the lease is always cleared.
 *
 * A crashed worker leaves claimed rows with a live lease; after the lease
 * expires the rows become claimable again — no event is lost, and handlers
 * are idempotent on replay (notification deliveries are dedup-keyed).
 */
@Injectable()
export class OutboxDispatcher {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly notifications: NotificationsService,
  ) {}

  /** One dispatch cycle. `poller` = least-privilege worker-role client. */
  async dispatchOnce(
    poller: PrismaClient,
    workerId: string,
    batchSize = 50,
  ): Promise<{ claimed: number; published: number; failed: number }> {
    const claimed = await claimEvents(poller, workerId, batchSize);
    if (claimed.length === 0) return { claimed: 0, published: 0, failed: 0 };

    let published = 0;
    let failed = 0;
    for (const event of claimed) {
      try {
        await this.tenantDb.run(event.tenantId, async (tx) => {
          await this.handleOutboxEvent(event, tx);
        });
        await poller.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), lockedUntil: null, lockedBy: null },
        });
        published++;
      } catch (error) {
        const attempts = event.attempts + 1;
        const dead = attempts >= 10;
        await poller.outboxEvent
          .update({
            where: { id: event.id },
            data: {
              attempts,
              lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
              lockedUntil: null,
              lockedBy: null,
              // Dead-letter: stop retrying but keep the error visible.
              ...(dead ? { publishedAt: new Date() } : {}),
            },
          })
          .catch(() => undefined);
        failed++;
        log.warn({ eventId: event.id, eventType: event.eventType, attempts, dead }, 'outbox_event_failed');
      }
    }
    return { claimed: claimed.length, published, failed };
  }

  private async handleOutboxEvent(
    event: ClaimedOutboxEvent,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    switch (event.eventType) {
      case 'notification.email': {
        const payload = (event.payload ?? {}) as { notificationIds?: string[] };
        // DEV no-op channel (ADR-011): records an honest
        // `skipped_dev_no_provider` delivery row — nothing is ever claimed to
        // have been sent. With SES/WhatsApp credentials this is where the
        // real provider adapter activates.
        for (const notificationId of payload.notificationIds ?? []) {
          await this.notifications.recordEmailDelivery(tx, event.tenantId, notificationId);
        }
        return;
      }
      case 'request.created':
      case 'work_order.assigned': {
        // In-app notifications were already written transactionally; these
        // events exist for future webhook/ERP fan-out (integration foundation).
        return;
      }
      default:
        return;
    }
  }
}

/**
 * Atomic claim: SELECT unpublished, unleased, under-attempt events with
 * FOR UPDATE SKIP LOCKED and stamp a processing lease on them in the same
 * statement. Two statements could race; one statement cannot.
 */
async function claimEvents(
  poller: PrismaClient,
  workerId: string,
  batchSize: number,
): Promise<ClaimedOutboxEvent[]> {
  const rows = await poller.$queryRaw<ClaimedOutboxEvent[]>`
    UPDATE outbox_events
       SET locked_until = now() + (${Defaults.outboxLeaseSeconds} * interval '1 second'),
           locked_by    = ${workerId}
     WHERE id IN (
       SELECT id
         FROM outbox_events
        WHERE published_at IS NULL
          AND attempts < 10
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, tenant_id AS "tenantId", event_type AS "eventType", payload, attempts`;
  return rows;
}
