"use client";

/**
 * Preventive maintenance (Workflow D): PM plans with recurrence rules,
 * planned-visit generation previews and the visit calendar. Generation is
 * idempotent per (plan, asset, dueAt) — safe to re-run.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, patch as apiPatch, ApiError } from "@/lib/api/client";
import type { MaintenancePlan, PlannedVisit, ServiceContract, Asset, ChecklistTemplate } from "@/lib/api/types";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, EmptyState, DetailList, DetailItem, SectionCard, InlineError } from "@/components/app/shared/primitives";
import { Field, TextInput, EnumSelect } from "@/components/app/shared/form-fields";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import { PLAN_STATUS_STYLE, PLANNED_VISIT_STATUS_STYLE, ASSET_FAMILY_STYLE, assetFamilyOptions } from "@/design-system/tokens";
import { useCan } from "@/lib/auth/store";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { href, navigate } from "@/lib/router";
import { RECURRENCE_FREQUENCIES, PLAN_STATUSES, PLANNED_VISIT_STATUSES, type RecurrenceFrequency, type PlanStatus, type PlannedVisitStatus, type AssetFamily } from "@serviceos/contracts";
import { CalendarClock, Plus, Play, Eye, PauseCircle, PlayCircle } from "lucide-react";

const frequencyOptions = RECURRENCE_FREQUENCIES.map((f) => ({ value: f, label: f.replace(/_/g, " ") }));

interface PlanFormState {
  contractId: string;
  planCode: string;
  name: string;
  assetFamily: AssetFamily;
  frequency: RecurrenceFrequency;
  interval: string;
  dayOfMonth: string;
  startDate: string;
  endDate: string;
  horizonDays: string;
  leadDays: string;
  checklistTemplateId: string;
  assetIds: string[];
}

function CreatePlanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PlanFormState>({
    contractId: "",
    planCode: "",
    name: "",
    assetFamily: "lt_panel",
    frequency: "quarter",
    interval: "1",
    dayOfMonth: "",
    startDate: "",
    endDate: "",
    horizonDays: "365",
    leadDays: "14",
    checklistTemplateId: "",
    assetIds: [],
  });

  const contracts = useQuery({
    queryKey: ["contracts", "active"],
    queryFn: () => apiGet<ServiceContract[]>("/api/v1/service-contracts", { status: "active", limit: 200 }),
    enabled: open,
  });
  const templates = useQuery({ queryKey: ["checklist-templates", "all"], queryFn: () => apiGet<ChecklistTemplate[]>("/api/v1/checklist-templates", { limit: 50 }), enabled: open });
  const assets = useQuery({
    queryKey: ["assets", "byfamily", form.assetFamily],
    queryFn: () => apiGet<Asset[]>("/api/v1/assets", { family: form.assetFamily, limit: 300 }),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<MaintenancePlan>("/api/v1/maintenance-plans", {
        contractId: form.contractId || undefined,
        planCode: form.planCode,
        name: form.name,
        assetFamily: form.assetFamily,
        recurrence: {
          frequency: form.frequency,
          interval: Number(form.interval) || 1,
          dayOfMonth: form.dayOfMonth ? Number(form.dayOfMonth) : undefined,
        },
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        horizonDays: form.horizonDays ? Number(form.horizonDays) : undefined,
        leadDays: form.leadDays ? Number(form.leadDays) : undefined,
        checklistTemplateId: form.checklistTemplateId || undefined,
        assets: form.assetIds.map((id) => ({ assetId: id })),
      }),
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-plans"] });
      toast({ title: "PM plan created", description: `${plan.planCode} — generate visits when ready.` });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create the plan"),
  });

  const valid = form.planCode && form.name && form.startDate && form.assetIds.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create PM plan</DialogTitle>
          <DialogDescription>Recurrence rule + asset set. The worker generates draft work orders ahead of each due date.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Plan code" htmlFor="p-code" required hint="e.g. PM-SHAKTI-Q">
              <TextInput id="p-code" value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })} placeholder="PM-SHAKTI-Q" />
            </Field>
            <Field label="Plan name" htmlFor="p-name" required>
              <TextInput id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Shakti Pune — quarterly LT panel PM" />
            </Field>
            <Field label="Asset family" htmlFor="p-family" required>
              <EnumSelect id="p-family" options={assetFamilyOptions} value={form.assetFamily} onValueChange={(v) => setForm({ ...form, assetFamily: v as AssetFamily, assetIds: [] })} />
            </Field>
            <Field label="Linked AMC / contract (optional)" htmlFor="p-contract" hint="Visits decrement included visits">
              <EnumSelect
                id="p-contract"
                options={[{ value: "", label: "No contract" }, ...(contracts.data ?? []).map((c) => ({ value: c.id, label: `${c.contractNo} — ${c.customer.legalName}` }))]}
                value={form.contractId}
                onValueChange={(v) => setForm({ ...form, contractId: v })}
              />
            </Field>
            <Field label="Frequency" htmlFor="p-freq" required>
              <EnumSelect id="p-freq" options={frequencyOptions} value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as RecurrenceFrequency })} />
            </Field>
            <Field label="Every" htmlFor="p-interval" required hint="e.g. every 2 quarters">
              <TextInput id="p-interval" inputMode="numeric" value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })} />
            </Field>
            <Field label="Start date" htmlFor="p-start" required>
              <TextInput id="p-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label="End date (optional)" htmlFor="p-end">
              <TextInput id="p-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
            <Field label="Horizon days" htmlFor="p-horizon" hint="How far ahead visits are planned">
              <TextInput id="p-horizon" inputMode="numeric" value={form.horizonDays} onChange={(e) => setForm({ ...form, horizonDays: e.target.value })} />
            </Field>
            <Field label="Lead days" htmlFor="p-lead" hint="Draft WO created this many days before due">
              <TextInput id="p-lead" inputMode="numeric" value={form.leadDays} onChange={(e) => setForm({ ...form, leadDays: e.target.value })} />
            </Field>
            <Field label="Checklist template" htmlFor="p-template" className="sm:col-span-2">
              <EnumSelect
                id="p-template"
                options={[{ value: "", label: "No checklist" }, ...(templates.data ?? []).filter((t) => t.assetFamily === form.assetFamily).map((t) => ({ value: t.id, label: `${t.name} (v${t.activeVersion})` }))]}
                value={form.checklistTemplateId}
                onValueChange={(v) => setForm({ ...form, checklistTemplateId: v })}
              />
            </Field>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-2 text-sm font-semibold">Assets in plan ({form.assetIds.length})</p>
            <ul className="mb-3 flex flex-wrap gap-2">
              {form.assetIds.map((id) => {
                const asset = assets.data?.find((a) => a.id === id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/70"
                      onClick={() => setForm((f) => ({ ...f, assetIds: f.assetIds.filter((x) => x !== id) }))}
                      aria-label={`Remove ${asset?.assetCode ?? id}`}
                    >
                      {asset?.assetCode ?? id} ✕
                    </button>
                  </li>
                );
              })}
            </ul>
            <Field label="Add asset" htmlFor="p-asset">
              <EnumSelect
                id="p-asset"
                options={(assets.data ?? [])
                  .filter((a) => !form.assetIds.includes(a.id))
                  .map((a) => ({ value: a.id, label: `${a.assetCode} — ${a.site.name} (${a.site.customer.legalName})` }))}
                value=""
                onValueChange={(v) => v && setForm((f) => ({ ...f, assetIds: [...f.assetIds, v] }))}
                placeholder="Select asset to add…"
              />
            </Field>
          </div>

          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); create.mutate(); }} disabled={create.isPending || !valid}>
              {create.isPending ? "Creating…" : "Create plan"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanActions({ plan }: { plan: MaintenancePlan }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan()("maintenance:manage");
  const [previewOpen, setPreviewOpen] = useState(false);

  const preview = useQuery({
    queryKey: ["maintenance-plans", plan.id, "preview"],
    queryFn: () => apiPost<Array<{ dueAt: string; assetId: string; assetCode: string }>>(`/api/v1/maintenance-plans/${plan.id}/preview`),
    enabled: previewOpen,
  });
  const generate = useMutation({
    mutationFn: () => apiPost<{ created?: number; draftsCreated?: number; [k: string]: unknown }>(`/api/v1/maintenance-plans/${plan.id}/generate`),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-plans"] });
      queryClient.invalidateQueries({ queryKey: ["planned-visits"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast({
        title: "Visits generated",
        description: `${result.created ?? 0} planned visit(s), ${result.draftsCreated ?? 0} draft work order(s).`,
      });
    },
    onError: (err) => toast({ title: "Generation failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });
  const setStatus = useMutation({
    mutationFn: (status: PlanStatus) => apiPatch(`/api/v1/maintenance-plans/${plan.id}`, { status, expectedVersion: plan.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-plans"] });
      toast({ title: "Plan updated" });
    },
    onError: (err) => toast({ title: "Update failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  if (!canManage) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
        <Eye className="mr-1 size-3.5" aria-hidden /> Preview visits
      </Button>
      <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending || plan.status === "archived"}>
        <Play className="mr-1 size-3.5" aria-hidden /> {generate.isPending ? "Generating…" : "Generate now"}
      </Button>
      {plan.status === "active" ? (
        <Button size="sm" variant="outline" onClick={() => setStatus.mutate("paused")}>
          <PauseCircle className="mr-1 size-3.5" aria-hidden /> Pause
        </Button>
      ) : plan.status === "paused" ? (
        <Button size="sm" variant="outline" onClick={() => setStatus.mutate("active")}>
          <PlayCircle className="mr-1 size-3.5" aria-hidden /> Resume
        </Button>
      ) : null}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upcoming visits — {plan.planCode}</DialogTitle>
            <DialogDescription>What generation will create within the horizon (idempotent per due date).</DialogDescription>
          </DialogHeader>
          {preview.isLoading ? (
            <p className="text-sm text-muted-foreground">Computing…</p>
          ) : !preview.data?.length ? (
            <EmptyState title="No visits in horizon" description="All due dates already have visits, or the plan window has ended." />
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
              {preview.data.map((v, i) => (
                <li key={`${v.assetId}-${v.dueAt}-${i}`} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="font-mono text-xs">{v.assetCode}</span>
                  <span className="font-medium">{fmtDate(v.dueAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function MaintenanceView() {
  const canManage = useCan()("maintenance:manage");
  const [status, setStatus] = useState("");
  const [visitStatus, setVisitStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const plans = useQuery({
    queryKey: ["maintenance-plans", { status }],
    queryFn: () => apiGet<MaintenancePlan[]>("/api/v1/maintenance-plans", { status: status || undefined, limit: 100 }),
  });
  const visits = useQuery({
    queryKey: ["planned-visits", { visitStatus }],
    queryFn: () => apiGet<PlannedVisit[]>("/api/v1/planned-visits", { status: visitStatus || undefined, limit: 200 }),
  });

  const planColumns: ColumnDef<MaintenancePlan, unknown>[] = [
    { accessorKey: "planCode", header: "Plan", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>()}</span> },
    { accessorKey: "name", header: "Name", cell: (i) => <span className="font-medium">{i.getValue<string>()}</span> },
    { accessorKey: "assetFamily", header: "Family", cell: (i) => <StatusBadge style={ASSET_FAMILY_STYLE[i.getValue<AssetFamily>()]} /> },
    {
      accessorKey: "recurrence",
      header: "Recurrence",
      cell: (i) => {
        const r = i.getValue<MaintenancePlan["recurrence"]>();
        return <span className="text-sm">{`every ${r.interval} ${r.frequency.replace(/_/g, " ")}${r.dayOfMonth ? `(day ${r.dayOfMonth})` : ""}`}</span>;
      },
    },
    { accessorKey: "status", header: "Status", cell: (i) => <StatusBadge style={PLAN_STATUS_STYLE[i.getValue<PlanStatus>()]} /> },
    { accessorKey: "startDate", header: "Starts", cell: (i) => <span className="text-muted-foreground">{fmtDate(i.getValue<string>())}</span> },
    {
      accessorKey: "contract",
      header: "Contract",
      cell: (i) => {
        const c = i.row.original.contract;
        return c ? <span className="text-sm">{c.contractNo}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "actions",
      header: "",
      cell: (i) => <PlanActions plan={i.row.original} />,
    },
  ];

  const visitColumns: ColumnDef<PlannedVisit, unknown>[] = [
    { accessorKey: "dueAt", header: "Due", cell: (i) => <span className="font-medium">{fmtDate(i.getValue<string>())}</span> },
    {
      accessorKey: "plan",
      header: "Plan",
      cell: (i) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{i.row.original.plan.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{i.row.original.plan.planCode}</p>
        </div>
      ),
    },
    {
      accessorKey: "asset",
      header: "Asset",
      cell: (i) => (
        <a className="text-primary hover:underline" href={href(`/assets/${i.row.original.asset.id}`)}>
          <span className="font-mono text-xs">{i.row.original.asset.assetCode}</span>
        </a>
      ),
    },
    { accessorKey: "status", header: "Status", cell: (i) => <StatusBadge style={PLANNED_VISIT_STATUS_STYLE[i.getValue<PlannedVisitStatus>()]} /> },
    {
      accessorKey: "workOrderId",
      header: "Work order",
      cell: (i) => {
        const id = i.getValue<string>();
        return id ? (
          <a className="text-primary hover:underline" href={href(`/work-orders/${id}`)}>
            <span className="font-mono text-xs">open WO</span>
          </a>
        ) : (
          <span className="text-muted-foreground">not generated</span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preventive maintenance"
        description="PM plans turn contracts into scheduled visits: the worker drafts work orders ahead of each due date."
        actions={canManage && <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Create PM plan</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <EnumSelect
          id="plan-filter-status"
          triggerClassName="w-40"
          options={[{ value: "", label: "All plans" }, ...PLAN_STATUSES.map((s) => ({ value: s, label: PLAN_STATUS_STYLE[s].label }))]}
          value={status}
          onValueChange={setStatus}
          placeholder="All plans"
        />
      </div>

      <DataTable
        columns={planColumns}
        data={plans.data ?? []}
        loading={plans.isLoading}
        rowNoun="plans"
        emptyTitle="No PM plans"
        emptyDescription="Create a plan per asset family and contract to automate preventive visits."
        emptyAction={canManage ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Create PM plan</Button> : undefined}
        ariaLabel="PM plans"
      />

      <SectionCard
        title={`Planned visits (${visits.data?.length ?? 0})`}
        description="Each visit is idempotent per (plan, asset, due date); generation creates draft work orders within lead days."
        actions={
          <EnumSelect
            id="visit-filter-status"
            triggerClassName="w-40"
            options={[{ value: "", label: "All visits" }, ...PLANNED_VISIT_STATUSES.map((s) => ({ value: s, label: PLANNED_VISIT_STATUS_STYLE[s].label }))]}
            value={visitStatus}
            onValueChange={setVisitStatus}
            placeholder="All visits"
          />
        }
      >
        <DataTable
          columns={visitColumns}
          data={visits.data ?? []}
          loading={visits.isLoading}
          onRowClick={(row) => row.workOrderId && navigate(`/work-orders/${row.workOrderId}`)}
          hideFooter
          emptyTitle="No planned visits"
          emptyDescription="Generate visits from a plan, or wait for the scheduled worker run."
          ariaLabel="Planned visits"
        />
      </SectionCard>

      {canManage ? <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </div>
  );
}
