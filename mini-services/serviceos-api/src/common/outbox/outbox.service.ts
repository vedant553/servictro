import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantTx } from '../tenant/tenant-db.service';

export interface OutboxInput {
  tenantId: string;
  eventType: string; // e.g. 'notification.request_created'
  aggregateType: string; // e.g. 'service_request'
  aggregateId: string;
  payload?: Record<string, unknown>;
}

/**
 * Transactional outbox (Tech Spec §14.2): business transactions append event
 * rows atomically; the worker polls unpublished rows and performs the
 * asynchronous side effects (notifications, reports…). This removes the
 * dual-write failure mode entirely.
 */
@Injectable()
export class OutboxService {
  async publish(tx: TenantTx, input: OutboxInput): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        tenantId: input.tenantId,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
