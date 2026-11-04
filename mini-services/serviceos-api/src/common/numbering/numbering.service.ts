import { Injectable } from '@nestjs/common';
import type { TenantTx } from '../tenant/tenant-db.service';

/**
 * Tenant-scoped human-readable document numbers (Blueprint §12, ADR-016):
 * SR-2026-000123 / WO-2026-000045 / CTR-2026-000007 / AST-000123.
 *
 * Allocation is atomic: an INSERT … ON CONFLICT DO UPDATE … RETURNING bumps
 * the per-tenant yearly counter under a row lock inside the caller's
 * transaction, so numbers are unique per tenant even under concurrency.
 */
@Injectable()
export class NumberingService {
  async next(tx: TenantTx, tenantId: string, key: string, prefix: string, pad = 6): Promise<string> {
    const year = new Date().getUTCFullYear();
    // Yearly documents (SR/WO/CTR) key their sequence per year; flat
    // sequences (customer, asset) use the bare key — the code format and
    // the sequence key must agree or allocations restart and collide.
    const yearly = ['service_request', 'work_order', 'contract'].includes(key);
    const seqKey = yearly ? `${key}:${year}` : key;
    const rows = await tx.$queryRaw<{ next_value: number }[]>`
      INSERT INTO number_sequences (id, tenant_id, key, prefix, next_value, created_at, updated_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${seqKey}, ${prefix}, 1, now(), now())
      ON CONFLICT (tenant_id, key)
      DO UPDATE SET next_value = number_sequences.next_value + 1, updated_at = now()
      RETURNING next_value
    `;
    const value = Number(rows[0]?.next_value ?? 1);
    return yearly
      ? `${prefix}-${year}-${String(value).padStart(pad, '0')}`
      : `${prefix}-${String(value).padStart(pad, '0')}`;
  }
}
