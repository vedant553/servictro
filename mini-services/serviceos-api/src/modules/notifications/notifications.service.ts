import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../../common/tenant/tenant-db.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { NotificationCategory } from '@serviceos/contracts';

export interface CreateNotificationInput {
  category: NotificationCategory;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  /**
   * Deduplication key (audit DATA-05): when set, at most ONE notification per
   * (tenant, user, key) ever exists — enforced by a unique partial index.
   * Used by scheduled passes (renewal reminders) so worker restarts,
   * multiple instances or clock drift can never produce duplicate alerts.
   */
  dedupKey?: string;
}

/**
 * In-app notifications are written inside the business transaction (real,
 * immediately visible). External channels (email/WhatsApp) are dispatched via
 * the transactional outbox — without provider credentials they are recorded
 * as `skipped_dev_no_provider` and NEVER reported as sent (ADR-011).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly outbox: OutboxService) {}

  async create(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    category: NotificationCategory,
    title: string,
    body: string,
    entityType?: string,
    entityId?: string,
    link?: string,
    dedupKey?: string,
  ): Promise<string | null> {
    if (dedupKey) {
      const existing = await tx.notification.findFirst({ where: { tenantId, userId, dedupKey } });
      if (existing) return null; // already notified — idempotent
    }
    const notification = await tx.notification.create({
      data: {
        tenantId,
        userId,
        category,
        title,
        body,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        link: link ?? null,
        dedupKey: dedupKey ?? null,
      },
    });
    await this.outbox.publish(tx, {
      tenantId,
      eventType: 'notification.email',
      aggregateType: 'notification',
      aggregateId: notification.id,
      payload: { category, title, notificationIds: [notification.id] },
    });
    return notification.id;
  }

  /**
   * Notify every active member holding one of the given roles. With a
   * dedupKey, already-notified members are skipped (and a notification lost
   * to a concurrent race is silently dropped — the unique index keeps the
   * guarantee absolute).
   */
  async createForRoles(
    tx: TenantTx,
    tenantId: string,
    roles: string[],
    input: CreateNotificationInput,
  ): Promise<string[]> {
    const memberships = await tx.membership.findMany({
      where: { tenantId, status: 'active', role: { in: roles as never[] } },
      select: { userId: true },
    });
    if (memberships.length === 0) return [];

    const existing = new Set<string>();
    if (input.dedupKey) {
      const rows = await tx.notification.findMany({
        where: { tenantId, userId: { in: memberships.map((m) => m.userId) }, dedupKey: input.dedupKey },
        select: { userId: true },
      });
      for (const row of rows) existing.add(row.userId);
    }

    const notificationIds: string[] = [];
    for (const m of memberships) {
      if (existing.has(m.userId)) continue;
      let created: { id: string } | null;
      try {
        created = await tx.notification.create({
          data: {
            userId: m.userId,
            category: input.category,
            title: input.title,
            body: input.body,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            link: input.link ?? null,
            dedupKey: input.dedupKey ?? null,
          },
        });
      } catch (error) {
        // Unique-index race with a concurrent pass — the member was notified.
        if ((error as { code?: string }).code === 'P2002') continue;
        throw error;
      }
      notificationIds.push(created.id);
    }
    if (notificationIds.length === 0) return [];
    await this.outbox.publish(tx, {
      tenantId,
      eventType: 'notification.email',
      aggregateType: 'notification',
      aggregateId: notificationIds[0],
      payload: { category: input.category, title: input.title, notificationIds },
    });
    return notificationIds;
  }

  async listForUser(tx: TenantTx, tenantId: string, userId: string, unreadOnly: boolean, limit: number, cursor?: string) {
    return tx.notification.findMany({
      where: { tenantId, userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async unreadCount(tx: TenantTx, tenantId: string, userId: string): Promise<number> {
    return tx.notification.count({ where: { tenantId, userId, readAt: null } });
  }

  async markRead(tx: TenantTx, tenantId: string, userId: string, id: string): Promise<boolean> {
    const result = await tx.notification.updateMany({
      where: { id, tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count > 0;
  }

  async markAllRead(tx: TenantTx, tenantId: string, userId: string): Promise<number> {
    const result = await tx.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  /**
   * DEV-ONLY email channel implementation. Clearly labelled: nothing is sent,
   * nothing is claimed to be sent. With provider credentials configured this
   * is where the SES/WhatsApp adapter activates (ADR-011). Called by the
   * worker for outbox `notification.email` events.
   */
  async recordEmailDelivery(
    tx: TenantTx,
    tenantId: string,
    notificationId: string,
    reason?: string,
  ): Promise<void> {
    await tx.notificationDelivery.create({
      data: {
        tenantId,
        notificationId,
        channel: 'email',
        status: 'skipped_dev_no_provider',
        error: reason ?? 'No email provider credentials configured in this environment',
      },
    });
  }
}
