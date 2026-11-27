import { describe, expect, it, beforeEach } from "bun:test";
import {
  clearOfflineData,
  enqueueOperation,
  partitionAfterPush,
  readCachedJobPack,
  readQueue,
  readSyncCursor,
  writeCachedJobPack,
  writeSyncCursor,
  type QueuedOperation,
} from "./offline-store";

/**
 * Offline store semantics (audit SEC-01 / DATA-01) — run with `bun test`.
 * localStorage is backed by a minimal in-memory shim so the module's try/
 * catch storage paths are exercised with real key scoping.
 */
const store = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};
(globalThis as unknown as { localStorage: Storage }).localStorage = localStorageShim as Storage;

const op = (id: string, over: Partial<QueuedOperation> = {}): QueuedOperation => ({
  operationId: id,
  entityType: "work_order",
  entityId: "00000000-0000-0000-0000-000000000001",
  operation: "observation",
  baseVersion: 3,
  payload: { text: "Busbar discoloration" },
  deviceObservedAt: "2026-11-01T10:00:00Z",
  queuedAt: "2026-11-01T10:00:00Z",
  label: "Observation — WO-1",
  ...over,
});

beforeEach(() => {
  store.clear();
});

describe("scoped offline caches (SEC-01)", () => {
  it("job pack cache is scoped per user AND tenant", () => {
    writeCachedJobPack("user-a", "tenant-1", { syncedAt: "2026-11-01T00:00:00Z", jobs: [] } as never);
    expect(readCachedJobPack("user-a", "tenant-1")?.syncedAt).toBe("2026-11-01T00:00:00Z");
    expect(readCachedJobPack("user-b", "tenant-1")).toBeNull();
    expect(readCachedJobPack("user-a", "tenant-2")).toBeNull();
  });

  it("queues are scoped per user AND tenant", () => {
    enqueueOperation("user-a", "tenant-1", op("seed"));
    expect(readQueue("user-a", "tenant-1")).toHaveLength(1);
    expect(readQueue("user-a", "tenant-2")).toHaveLength(0);
    expect(readQueue("user-b", "tenant-1")).toHaveLength(0);
  });

  it("clearOfflineData purges every scope plus legacy keys", () => {
    enqueueOperation("user-a", "tenant-1", op("a"));
    enqueueOperation("user-b", "tenant-2", op("b"));
    writeCachedJobPack("user-a", "tenant-1", { syncedAt: "x", jobs: [] } as never);
    writeSyncCursor("user-a", "tenant-1", "cursor");
    store.set("serviceos.jobpack.v1", "legacy");
    store.set("serviceos.syncqueue.v1", "legacy");
    store.set("unrelated.key", "keep");

    clearOfflineData();

    expect(readQueue("user-a", "tenant-1")).toHaveLength(0);
    expect(readQueue("user-b", "tenant-2")).toHaveLength(0);
    expect(readCachedJobPack("user-a", "tenant-1")).toBeNull();
    expect(readSyncCursor("user-a", "tenant-1")).toBeNull();
    expect(store.has("serviceos.jobpack.v1")).toBe(false);
    expect(store.has("serviceos.syncqueue.v1")).toBe(false);
    expect(store.has("unrelated.key")).toBe(true);
  });
});

describe("post-push partitioning (DATA-01 — never clear unacknowledged work)", () => {
  it("removes only accepted and duplicate operations", () => {
    const queue = [op("ok"), op("dupe"), op("conflicted"), op("refused")];
    const results = [
      { operationId: "ok", result: "accepted" as const, serverReceivedAt: "x" },
      { operationId: "dupe", result: "duplicate" as const, serverReceivedAt: "x" },
      { operationId: "conflicted", result: "conflict" as const, serverVersion: 7, serverReceivedAt: "x", error: "VERSION_CONFLICT" },
      { operationId: "refused", result: "rejected" as const, serverReceivedAt: "x", error: "WORK_ORDER_NOT_EXECUTABLE" },
    ];
    const { acknowledged, needsAttention } = partitionAfterPush(queue, results);
    expect(acknowledged.map((o) => o.operationId)).toEqual(["ok", "dupe"]);
    expect(needsAttention.map((o) => o.operationId)).toEqual(["conflicted", "refused"]);
  });

  it("annotates kept operations with the server outcome", () => {
    const queue = [op("c")];
    const results = [
      { operationId: "c", result: "conflict" as const, serverVersion: 9, serverReceivedAt: "x", error: "VERSION_CONFLICT" },
    ];
    const { needsAttention } = partitionAfterPush(queue, results);
    expect(needsAttention[0].lastResult).toBe("conflict");
    expect(needsAttention[0].lastError).toBe("VERSION_CONFLICT");
    expect(needsAttention[0].lastServerVersion).toBe(9);
  });

  it("treats unknown operation ids as acknowledged (defensive: server state is authoritative)", () => {
    const queue = [op("ghost")];
    const { acknowledged, needsAttention } = partitionAfterPush(queue, []);
    expect(acknowledged).toHaveLength(1);
    expect(needsAttention).toHaveLength(0);
  });

  it("keeps 'pending' outcomes for user reconciliation (interrupted server)", () => {
    const queue = [op("p")];
    const results = [{ operationId: "p", result: "pending" as const, serverReceivedAt: "x", error: "SYNC_INTERRUPTED" }];
    const { acknowledged, needsAttention } = partitionAfterPush(queue, results);
    expect(acknowledged).toHaveLength(0);
    expect(needsAttention[0].lastResult).toBe("rejected");
    expect(needsAttention[0].lastError).toContain("SYNC_INTERRUPTED");
  });
});
