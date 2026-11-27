import { randomUUID } from 'node:crypto';

/**
 * Opaque, tenant-namespaced object keys — no PII, no original file names
 * (Tech Spec §13.3). Shared by every storage adapter.
 */
export function tenantObjectKey(tenantId: string): string {
  return `tenants/${tenantId}/${randomUUID()}`;
}
