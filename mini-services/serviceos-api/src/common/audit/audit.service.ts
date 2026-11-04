import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantTx } from '../tenant/tenant-db.service';

export interface AuditInput {
  tenantId: string;
  actorUserId?: string | null;
  action: string; // e.g. 'customer.created', 'work_order.assigned'
  resourceType: string;
  resourceId: string;
  reason?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit trail. Must be called INSIDE the same tenant transaction
 * as the mutation it describes (Tech Spec §3.1 step 6) so a change and its
 * audit record can never diverge.
 */
@Injectable()
export class AuditService {
  async record(tx: TenantTx, input: AuditInput): Promise<void> {
    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        reason: input.reason ?? null,
        requestId: input.requestId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
