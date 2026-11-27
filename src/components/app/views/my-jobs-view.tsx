"use client";

/**
 * My jobs — the technician field surface (ADR-008: mobile-first PWA).
 *
 * Remediated behaviours (audit SEC-01 / DATA-01 / PWA-04..06):
 *  - the job pack cache and offline queue are scoped to (user, tenant) and
 *    purged on logout/workspace switch (see lib/offline-store);
 *  - the queue is durable (localStorage) and auto-syncs on reconnect, on
 *    reload and when the service worker fires a background-sync trigger;
 *  - a push NEVER clears operations the server refused: conflicts and
 *    rejections stay listed with their outcome until the technician
 *    explicitly discards or retries them;
 *  - job packs sync incrementally (since-cursor) and pages are bounded.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, ApiError } from "@/lib/api/client";
import type { JobPack, JobPackJob, SyncPushResult, SyncStatusResult } from "@/lib/api/types";
import {
  deviceId,
  enqueueOperation,
  partitionAfterPush,
  readCachedJobPack,
  readQueue,
  readSyncCursor,
  writeCachedJobPack,
  writeQueue,
  writeSyncCursor,
  type QueuedOperation,
} from "@/lib/offline-store";
import { PageHeader, EmptyState, SectionCard, StatCard, InlineError } from "@/components/app/shared/primitives";
import { Field, TextInput } from "@/components/app/shared/form-fields";
import { WORK_ORDER_STATUS_STYLE, PRIORITY_STYLE } from "@/design-system/tokens";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import { fmtDateTime, fmtDue, fmtAddress, fmtRelative } from "@/lib/format";
import { href, navigate } from "@/lib/router";
import { useAuth } from "@/lib/auth/store";
import { requestBackgroundSync } from "@/lib/pwa";
import {
  HardHat,
  RefreshCw,
  CloudOff,
  Cloud,
  MapPin,
  Wrench,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Send,
  RotateCcw,
  Trash2,
} from "lucide-react";

/** Window event fired by app-root when the service worker asks us to sync. */
const SW_SYNC_EVENT = "serviceos:trigger-sync";

export function MyJobsView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);
  const tenantId = useAuth((s) => s.selectedTenantId);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [pushResult, setPushResult] = useState<SyncPushResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.id ?? "anonymous";
  const scope = useMemo(() => ({ userId, tenantId: tenantId ?? "none" }), [userId, tenantId]);

  // Hydrate the durable queue for THIS user+tenant scope (SEC-01).
  useEffect(() => {
    setOnline(navigator.onLine);
    setQueue(readQueue(scope.userId, scope.tenantId));
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [scope]);

  const persistQueue = useCallback(
    (next: QueuedOperation[]) => {
      writeQueue(scope.userId, scope.tenantId, next);
      setQueue(next);
    },
    [scope],
  );

  // Server job pack — bounded + incremental (DATA-07), cached per scope for
  // offline resilience (PWA-04).
  const jobPack = useQuery({
    queryKey: ["mobile", "job-packs", scope.userId, scope.tenantId],
    queryFn: async () => {
      // Incremental: continue from the stored cursor when present; the
      // server pages with hasMore and we loop until complete.
      let cursor = readSyncCursor(scope.userId, scope.tenantId);
      let aggregated: JobPackJob[] | null = null;
      let guard = 0;
      for (;;) {
        guard += 1;
        if (guard > 12) break; // hard client bound: 12 pages × limit
        const data = await apiGet<JobPack>("/api/v1/mobile/job-packs", cursor ? { since: cursor } : undefined);
        if (aggregated === null) aggregated = data.jobs;
        else aggregated = mergeJobs(aggregated, data.jobs);
        writeSyncCursor(scope.userId, scope.tenantId, data.nextSince);
        cursor = data.nextSince;
        if (!data.hasMore) break;
      }
      const pack: JobPack = {
        syncedAt: new Date().toISOString(),
        since: null,
        nextSince: cursor ?? new Date().toISOString(),
        hasMore: false,
        limit: 0,
        jobs: aggregated ?? [],
      };
      writeCachedJobPack(scope.userId, scope.tenantId, pack);
      return pack;
    },
    retry: 1,
    enabled: !!user && !!tenantId,
  });

  const cachedPack = useMemo<JobPack | null>(() => {
    if (jobPack.data) return jobPack.data;
    return readCachedJobPack(scope.userId, scope.tenantId);
  }, [jobPack.data, scope]);

  const jobs = cachedPack?.jobs ?? [];

  const syncStatus = useQuery({
    queryKey: ["mobile", "sync-status", scope.userId, scope.tenantId],
    queryFn: () =>
      apiGet<SyncStatusResult>("/api/v1/mobile/sync/status", { deviceId: deviceId(scope.userId) }),
    enabled: online && !!user && !!tenantId,
  });

  const push = useMutation({
    mutationFn: (ops: QueuedOperation[]) =>
      apiPost<SyncPushResult>("/api/v1/mobile/sync/push", {
        deviceId: deviceId(scope.userId),
        mutations: ops.map((op) => ({
          operationId: op.operationId,
          entityType: op.entityType,
          entityId: op.entityId,
          operation: op.operation,
          baseVersion: op.baseVersion,
          payload: op.payload,
          deviceObservedAt: op.deviceObservedAt,
        })),
      }),
    onSuccess: (result, pushedOps) => {
      setPushResult(result);
      // DATA-01: only server-acknowledged operations leave the queue.
      // Conflicts/rejections stay listed for explicit acknowledgement.
      const { acknowledged, needsAttention } = partitionAfterPush(pushedOps, result.results);
      persistQueue(needsAttention);
      queryClient.invalidateQueries({ queryKey: ["mobile"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      const counts = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0, pending: 0 };
      for (const r of result.results) counts[r.result] += 1;
      const problems = counts.conflict + counts.rejected;
      toast({
        title: problems > 0 ? "Sync finished with items to review" : "Sync complete",
        description:
          `${counts.accepted} accepted · ${counts.conflict} conflicts · ${counts.rejected} rejected · ${counts.duplicate} duplicates.` +
          (problems > 0 ? " Refused items stay in the queue until you review them." : ""),
      });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Sync failed — queued operations are preserved."),
  });

  /** Push everything pending (durable sync — PWA-05). */
  const syncNow = useCallback(() => {
    const pending = readQueue(scope.userId, scope.tenantId);
    if (pending.length === 0) return;
    if (!navigator.onLine) {
      toast({ title: "Still offline", description: "Captures are queued and will sync when the connection returns." });
      return;
    }
    setError(null);
    push.mutate(pending);
  }, [push, scope, toast]);

  // Auto-sync: on reconnect, on load, and when the service worker fires its
  // background-sync trigger (PWA-05: operation after restart/reconnection).
  useEffect(() => {
    const onOnline = () => setTimeout(syncNow, 800);
    const onSwTrigger = () => syncNow();
    window.addEventListener("online", onOnline);
    window.addEventListener(SW_SYNC_EVENT, onSwTrigger);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(SW_SYNC_EVENT, onSwTrigger);
    };
  }, [syncNow]);

  useEffect(() => {
    if (online && queue.length > 0 && !push.isPending && !push.isSuccess) syncNow();
    // Initial-mount durable sync attempt (browser restart case).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const enqueue = useCallback(
    (op: Omit<QueuedOperation, "operationId" | "queuedAt" | "deviceObservedAt">) => {
      const next = enqueueOperation(scope.userId, scope.tenantId, op);
      setQueue(next);
      // Ask the browser to wake us on reconnect (works after tab close too).
      void requestBackgroundSync();
      toast({ title: "Queued offline", description: `${op.label} — syncs automatically when back online.` });
    },
    [scope, toast],
  );

  const discard = useCallback(
    (operationId: string) => {
      persistQueue(readQueue(scope.userId, scope.tenantId).filter((op) => op.operationId !== operationId));
      toast({ title: "Discarded", description: "The capture was removed from this device only." });
    },
    [persistQueue, scope, toast],
  );

  const retry = useCallback(
    (operationId: string) => {
      const current = readQueue(scope.userId, scope.tenantId).map((op) =>
        op.operationId === operationId
          ? { ...op, lastResult: undefined, lastError: undefined, lastServerVersion: undefined }
          : op,
      );
      persistQueue(current);
      setTimeout(syncNow, 50);
    },
    [persistQueue, scope, syncNow],
  );

  const pendingQueue = queue.filter((op) => !op.lastResult);
  const attentionQueue = queue.filter((op) => op.lastResult);

  const openJobs = jobs.filter((j) => !["closed", "cancelled"].includes(j.status));
  const dueSoon = openJobs.filter((j) => {
    const due = fmtDue(j.resolutionDueAt);
    return due.overdue || (j.resolutionDueAt && new Date(j.resolutionDueAt).getTime() - Date.now() < 36 * 3600_000);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My jobs"
        description="Your assigned work pack with site access details. Cached on this device for your account — capture continues offline."
        actions={
          <div className="flex items-center gap-2">
            <TextBadge tone={online ? "success" : "warning"}>
              {online ? <><Cloud className="mr-1 inline size-3.5" aria-hidden /> Online</> : <><CloudOff className="mr-1 inline size-3.5" aria-hidden /> Offline</>}
            </TextBadge>
            <Button
              variant="outline"
              onClick={() => jobPack.refetch()}
              disabled={!online || jobPack.isFetching || !user}
            >
              <RefreshCw className={`mr-1.5 size-4 ${jobPack.isFetching ? "animate-spin" : ""}`} aria-hidden />
              Refresh pack
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Jobs in pack" value={jobs.length} icon={<HardHat />} />
        <StatCard label="Open" value={openJobs.length} icon={<Wrench />} />
        <StatCard label="Due / overdue" value={dueSoon.length} tone={dueSoon.length ? "warning" : "success"} icon={<Clock />} />
        <StatCard
          label="Queued offline"
          value={pendingQueue.length}
          tone={pendingQueue.length ? "warning" : "neutral"}
          icon={<CloudOff />}
          hint={cachedPack ? `pack cached ${fmtRelative(cachedPack.syncedAt)}` : undefined}
        />
      </div>

      {/* Sync state (PWA-06: understandable synchronization + conflict status) */}
      <SectionCard
        title="Synchronization"
        description={
          syncStatus.data?.lastSyncAt
            ? `Last server sync ${fmtDateTime(syncStatus.data.lastSyncAt)} · ${queue.length} item(s) on this device`
            : "Durable queue — captures sync automatically on reconnect"
        }
        actions={
          pendingQueue.length > 0 ? (
            <Button size="sm" onClick={syncNow} disabled={!online || push.isPending}>
              <Send className="mr-1 size-3.5" aria-hidden /> {push.isPending ? "Syncing…" : "Sync now"}
            </Button>
          ) : undefined
        }
      >
        {pendingQueue.length > 0 ? (
          <ul className="space-y-2">
            {pendingQueue.map((op) => (
              <li key={op.operationId} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{op.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {op.operation} · base v{op.baseVersion} · queued {fmtDateTime(op.queuedAt)}
                  </p>
                </div>
                <TextBadge tone="warning">queued</TextBadge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-[color:var(--status-success)]">
            <CheckCircle2 className="size-4" aria-hidden /> Nothing waiting — all captures are synced.
          </p>
        )}
        <InlineError message={error} />
      </SectionCard>

      {/* Conflicts / rejections awaiting acknowledgement (DATA-01) */}
      {attentionQueue.length > 0 ? (
        <SectionCard
          title={`Needs your review (${attentionQueue.length})`}
          description="The server refused these captures. They are kept on this device until you discard or retry them — nothing is silently deleted."
        >
          <ul className="space-y-2">
            {attentionQueue.map((op) => (
              <li
                key={op.operationId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--status-warning)]/50 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{op.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {op.lastResult === "conflict" ? "Conflict" : "Rejected"}
                    {op.lastError ? ` — ${op.lastError}` : ""}
                    {op.lastServerVersion !== undefined ? ` (server at v${op.lastServerVersion})` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <TextBadge tone={op.lastResult === "conflict" ? "warning" : "danger"}>{op.lastResult}</TextBadge>
                  <Button size="sm" variant="outline" onClick={() => retry(op.operationId)}>
                    <RotateCcw className="mr-1 size-3.5" aria-hidden /> Retry
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => discard(op.operationId)}>
                    <Trash2 className="mr-1 size-3.5" aria-hidden /> Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Retry re-sends the capture against the server&apos;s current version; discard removes it from this device only.
            Open the job to see its latest state.
          </p>
        </SectionCard>
      ) : null}

      {/* Last push outcome */}
      {pushResult ? (
        <SectionCard title="Last sync result" description={`${pushResult.results.length} operation(s) processed`}>
          {pushResult.results.some((r) => r.result === "conflict" || r.result === "pending") ? (
            <div className="mb-3 rounded-md border border-[color:var(--status-warning)]/40 bg-[color:var(--status-warning-bg)] p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4 text-[color:var(--status-warning)]" aria-hidden />{" "}
                {pushResult.results.filter((r) => r.result === "conflict" || r.result === "pending").length} conflict(s)
              </p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {pushResult.results
                  .filter((r) => r.result === "conflict" || r.result === "pending")
                  .map((c) => (
                    <li key={c.operationId}>
                      {c.error ?? "conflict"} (server at v{c.serverVersion ?? "?"}; kept in the review list above)
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {pushResult.results.some((r) => r.result === "rejected") ? (
            <div className="rounded-md border border-[color:var(--status-danger)]/40 bg-[color:var(--status-danger-bg)] p-3 text-sm">
              <p className="font-medium">{pushResult.results.filter((r) => r.result === "rejected").length} rejected</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {pushResult.results.filter((r) => r.result === "rejected").map((r) => (
                  <li key={r.operationId}>{r.error ?? r.result}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-[color:var(--status-success)]">
              <CheckCircle2 className="size-4" aria-hidden /> All operations applied cleanly.
            </p>
          )}
        </SectionCard>
      ) : null}

      {/* Job cards */}
      {!jobs.length ? (
        <EmptyState
          icon={<HardHat />}
          title={jobPack.isError && !cachedPack ? "Job pack unavailable" : "No jobs assigned"}
          description={
            jobPack.isError && !cachedPack
              ? online
                ? "The service could not be reached; retry the refresh."
                : "You are offline and no cached pack exists on this device yet."
              : "Once a manager schedules and assigns work, it appears here."
          }
          action={
            jobPack.isError && online ? (
              <Button variant="outline" onClick={() => jobPack.refetch()}>
                Retry
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} online={online} onQueue={enqueue} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Merge a delta page into the cached job list (replace by id, keep order). */
function mergeJobs(base: JobPackJob[], delta: JobPackJob[]): JobPackJob[] {
  if (delta.length === 0) return base;
  const byId = new Map(base.map((j) => [j.id, j]));
  for (const job of delta) byId.set(job.id, job);
  return [...byId.values()];
}

/* ------------------------------------------------------------------ */
/* Job card with quick capture                                         */
/* ------------------------------------------------------------------ */

function JobCard({
  job,
  online,
  onQueue,
}: {
  job: JobPackJob;
  online: boolean;
  onQueue: (op: Omit<QueuedOperation, "operationId" | "queuedAt" | "deviceObservedAt">) => void;
}) {
  const resolutionDue = fmtDue(job.resolutionDueAt);
  const [obsOpen, setObsOpen] = useState(false);
  const [observation, setObservation] = useState("");
  const [measOpen, setMeasOpen] = useState(false);
  const [measurement, setMeasurement] = useState({ measurementKey: "", measuredValue: "", unit: "" });

  const executable = ["scheduled", "in_progress", "on_hold"].includes(job.status);

  const submitOnline = async (action: string, body: unknown) => {
    await apiPost(`/api/v1/work-orders/${job.id}/${action}`, body);
  };

  const captureObservation = () => {
    if (observation.trim().length < 3) return;
    const payload = { text: observation, kind: "observation" };
    if (online) {
      submitOnline("observations", payload)
        .then(() => setObservation(""))
        .catch(() =>
          onQueue({
            entityType: "work_order",
            entityId: job.id,
            operation: "observation",
            baseVersion: job.version,
            payload,
            label: `Observation — ${job.workOrderNo}`,
          }),
        );
    } else {
      onQueue({
        entityType: "work_order",
        entityId: job.id,
        operation: "observation",
        baseVersion: job.version,
        payload,
        label: `Observation — ${job.workOrderNo}`,
      });
    }
    setObservation("");
    setObsOpen(false);
  };

  const captureMeasurement = () => {
    if (!measurement.measurementKey || !measurement.measuredValue || !measurement.unit) return;
    const payload = {
      measurementKey: measurement.measurementKey,
      measuredValue: Number(measurement.measuredValue),
      unit: measurement.unit,
    };
    if (online) {
      submitOnline("measurements", payload)
        .then(() => setMeasurement({ measurementKey: "", measuredValue: "", unit: "" }))
        .catch(() =>
          onQueue({
            entityType: "work_order",
            entityId: job.id,
            operation: "measurement",
            baseVersion: job.version,
            payload,
            label: `Measurement ${payload.measurementKey} — ${job.workOrderNo}`,
          }),
        );
    } else {
      onQueue({
        entityType: "work_order",
        entityId: job.id,
        operation: "measurement",
        baseVersion: job.version,
        payload,
        label: `Measurement ${payload.measurementKey} — ${job.workOrderNo}`,
      });
    }
    setMeasurement({ measurementKey: "", measuredValue: "", unit: "" });
    setMeasOpen(false);
  };

  const suggestedKeys = (job.checklistDefinition?.items ?? []).filter((i) => i.type === "measurement").map((i) => i.key);

  return (
    <Card>
      <CardContent className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{job.workOrderNo}</p>
            <h3 className="font-semibold leading-snug">{job.title}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {job.customer.legalName} · {job.asset ? `${job.asset.assetCode} (${job.asset.assetFamily.replace(/_/g, " ")})` : "site-level"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <StatusBadge style={WORK_ORDER_STATUS_STYLE[job.status]} />
            <StatusBadge style={PRIORITY_STYLE[job.priority]} />
          </div>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              {job.site.name}
              <span className="block text-xs text-muted-foreground">{fmtAddress(job.site.address)}</span>
            </span>
          </p>
          <p className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              {job.scheduledStartAt ? fmtDateTime(job.scheduledStartAt) : "unscheduled"}
              <span className={`block text-xs ${resolutionDue.overdue ? "font-semibold text-[color:var(--status-danger)]" : "text-muted-foreground"}`}>
                resolution {resolutionDue.text}
              </span>
            </span>
          </p>
        </div>

        {job.site.accessInstructions ? (
          <p className="rounded-md border border-[color:var(--status-warning)]/40 bg-[color:var(--status-warning-bg)] p-3 text-xs">
            <span className="font-medium">Site access: </span>
            {job.site.accessInstructions}
          </p>
        ) : null}

        {job.checklistDefinition ? (
          <p className="text-sm text-muted-foreground">
            Checklist: {job.checklistDefinition.items.length} items ({job.checklistDefinition.items.filter((i) => i.required).length} required)
          </p>
        ) : null}

        {obsOpen ? (
          <div className="space-y-2 rounded-lg border p-3">
            <Field label="Observation" htmlFor={`obs-${job.id}`} required>
              <TextInput id={`obs-${job.id}`} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Feeder 3 contacts show pitting…" />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={captureObservation} disabled={observation.trim().length < 3}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setObsOpen(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {measOpen ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Key" htmlFor={`mk-${job.id}`} required>
                <TextInput
                  id={`mk-${job.id}`}
                  list={`mk-list-${job.id}`}
                  value={measurement.measurementKey}
                  onChange={(e) => setMeasurement({ ...measurement, measurementKey: e.target.value })}
                  placeholder="insulation_resistance_mohm"
                />
                <datalist id={`mk-list-${job.id}`}>
                  {suggestedKeys.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </Field>
              <Field label="Value" htmlFor={`mv-${job.id}`} required>
                <TextInput id={`mv-${job.id}`} inputMode="decimal" value={measurement.measuredValue} onChange={(e) => setMeasurement({ ...measurement, measuredValue: e.target.value })} placeholder="550" />
              </Field>
              <Field label="Unit" htmlFor={`mu-${job.id}`} required>
                <TextInput id={`mu-${job.id}`} value={measurement.unit} onChange={(e) => setMeasurement({ ...measurement, unit: e.target.value })} placeholder="MΩ" />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={captureMeasurement} disabled={!measurement.measurementKey || !measurement.measuredValue || !measurement.unit}>Record</Button>
              <Button size="sm" variant="ghost" onClick={() => setMeasOpen(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button size="sm" onClick={() => navigate(`/work-orders/${job.id}`)}>
            Open job <span className="sr-only">{job.workOrderNo}</span>
          </Button>
          {executable ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setObsOpen((v) => !v)}>Observation</Button>
              <Button size="sm" variant="outline" onClick={() => setMeasOpen((v) => !v)}>Measurement</Button>
              {job.status === "scheduled" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const payload = { toStatus: "in_progress" };
                    if (online) {
                      submitOnline("transitions", payload).catch(() =>
                        onQueue({
                          entityType: "work_order",
                          entityId: job.id,
                          operation: "transition",
                          baseVersion: job.version,
                          payload,
                          label: `Start work — ${job.workOrderNo}`,
                        }),
                      );
                    } else {
                      onQueue({
                        entityType: "work_order",
                        entityId: job.id,
                        operation: "transition",
                        baseVersion: job.version,
                        payload,
                        label: `Start work — ${job.workOrderNo}`,
                      });
                    }
                  }}
                >
                  Start work
                </Button>
              ) : null}
            </>
          ) : null}
          {!online ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              captured offline if submit fails
            </Badge>
          ) : null}
          <a href={href(`/assets/${job.asset?.id}`)} className="ml-auto text-xs text-primary hover:underline">
            {job.asset ? "Asset history" : ""}
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
