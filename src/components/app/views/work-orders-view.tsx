"use client";

/**
 * Work orders — the operational heart (Workflow C).
 * List (technicians automatically see only their own jobs), creation, and
 * the detail surface: SLA clocks, scheduling, technician assignment, the
 * state machine (ADR-017), field execution and review.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, ApiError } from "@/lib/api/client";
import type { WorkOrder, Customer, Site, Asset, ChecklistTemplate, TeamMember } from "@/lib/api/types";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, EmptyState, DetailList, DetailItem, SectionCard, InlineError } from "@/components/app/shared/primitives";
import { Field, TextInput, TextArea, EnumSelect, TagList } from "@/components/app/shared/form-fields";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import {
  WORK_ORDER_STATUS_STYLE,
  PRIORITY_STYLE,
  WORK_ORDER_TYPE_STYLE,
  ASSIGNMENT_STATUS_STYLE,
  workOrderStatusOptions,
  workOrderTypeOptions,
  priorityOptions,
} from "@/design-system/tokens";
import { useCan, useCurrentMembership } from "@/lib/auth/store";
import { fmtDate, fmtDateTime, fmtDue, fmtDuration } from "@/lib/format";
import { href, navigate, goBack } from "@/lib/router";
import { WORK_ORDER_STATUSES, WORK_ORDER_TYPES, PRIORITIES, type WorkOrderStatus, type WorkOrderType, type Priority } from "@serviceos/contracts";
import {
  ChecklistPanel,
  MeasurementsPanel,
  ObservationsPanel,
  PartsPanel,
  CompletionPanel,
  AcknowledgementPanel,
  ReportsPanel,
  EventsPanel,
  RequiredSkillsRow,
} from "./work-order-execution";
import { Wrench, Plus, Search, CalendarClock, UserPlus, AlertTriangle, ChevronRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Create                                                               */
/* ------------------------------------------------------------------ */

const woSchema = z.object({
  customerId: z.string().uuid("Select a customer"),
  siteId: z.string().uuid("Select a site"),
  assetId: z.string().optional(),
  title: z.string().min(5, "Title is required (min 5 characters)").max(160),
  description: z.string().max(4000).optional(),
  type: z.enum(WORK_ORDER_TYPES),
  priority: z.enum(PRIORITIES),
  scheduledStartAt: z.string().optional(),
  scheduledEndAt: z.string().optional(),
  requiredSkills: z.string().optional(),
  checklistTemplateId: z.string().optional(),
});
type WoForm = z.infer<typeof woSchema>;

function CreateWorkOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<WoForm>({
    resolver: zodResolver(woSchema),
    defaultValues: { type: "breakdown", priority: "normal" },
  });
  const customerId = form.watch("customerId");
  const siteId = form.watch("siteId");

  const customers = useQuery({ queryKey: ["customers", "options"], queryFn: () => apiGet<Customer[]>("/api/v1/customers", { limit: 200 }), enabled: open });
  const sites = useQuery({ queryKey: ["sites", "options", customerId], queryFn: () => apiGet<Site[]>("/api/v1/sites", { customerId, limit: 200 }), enabled: open && Boolean(customerId) });
  const assets = useQuery({ queryKey: ["assets", "options", siteId], queryFn: () => apiGet<Asset[]>("/api/v1/assets", { siteId, limit: 200 }), enabled: open && Boolean(siteId) });
  const templates = useQuery({ queryKey: ["checklist-templates", "all"], queryFn: () => apiGet<ChecklistTemplate[]>("/api/v1/checklist-templates", { limit: 50 }), enabled: open });

  const create = useMutation({
    mutationFn: (values: WoForm) =>
      apiPost<WorkOrder>("/api/v1/work-orders", {
        customerId: values.customerId,
        siteId: values.siteId,
        assetId: values.assetId || undefined,
        title: values.title,
        description: values.description || undefined,
        type: values.type,
        priority: values.priority,
        scheduledStartAt: values.scheduledStartAt || undefined,
        scheduledEndAt: values.scheduledEndAt || undefined,
        requiredSkills: values.requiredSkills
          ? values.requiredSkills.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        checklistTemplateId: values.checklistTemplateId || undefined,
      }),
    onSuccess: (wo) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast({ title: "Work order created", description: `${wo.workOrderNo} (draft)` });
      form.reset({ type: "breakdown", priority: "normal" });
      onOpenChange(false);
      navigate(`/work-orders/${wo.id}`);
    },
    onError: (err) => setServerError(err instanceof ApiError ? err.message : "Could not create the work order"),
  });

  const reset = () => { form.reset({ type: "breakdown", priority: "normal" }); setServerError(null); };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create work order</DialogTitle>
          <DialogDescription>Starts in draft. Add a checklist, schedule, then mark ready for dispatch.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => { setServerError(null); create.mutate(v); })} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="w-customer" required error={form.formState.errors.customerId?.message}>
              <EnumSelect
                id="w-customer"
                options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.legalName }))}
                value={customerId}
                onValueChange={(v) => { form.setValue("customerId", v); form.setValue("siteId", ""); form.setValue("assetId", ""); }}
                placeholder={customers.isLoading ? "Loading…" : "Select customer…"}
                error={form.formState.errors.customerId?.message}
              />
            </Field>
            <Field label="Site" htmlFor="w-site" required error={form.formState.errors.siteId?.message}>
              <EnumSelect
                id="w-site"
                options={(sites.data ?? []).map((s) => ({ value: s.id, label: `${s.siteCode} — ${s.name}` }))}
                value={siteId}
                onValueChange={(v) => { form.setValue("siteId", v); form.setValue("assetId", ""); }}
                disabled={!customerId}
                placeholder={customerId ? "Select site…" : "Pick a customer first"}
                error={form.formState.errors.siteId?.message}
              />
            </Field>
            <Field label="Asset (optional)" htmlFor="w-asset">
              <EnumSelect
                id="w-asset"
                options={[{ value: "", label: "Not specified" }, ...(assets.data ?? []).map((a) => ({ value: a.id, label: `${a.assetCode}${a.serialNumber ? ` · ${a.serialNumber}` : ""}` }))]}
                value={form.watch("assetId") ?? ""}
                onValueChange={(v) => form.setValue("assetId", v || undefined)}
                disabled={!siteId}
                placeholder={siteId ? "Select asset…" : "Pick a site first"}
              />
            </Field>
            <Field label="Checklist template (optional)" htmlFor="w-template">
              <EnumSelect
                id="w-template"
                options={[{ value: "", label: "No checklist" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))]}
                value={form.watch("checklistTemplateId") ?? ""}
                onValueChange={(v) => form.setValue("checklistTemplateId", v || undefined)}
              />
            </Field>
          </div>
          <Field label="Title" htmlFor="w-title" required error={form.formState.errors.title?.message}>
            <TextInput id="w-title" placeholder="HT VCB mechanism inspection — clicking sound" {...form.register("title")} error={form.formState.errors.title?.message} />
          </Field>
          <Field label="Scope / description" htmlFor="w-desc" error={form.formState.errors.description?.message}>
            <TextArea id="w-desc" rows={3} placeholder="Inspect VCB spring-charged mechanism, pole contact resistance…" {...form.register("description")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="w-type" required>
              <EnumSelect id="w-type" options={workOrderTypeOptions} value={form.watch("type")} onValueChange={(v) => form.setValue("type", v as WorkOrderType)} />
            </Field>
            <Field label="Priority" htmlFor="w-priority" required>
              <EnumSelect id="w-priority" options={priorityOptions} value={form.watch("priority")} onValueChange={(v) => form.setValue("priority", v as Priority)} />
            </Field>
            <Field label="Scheduled start" htmlFor="w-start" hint="Required before moving to scheduled">
              <TextInput id="w-start" type="datetime-local" {...form.register("scheduledStartAt")} />
            </Field>
            <Field label="Scheduled end" htmlFor="w-end">
              <TextInput id="w-end" type="datetime-local" {...form.register("scheduledEndAt")} />
            </Field>
          </div>
          <Field label="Required skills (comma-separated)" htmlFor="w-skills" hint="Matched against technician skills on member records">
            <TextInput id="w-skills" placeholder="HT switchgear, VCB" {...form.register("requiredSkills")} />
          </Field>
          <InlineError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !siteId}>{create.isPending ? "Creating…" : "Create work order"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Assign technician                                                    */
/* ------------------------------------------------------------------ */

function AssignDialog({ workOrder, open, onOpenChange }: { workOrder: WorkOrder; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [assignmentRole, setAssignmentRole] = useState("technician");
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["team", "members"],
    queryFn: () => apiGet<TeamMember[]>("/api/v1/team/members"),
    enabled: open,
  });

  const assign = useMutation({
    mutationFn: () => apiPost(`/api/v1/work-orders/${workOrder.id}/assignments`, { userId, assignmentRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      toast({ title: "Technician assigned", description: "They will see this job in My jobs after it is scheduled." });
      setUserId("");
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Assignment failed"),
  });

  const technicians = (members.data ?? []).filter((m) => m.role === "technician" || m.role === "service_manager" || m.role === "coordinator");

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {workOrder.workOrderNo}</DialogTitle>
          <DialogDescription>Required skills: {workOrder.requiredSkills.length ? workOrder.requiredSkills.join(", ") : "none recorded"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Team member" htmlFor="as-user" required>
            <EnumSelect
              id="as-user"
              options={technicians.map((m) => ({
                value: m.userId,
                label: `${m.user.displayName}${m.skills.length ? ` · skills: ${m.skills.join("/")}` : ""}`,
              }))}
              value={userId}
              onValueChange={setUserId}
              placeholder="Select member…"
            />
          </Field>
          <Field label="Assignment role" htmlFor="as-role">
            <EnumSelect
              id="as-role"
              options={[
                { value: "technician", label: "Technician" },
                { value: "lead", label: "Lead" },
                { value: "observer", label: "Observer" },
              ]}
              value={assignmentRole}
              onValueChange={setAssignmentRole}
            />
          </Field>
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); assign.mutate(); }} disabled={assign.isPending || !userId}>
              <UserPlus className="mr-1.5 size-4" aria-hidden /> {assign.isPending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Transition dialog (reason-required paths)                            */
/* ------------------------------------------------------------------ */

const TRANSITION_LABELS: Partial<Record<WorkOrderStatus, string>> = {
  ready: "Mark ready for dispatch",
  scheduled: "Schedule visit",
  in_progress: "Start work on site",
  on_hold: "Put on hold",
  pending_review: "Submit for review",
  completed: "Approve & complete",
  closed: "Close work order",
  cancelled: "Cancel work order",
};

function TransitionDialog({
  workOrder,
  target,
  open,
  onOpenChange,
}: {
  workOrder: WorkOrder;
  target: WorkOrderStatus | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [scheduledStartAt, setScheduledStartAt] = useState(workOrder.scheduledStartAt?.slice(0, 16) ?? "");
  const [scheduledEndAt, setScheduledEndAt] = useState(workOrder.scheduledEndAt?.slice(0, 16) ?? "");
  const [error, setError] = useState<string | null>(null);

  const needsReason = target === "cancelled" || target === "on_hold";
  const needsSchedule = target === "scheduled";

  const transition = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/work-orders/${workOrder.id}/transitions`, {
        toStatus: target,
        reason: needsReason ? reason : undefined,
        expectedVersion: workOrder.version,
        ...(needsSchedule ? { scheduledStartAt: new Date(scheduledStartAt).toISOString(), scheduledEndAt: scheduledEndAt ? new Date(scheduledEndAt).toISOString() : undefined } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast({ title: `Status → ${target!.replace(/_/g, " ")}` });
      setReason("");
      onOpenChange(false);
    },
    onError: (err) => {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? "Transition failed");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setReason(""); setError(null); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{TRANSITION_LABELS[target ?? "ready"] ?? `Move to ${target}`}</DialogTitle>
          <DialogDescription>
            {needsSchedule
              ? "Set the visit window (site timezone applies at the customer)."
              : needsReason
                ? "A reason is mandatory and stored with the audit trail."
                : "Confirm the status change."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {needsSchedule ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Visit start" htmlFor="tr-start" required>
                <TextInput id="tr-start" type="datetime-local" value={scheduledStartAt} onChange={(e) => setScheduledStartAt(e.target.value)} />
              </Field>
              <Field label="Visit end" htmlFor="tr-end">
                <TextInput id="tr-end" type="datetime-local" value={scheduledEndAt} onChange={(e) => setScheduledEndAt(e.target.value)} />
              </Field>
            </div>
          ) : null}
          {needsReason ? (
            <Field label="Reason" htmlFor="tr-reason" required>
              <TextArea id="tr-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={target === "cancelled" ? "Duplicate of WO-… / customer withdrew…" : "Waiting on customer shutdown window…"} />
            </Field>
          ) : null}
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant={target === "cancelled" ? "destructive" : "default"}
              onClick={() => { setError(null); transition.mutate(); }}
              disabled={transition.isPending || (needsReason && !reason.trim()) || (needsSchedule && !scheduledStartAt)}
            >
              {transition.isPending ? "Applying…" : "Confirm"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                               */
/* ------------------------------------------------------------------ */

function WorkOrderDetail({ workOrderId }: { workOrderId: string }) {
  const can = useCan();
  const membership = useCurrentMembership();
  const canAssign = can("work_orders:assign");
  const canTransition = can("work_orders:transition");
  const canExecute = can("work_orders:execute");
  const canReview = can("work_orders:review");
  const canPublish = can("reports:publish");
  const isTechnician = membership?.role === "technician";

  const [assignOpen, setAssignOpen] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<WorkOrderStatus | null>(null);

  const detail = useQuery({
    queryKey: ["work-orders", workOrderId],
    queryFn: () => apiGet<WorkOrder>(`/api/v1/work-orders/${workOrderId}`),
    refetchInterval: 60_000,
  });

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Loading work order…</p>;
  if (detail.isError || !detail.data)
    return <EmptyState title="Work order not found" description="It may not exist, or it is not assigned to you." action={<Button variant="outline" onClick={() => navigate("/work-orders")}>Back</Button>} />;

  const wo = detail.data;
  const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
    draft: ["ready", "cancelled"],
    ready: ["scheduled", "cancelled"],
    scheduled: ["in_progress", "on_hold", "cancelled"],
    in_progress: ["pending_review", "on_hold", "cancelled"],
    on_hold: ["scheduled", "cancelled"],
    pending_review: ["completed", "in_progress", "cancelled"],
    completed: ["closed", "pending_review"],
    closed: [],
    cancelled: [],
  };
  const allowedNext: WorkOrderStatus[] = TRANSITIONS[wo.status] ?? [];

  const responseDue = fmtDue(wo.responseDueAt);
  const resolutionDue = fmtDue(wo.resolutionDueAt);
  const activeAssignments = (wo.assignments ?? []).filter((a) => a.status !== "rejected");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <span className="flex items-center gap-1">
            <a className="hover:underline" href={href(isTechnician ? "/my-jobs" : "/work-orders")}>
              {isTechnician ? "My jobs" : "Work orders"}
            </a>
            <ChevronRight className="size-3" aria-hidden />
            {wo.workOrderNo}
          </span>
        }
        title={wo.title}
        description={`${wo.workOrderNo} · ${wo.customer.legalName} · ${wo.site.name}${wo.asset ? ` · ${wo.asset.assetCode}` : ""}`}
        actions={
          <>
            {canAssign && !["closed", "cancelled"].includes(wo.status) ? (
              <Button variant="outline" onClick={() => setAssignOpen(true)}>
                <UserPlus className="mr-1.5 size-4" aria-hidden /> Assign
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => goBack(isTechnician ? "/my-jobs" : "/work-orders")}>Back</Button>
          </>
        }
      />

      {/* Status + SLA strip */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Status" className="lg:col-span-1">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge style={WORK_ORDER_STATUS_STYLE[wo.status]} />
              <StatusBadge style={PRIORITY_STYLE[wo.priority]} />
              <StatusBadge style={WORK_ORDER_TYPE_STYLE[wo.type]} />
            </div>
            <RequiredSkillsRow workOrder={wo} />
            {wo.plannedVisit ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarClock className="size-4" aria-hidden /> PM visit due {fmtDate(wo.plannedVisit.dueAt)}
              </p>
            ) : null}
            {canTransition && allowedNext.length ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {allowedNext.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={t === "cancelled" ? "outline" : t === wo.status ? "outline" : "default"}
                    className={t === "cancelled" ? "text-[color:var(--status-danger)]" : undefined}
                    onClick={() => setTransitionTarget(t)}
                  >
                    {TRANSITION_LABELS[t] ?? t}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="SLA clocks"
          description={wo.slaPolicy ? `${wo.slaPolicy.basis === "contract" ? `Contract ${wo.slaPolicy.contractNo}` : "Tenant defaults"} · response ${fmtDuration(wo.slaPolicy.responseMinutes)} / resolution ${fmtDuration(wo.slaPolicy.resolutionMinutes)}` : "No SLA policy recorded"}
          className="lg:col-span-2"
        >
          <DetailList className="sm:grid-cols-2">
            <DetailItem label="Response due">
              <span className={responseDue.overdue ? "font-semibold text-[color:var(--status-danger)]" : ""}>
                {wo.responseDueAt ? `${fmtDateTime(wo.responseDueAt)} (${responseDue.text})` : "—"}
              </span>
            </DetailItem>
            <DetailItem label="Resolution due">
              <span className={resolutionDue.overdue ? "font-semibold text-[color:var(--status-danger)]" : ""}>
                {wo.resolutionDueAt ? `${fmtDateTime(wo.resolutionDueAt)} (${resolutionDue.text})` : "—"}
              </span>
            </DetailItem>
            <DetailItem label="Scheduled window">
              {wo.scheduledStartAt ? `${fmtDateTime(wo.scheduledStartAt)} → ${fmtDateTime(wo.scheduledEndAt)}` : "Not scheduled"}
            </DetailItem>
            <DetailItem label="Completed / closed">
              {wo.completedAt ? fmtDateTime(wo.completedAt) : "—"}
              {wo.closedAt ? ` / ${fmtDateTime(wo.closedAt)}` : ""}
            </DetailItem>
          </DetailList>
          {resolutionDue.overdue && !["completed", "closed", "cancelled"].includes(wo.status) ? (
            <p role="alert" className="mt-3 flex items-center gap-2 rounded-md bg-[color:var(--status-danger-bg)] p-3 text-sm font-medium text-[color:var(--status-danger)]">
              <AlertTriangle className="size-4" aria-hidden /> Past resolution due — escalate or record why.
            </p>
          ) : null}
        </SectionCard>
      </div>

      {/* Context cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Customer & site">
          <DetailList className="grid-cols-1">
            <DetailItem label="Customer">
              <a className="text-primary hover:underline" href={href(`/customers/${wo.customer.id}`)}>{wo.customer.legalName}</a>
            </DetailItem>
            <DetailItem label="Site">
              <a className="text-primary hover:underline" href={href(`/assets?siteId=${wo.site.id}`)}>{wo.site.name} ({wo.site.siteCode})</a>
            </DetailItem>
            <DetailItem label="Address">{wo.site.address ? `${wo.site.address.line1 ?? ""} ${wo.site.address.city ?? ""}`.trim() || "—" : "—"}</DetailItem>
            <DetailItem label="Site timezone">{wo.site.timezone}</DetailItem>
          </DetailList>
          {wo.site.accessInstructions ? (
            <div className="mt-3 rounded-md border border-[color:var(--status-warning)]/40 bg-[color:var(--status-warning-bg)] p-3 text-sm">
              <p className="font-medium">Site access</p>
              <p className="mt-0.5 text-muted-foreground">{wo.site.accessInstructions}</p>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Asset">
          {wo.asset ? (
            <DetailList className="grid-cols-1">
              <DetailItem label="Asset">
                <a className="text-primary hover:underline" href={href(`/assets/${wo.asset!.id}`)}>
                  {wo.asset.assetCode}{wo.asset.serialNumber ? ` · ${wo.asset.serialNumber}` : ""}
                </a>
              </DetailItem>
              <DetailItem label="Family / model">{[wo.asset.assetFamily.replace(/_/g, " "), wo.asset.model].filter(Boolean).join(" · ")}</DetailItem>
              {wo.asset.specification?.electrical ? (
                <DetailItem label="Nameplate">
                  {[
                    wo.asset.specification.electrical.ratedVoltageV ? `${wo.asset.specification.electrical.ratedVoltageV} V` : null,
                    wo.asset.specification.electrical.voltageClassKv ? `${wo.asset.specification.electrical.voltageClassKv} kV` : null,
                    wo.asset.specification.electrical.ratedCurrentA ? `${wo.asset.specification.electrical.ratedCurrentA} A` : null,
                  ].filter(Boolean).join(" · ") || "—"}
                </DetailItem>
              ) : null}
              <DetailItem label="Commissioned">{fmtDate(wo.asset.commissioningDate)}</DetailItem>
            </DetailList>
          ) : (
            <EmptyState title="No asset linked" description="Work order is site-level." />
          )}
          {wo.request ? (
            <p className="mt-3 text-sm">
              <span className="text-muted-foreground">From request </span>
              <a className="font-medium text-primary hover:underline" href={href(`/requests/${wo.request!.id}`)}>{wo.request.requestNo} — {wo.request.subject}</a>
            </p>
          ) : null}
        </SectionCard>

        <SectionCard
          title={`Assigned team (${activeAssignments.length})`}
          actions={canAssign && !["closed", "cancelled"].includes(wo.status) ? <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>Add</Button> : undefined}
        >
          {!activeAssignments.length ? (
            <EmptyState title="Nobody assigned" description="Assign a technician before scheduling the visit." />
          ) : (
            <ul className="space-y-2">
              {activeAssignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.user.displayName}</p>
                    <p className="text-xs text-muted-foreground">{a.assignmentRole} · offered {fmtDate(a.offeredAt)}</p>
                  </div>
                  <StatusBadge style={ASSIGNMENT_STATUS_STYLE[a.status]} />
                </li>
              ))}
            </ul>
          )}
          {wo.description ? <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-sm leading-relaxed">{wo.description}</p> : null}
        </SectionCard>
      </div>

      {/* Execution surfaces */}
      <ChecklistPanel workOrder={wo} canExecute={canExecute && ["scheduled", "in_progress", "on_hold"].includes(wo.status)} />
      <MeasurementsPanel workOrder={wo} canExecute={canExecute && ["scheduled", "in_progress", "on_hold"].includes(wo.status)} />
      <ObservationsPanel workOrder={wo} canExecute={canExecute && ["scheduled", "in_progress", "on_hold"].includes(wo.status)} />
      <PartsPanel workOrder={wo} canExecute={canExecute && ["scheduled", "in_progress", "on_hold"].includes(wo.status)} />
      <CompletionPanel workOrder={wo} canExecute={canExecute} canReview={canReview} />
      <AcknowledgementPanel workOrder={wo} canExecute={canExecute} />
      <ReportsPanel workOrder={wo} canExecute={canExecute} canReview={canReview} canPublish={canPublish} />
      <EventsPanel workOrder={wo} />

      <AssignDialog workOrder={wo} open={assignOpen} onOpenChange={setAssignOpen} />
      {transitionTarget ? (
        <TransitionDialog workOrder={wo} target={transitionTarget} open={transitionTarget !== null} onOpenChange={(v) => !v && setTransitionTarget(null)} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                 */
/* ------------------------------------------------------------------ */

export function WorkOrdersView({ workOrderId }: { workOrderId?: string }) {
  const canWrite = useCan()("work_orders:write");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const workOrders = useQuery({
    queryKey: ["work-orders", { search, status, overdue }],
    queryFn: () =>
      apiGet<WorkOrder[]>("/api/v1/work-orders", {
        search: search || undefined,
        status: status || undefined,
        overdue: overdue || undefined,
        limit: 200,
      }),
  });

  if (workOrderId) return <WorkOrderDetail workOrderId={workOrderId} />;

  const columns: ColumnDef<WorkOrder, unknown>[] = [
    { accessorKey: "workOrderNo", header: "WO", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>()}</span> },
    {
      accessorKey: "title",
      header: "Work order",
      cell: (i) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{i.getValue<string>()}</p>
          <p className="truncate text-xs text-muted-foreground">{i.row.original.customer.legalName} · {i.row.original.site.name}</p>
        </div>
      ),
    },
    { accessorKey: "type", header: "Type", cell: (i) => <StatusBadge style={WORK_ORDER_TYPE_STYLE[i.getValue<WorkOrderType>()]} /> },
    { accessorKey: "priority", header: "Priority", cell: (i) => <StatusBadge style={PRIORITY_STYLE[i.getValue<Priority>()]} /> },
    { accessorKey: "status", header: "Status", cell: (i) => <StatusBadge style={WORK_ORDER_STATUS_STYLE[i.getValue<WorkOrderStatus>()]} /> },
    {
      accessorKey: "resolutionDueAt",
      header: "Resolution due",
      cell: (i) => {
        const due = fmtDue(i.getValue<string>());
        if (!i.getValue<string>()) return <span className="text-muted-foreground">—</span>;
        return <span className={due.overdue ? "font-semibold text-[color:var(--status-danger)]" : "text-muted-foreground"}>{due.text}</span>;
      },
    },
    {
      accessorKey: "assignments",
      header: "Assigned",
      cell: (i) => {
        const active = (i.row.original.assignments ?? []).filter((a) => a.status !== "rejected");
        if (!active.length) return <span className="text-muted-foreground">Unassigned</span>;
        return <span>{active.map((a) => a.user.displayName.split(" ")[0]).join(", ")}</span>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work orders"
        description="Scheduled and in-flight field work. Technicians see only their own jobs here; managers see the board."
        actions={canWrite && <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Create work order</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search work orders" placeholder="Search title or WO number…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <EnumSelect id="wo-filter-status" triggerClassName="w-40" options={[{ value: "", label: "All statuses" }, ...workOrderStatusOptions]} value={status} onValueChange={setStatus} placeholder="All statuses" />
        <EnumSelect
          id="wo-filter-overdue"
          triggerClassName="w-40"
          options={[
            { value: "", label: "All work orders" },
            { value: "true", label: "Overdue only" },
          ]}
          value={overdue}
          onValueChange={setOverdue}
        />
      </div>

      <DataTable
        columns={columns}
        data={workOrders.data ?? []}
        loading={workOrders.isLoading}
        onRowClick={(row) => navigate(`/work-orders/${row.id}`)}
        rowNoun="work orders"
        emptyTitle="No work orders match"
        emptyDescription="Convert a service request or create a work order directly."
        emptyAction={canWrite ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Create work order</Button> : undefined}
        ariaLabel="Work orders"
      />

      {canWrite ? <CreateWorkOrderDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </div>
  );
}
