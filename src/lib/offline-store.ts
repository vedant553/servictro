"use client";

/**
 * Offline store for the technician PWA (audit SEC-01, DATA-01, PWA-04/05).
 *
 * Security & correctness rules:
 *  - EVERY cache/queue key is scoped to (userId, tenantId). A shared browser
 *    profile can never surface one user's job pack, site access notes or
 *    queued captures to another user (or push them under the wrong tenant's
 *    authorization).
 *  - `clearOfflineData()` purges all ServiceOS offline caches + queues —
 *    called on logout and account/workspace switching.
 *  - Queued operations survive page reloads and browser restarts (localStorage
 *    is durable), and are only removed from the queue when the SERVER has
 *    acknowledged them (accepted | duplicate) — conflicts and rejections stay
 *    queued with their outcome until the user explicitly discards or retries.
 */

import type { JobPack, SyncPushResult } from "@/lib/api/types";

const SCOPE_PREFIX = "serviceos.v2";
/** Legacy unscoped keys from the pre-remediation build — always purged. */
const LEGACY_KEYS = ["serviceos.jobpack.v1", "serviceos.syncqueue.v1", "serviceos.deviceid.v1"];

export type QueuedOperation = {
  operationId: string;
  entityType: "work_order";
  entityId: string;
  operation: "transition" | "observation" | "measurement" | "completion";
  baseVersion: number;
  payload: Record<string, unknown>;
  deviceObservedAt: string;
  queuedAt: string;
  label: string;
  /** Outcome of the last push attempt — kept for user acknowledgement. */
  lastResult?: "conflict" | "rejected";
  lastError?: string;
  lastServerVersion?: number;
};

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function scopeKey(kind: string, userId: string, tenantId: string): string {
  return `${SCOPE_PREFIX}.${kind}.${userId}.${tenantId}`;
}

/** Device id is not user data (no PII) but is scoped to the same key family. */
export function deviceId(userId: string): string {
  const key = `${SCOPE_PREFIX}.device.${userId}`;
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = uuid();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "00000000-0000-4000-8000-000000000000";
  }
}

/* ------------------------------------------------------------------ */
/* Job pack cache (read/write helpers)                                 */
/* ------------------------------------------------------------------ */

export function readCachedJobPack(userId: string, tenantId: string): JobPack | null {
  try {
    const raw = localStorage.getItem(scopeKey("jobpack", userId, tenantId));
    return raw ? (JSON.parse(raw) as JobPack) : null;
  } catch {
    return null;
  }
}

export function writeCachedJobPack(userId: string, tenantId: string, pack: JobPack): void {
  try {
    localStorage.setItem(scopeKey("jobpack", userId, tenantId), JSON.stringify(pack));
  } catch {
    /* cache is best-effort */
  }
}

/** Last successful incremental-sync cursor for this scope. */
export function readSyncCursor(userId: string, tenantId: string): string | null {
  try {
    return localStorage.getItem(scopeKey("cursor", userId, tenantId));
  } catch {
    return null;
  }
}

export function writeSyncCursor(userId: string, tenantId: string, cursor: string): void {
  try {
    localStorage.setItem(scopeKey("cursor", userId, tenantId), cursor);
  } catch {
    /* best-effort */
  }
}

/* ------------------------------------------------------------------ */
/* Offline queue                                                        */
/* ------------------------------------------------------------------ */

export function readQueue(userId: string, tenantId: string): QueuedOperation[] {
  try {
    const raw = localStorage.getItem(scopeKey("queue", userId, tenantId));
    const parsed = raw ? (JSON.parse(raw) as QueuedOperation[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeQueue(userId: string, tenantId: string, queue: QueuedOperation[]): void {
  try {
    localStorage.setItem(scopeKey("queue", userId, tenantId), JSON.stringify(queue));
  } catch {
    /* queue persistence is best-effort; the session copy still works */
  }
}

export function enqueueOperation(
  userId: string,
  tenantId: string,
  op: Omit<QueuedOperation, "operationId" | "queuedAt" | "deviceObservedAt">,
): QueuedOperation[] {
  const next: QueuedOperation = {
    ...op,
    operationId: uuid(),
    queuedAt: new Date().toISOString(),
    deviceObservedAt: new Date().toISOString(),
  };
  const queue = [...readQueue(userId, tenantId), next];
  writeQueue(userId, tenantId, queue);
  return queue;
}

/* ------------------------------------------------------------------ */
/* Post-push partitioning (audit DATA-01: never clear unacknowledged)   */
/* ------------------------------------------------------------------ */

export interface PushPartition {
  /** Server acknowledged — safe to remove from the queue. */
  acknowledged: QueuedOperation[];
  /** Server refused — kept in the queue with its outcome for the user. */
  needsAttention: QueuedOperation[];
}

/**
 * Partition a queue against a push response:
 *  - `accepted`/`duplicate` (and unknown operation ids — defensive) are
 *    acknowledged and dropped;
 *  - `conflict`/`rejected`/`pending` operations are KEPT, annotated with the
 *    server outcome so the UI can ask the user to review, retry or discard.
 * A crash between this function and the write leaves the operation queued —
 * the safe direction (worst case: one duplicate the server dedupes).
 */
export function partitionAfterPush(queue: QueuedOperation[], results: SyncPushResult["results"]): PushPartition {
  const byId = new Map(results.map((r) => [r.operationId, r]));
  const acknowledged: QueuedOperation[] = [];
  const needsAttention: QueuedOperation[] = [];
  for (const op of queue) {
    const result = byId.get(op.operationId);
    if (!result || result.result === "accepted" || result.result === "duplicate") {
      acknowledged.push(op);
      continue;
    }
    needsAttention.push({
      ...op,
      lastResult: result.result === "conflict" ? "conflict" : "rejected",
      lastError: result.error ?? (result.result === "pending" ? "Outcome unknown (interrupted)" : undefined),
      lastServerVersion: result.serverVersion,
    });
  }
  return { acknowledged, needsAttention };
}

/* ------------------------------------------------------------------ */
/* Purge (audit SEC-01: logout & account switching)                     */
/* ------------------------------------------------------------------ */

/** True when ANY scope still has queued (unsynced) operations. */
export function anyPendingOperations(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${SCOPE_PREFIX}.queue.`)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed) && parsed.length > 0) return true;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Purge ALL ServiceOS offline data — job packs (site addresses, access
 * instructions, customer names), sync queues, cursors and device ids, plus
 * legacy unscoped keys. Called on logout and on workspace switch; the only
 * durable state intentionally kept is the selected-tenant hint (re-verified
 * server-side on every request).
 */
export function clearOfflineData(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(SCOPE_PREFIX) || LEGACY_KEYS.includes(key))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode) — nothing cached */
  }
}
