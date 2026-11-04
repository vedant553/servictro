"use client";

/**
 * Service requests — the intake desk (Workflow B).
 * New → triage → accept → convert to work order, plus info-needed / reject /
 * close paths. Coverage is resolved from contracts (ADR-007) and shown
 * up-front so triage knows whether the visit is billable.
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, patch as apiPatch, ApiError } from "@/lib/api/client";
import type { ServiceRequest, Customer, Site, Asset, ChecklistTemplate } from "@/lib/api/types";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, EmptyState, DetailList, DetailItem, SectionCard, InlineError } from "@/components/app/shared/primitives";
import { Field, TextInput, TextArea, EnumSelect } from "@/components/app/shared/form-fields";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import {
  REQUEST_STATUS_STYLE,
  SEVERITY_STYLE,
  REQUEST_SOURCE_LABEL,
  REQUEST_CATEGORY_LABEL,
  severityOptions,
  requestStatusOptions,
  requestSourceOptions,
  requestCategoryOptions,
  workOrderTypeOptions,
  priorityOptions,
} from "@/design-system/tokens";
import { useCan } from "@/lib/auth/store";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { href, navigate, goBack } from "@/lib/router";
import { SEVERITIES, REQUEST_CATEGORIES, REQUEST_SOURCES, WORK_ORDER_TYPES, PRIORITIES, type Severity, type RequestCategory, type RequestSource, type WorkOrderType, type Priority } from "@serviceos/contracts";
import { ClipboardList, Plus, Search, ArrowRightLeft, CheckCircle2, MessageCircleQuestion, Ban, XCircle, Wrench } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Create request                                                       */
/* ------------------------------------------------------------------ */

const requestSchema = z.object({
  customerId: z.string().uuid("Select a customer"),
  siteId: z.string().uuid("Select a site"),
  assetId: z.string().optional(),
  source: z.enum(REQUEST_SOURCES),
  category: z.enum(REQUEST_CATEGORIES),
  subject: z.string().min(5, "Subject is required (min 5 characters)").max(160),
  description: z.string().min(10, "Describe the symptom in at least 10 characters").max(4000),
  severity: z.enum(SEVERITIES),
  preferredVisitAt: z.string().optional(),
});
type RequestForm = z.infer<typeof requestSchema>;

function CreateRequestDialog({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preset?: { customerId?: string; assetId?: string };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<RequestForm>({
    resolver: zodResolver(requestSchema),
    defaultValues: { source: "phone", category: "breakdown", severity: "medium", customerId: preset?.customerId },
  });
  const customerId = form.watch("customerId");
  const siteId = form.watch("siteId");

  const customers = useQuery({
    queryKey: ["customers", "options"],
    queryFn: () => apiGet<Customer[]>("/api/v1/customers", { limit: 200 }),
    enabled: open,
  });
  const sites = useQuery({
    queryKey: ["sites", "options", customerId],
    queryFn: () => apiGet<Site[]>("/api/v1/sites", { customerId, limit: 200 }),
    enabled: open && Boolean(customerId),
  });
  const assets = useQuery({
    queryKey: ["assets", "options", siteId],
    queryFn: () => apiGet<Asset[]>("/api/v1/assets", { siteId, limit: 200 }),
    enabled: open && Boolean(siteId),
  });

  const create = useMutation({
    mutationFn: (values: RequestForm) =>
      apiPost<ServiceRequest>("/api/v1/service-requests", {
        customerId: values.customerId,
        siteId: values.siteId,
        assetId: values.assetId || undefined,
        source: values.source,
        category: values.category,
        subject: values.subject,
        description: values.description,
        severity: values.severity,
        preferredVisitAt: values.preferredVisitAt || undefined,
      }),
    onSuccess: (sr) => {
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast({ title: "Request logged", description: `${sr.requestNo} — ${sr.subject}` });
      form.reset({ source: "phone", category: "breakdown", severity: "medium", customerId: preset?.customerId });
      onOpenChange(false);
      navigate(`/requests/${sr.id}`);
    },
    onError: (err) => setServerError(err instanceof ApiError ? err.message : "Could not log the request"),
  });

  const reset = () => { form.reset({ source: "phone", category: "breakdown", severity: "medium", customerId: preset?.customerId }); setServerError(null); };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Log service request</DialogTitle>
          <DialogDescription>Capture what the customer reported. Coverage is resolved automatically from warranty/AMC contracts.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => { setServerError(null); create.mutate(v); })} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="r-customer" required error={form.formState.errors.customerId?.message}>
              <EnumSelect
                id="r-customer"
                options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.legalName }))}
                value={customerId}
                onValueChange={(v) => { form.setValue("customerId", v); form.setValue("siteId", ""); form.setValue("assetId", ""); }}
                placeholder={customers.isLoading ? "Loading…" : "Select customer…"}
                error={form.formState.errors.customerId?.message}
              />
            </Field>
            <Field label="Site" htmlFor="r-site" required error={form.formState.errors.siteId?.message}>
              <EnumSelect
                id="r-site"
                options={(sites.data ?? []).map((s) => ({ value: s.id, label: `${s.siteCode} — ${s.name}` }))}
                value={siteId}
                onValueChange={(v) => { form.setValue("siteId", v); form.setValue("assetId", ""); }}
                disabled={!customerId}
                placeholder={customerId ? (sites.isLoading ? "Loading…" : "Select site…") : "Pick a customer first"}
                error={form.formState.errors.siteId?.message}
              />
            </Field>
            <Field label="Asset (optional)" htmlFor="r-asset" hint="Select when the customer identifies the equipment">
              <EnumSelect
                id="r-asset"
                options={[{ value: "", label: "Not specified" }, ...(assets.data ?? []).map((a) => ({ value: a.id, label: `${a.assetCode}${a.serialNumber ? ` · ${a.serialNumber}` : ""} (${a.model ?? "n/a"})` }))]}
                value={form.watch("assetId") ?? ""}
                onValueChange={(v) => form.setValue("assetId", v || undefined)}
                disabled={!siteId}
                placeholder={siteId ? "Select asset…" : "Pick a site first"}
              />
            </Field>
            <Field label="Source" htmlFor="r-source" required>
              <EnumSelect id="r-source" options={requestSourceOptions} value={form.watch("source")} onValueChange={(v) => form.setValue("source", v as RequestSource)} />
            </Field>
            <Field label="Category" htmlFor="r-category" required>
              <EnumSelect id="r-category" options={requestCategoryOptions} value={form.watch("category")} onValueChange={(v) => form.setValue("category", v as RequestCategory)} />
            </Field>
            <Field label="Severity" htmlFor="r-severity" required hint="Drives the SLA clock at triage">
              <EnumSelect id="r-severity" options={severityOptions} value={form.watch("severity")} onValueChange={(v) => form.setValue("severity", v as Severity)} />
            </Field>
          </div>
          <Field label="Subject" htmlFor="r-subject" required error={form.formState.errors.subject?.message}>
            <TextInput id="r-subject" placeholder="LT panel feeder 3 tripping repeatedly" {...form.register("subject")} error={form.formState.errors.subject?.message} />
          </Field>
          <Field label="Description" htmlFor="r-desc" required error={form.formState.errors.description?.message} hint="Symptoms, frequency, load conditions — what the customer observed">
            <TextArea id="r-desc" rows={4} placeholder="Customer reports the feeder 3 breaker trips almost daily since last week…" {...form.register("description")} error={form.formState.errors.description?.message} />
          </Field>
          <Field label="Preferred visit date (optional)" htmlFor="r-visit">
            <TextInput id="r-visit" type="date" {...form.register("preferredVisitAt")} />
          </Field>
          <InlineError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !siteId}>{create.isPending ? "Logging…" : "Log request"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Convert to work order                                                */
/* ------------------------------------------------------------------ */

function ConvertDialog({ request, open, onOpenChange }: { request: ServiceRequest; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [type, setType] = useState<WorkOrderType>("breakdown");
  const [priority, setPriority] = useState<Priority>("normal");
  const [scopeNote, setScopeNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [coverageReason, setCoverageReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: ["checklist-templates", "options", request.asset?.assetFamily],
    queryFn: () => apiGet<ChecklistTemplate[]>("/api/v1/checklist-templates", { family: request.asset?.assetFamily }),
    enabled: open && Boolean(request.asset?.assetFamily),
  });

  const convert = useMutation({
    mutationFn: () =>
      apiPost<{ workOrder: { id: string; workOrderNo: string } }>(`/api/v1/service-requests/${request.id}/convert`, {
        type,
        priority,
        scopeNote: scopeNote || undefined,
        checklistTemplateId: templateId || undefined,
        coverageOverrideReason: coverageReason || undefined,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      const wo = result.workOrder ?? result;
      toast({ title: "Work order created", description: `${wo.workOrderNo} from ${request.requestNo}` });
      onOpenChange(false);
      navigate(`/work-orders/${wo.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Conversion failed"),
  });

  const covered = request.coverage?.covered ?? false;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Convert {request.requestNo} to work order</DialogTitle>
          <DialogDescription>
            {covered
              ? "This request is covered by an active contract — SLA clocks will follow the contract."
              : "No active coverage found — record a reason if service proceeds outside contract terms."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work order type" htmlFor="cv-type" required>
              <EnumSelect id="cv-type" options={workOrderTypeOptions} value={type} onValueChange={(v) => setType(v as WorkOrderType)} />
            </Field>
            <Field label="Priority" htmlFor="cv-priority" required>
              <EnumSelect id="cv-priority" options={priorityOptions} value={priority} onValueChange={(v) => setPriority(v as Priority)} />
            </Field>
          </div>
          <Field label="Scope note" htmlFor="cv-scope" hint="What the field team should do; converted to the work order description">
            <Textarea id="cv-scope" rows={3} value={scopeNote} onChange={(e) => setScopeNote(e.target.value)} placeholder="Inspect feeder 3 breaker, measure contact resistance, check relay settings…" />
          </Field>
          {request.asset?.assetFamily ? (
            <Field label="Checklist template" htmlFor="cv-template" hint={`Active templates for ${request.asset.assetFamily.replace(/_/g, " ")}`}>
              <EnumSelect
                id="cv-template"
                options={[{ value: "", label: "No checklist" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (v${t.activeVersion})` }))]}
                value={templateId}
                onValueChange={setTemplateId}
              />
            </Field>
          ) : null}
          {!covered ? (
            <Field label="Coverage override reason" htmlFor="cv-cov" hint="Required by the API when converting uncovered service — becomes part of the audit trail">
              <TextInput id="cv-cov" value={coverageReason} onChange={(e) => setCoverageReason(e.target.value)} placeholder="Goodwill visit pending AMC signing" />
            </Field>
          ) : null}
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); convert.mutate(); }} disabled={convert.isPending || (!covered && !coverageReason.trim())}>
              <ArrowRightLeft className="mr-1.5 size-4" aria-hidden /> {convert.isPending ? "Converting…" : "Create work order"}
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

function RequestDetail({ requestId }: { requestId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canTriage = useCan()("requests:triage");
  const canConvert = useCan()("requests:convert");
  const canWrite = useCan()("requests:write");

  const [convertOpen, setConvertOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [acceptNote, setAcceptNote] = useState("");
  const [acceptOpen, setAcceptOpen] = useState(false);

  const detail = useQuery({
    queryKey: ["requests", requestId],
    queryFn: () => apiGet<ServiceRequest>(`/api/v1/service-requests/${requestId}`),
  });

  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => apiPost(`/api/v1/service-requests/${requestId}/${action}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast({ title: "Request updated" });
    },
    onError: (err) => toast({ title: "Action failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Loading request…</p>;
  if (detail.isError || !detail.data)
    return <EmptyState title="Request not found" action={<Button variant="outline" onClick={() => navigate("/requests")}>Back to requests</Button>} />;

  const r = detail.data;
  const open = !["converted", "rejected", "closed"].includes(r.status);
  const coverage = r.coverage;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<a className="hover:underline" href={href("/requests")}>Service requests</a>}
        title={`${r.requestNo} — ${r.subject}`}
        description={`Logged ${fmtDateTime(r.createdAt)} via ${REQUEST_SOURCE_LABEL[r.source]} · ${r.customer.legalName}`}
        actions={
          <>
            {open && canConvert ? (
              <Button onClick={() => setConvertOpen(true)}>
                <ArrowRightLeft className="mr-1.5 size-4" aria-hidden /> Convert to work order
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => goBack("/requests")}>Back</Button>
          </>
        }
      />

      {/* Coverage banner */}
      {coverage ? (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-lg border p-4 ${
            coverage.covered ? "border-[color:var(--status-success)]/30 bg-[color:var(--status-success-bg)]" : "border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning-bg)]"
          }`}
          role="status"
        >
          <ShieldIcon covered={coverage.covered} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{coverage.covered ? "Covered by active contract(s)" : "Not covered — conversion needs an override reason"}</p>
            {coverage.contracts.length ? (
              <p className="text-sm text-muted-foreground">
                {coverage.contracts.map((c) => `${c.contractNo} (${c.contractType.toUpperCase()}, ${c.coverageType.replace(/_/g, " ")}, ends ${fmtDate(c.endDate)})`).join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Request body */}
      <SectionCard title="Reported issue">
        <DetailList>
          <DetailItem label="Status"><StatusBadge style={REQUEST_STATUS_STYLE[r.status]} /></DetailItem>
          <DetailItem label="Severity"><StatusBadge style={SEVERITY_STYLE[r.severity]} /></DetailItem>
          <DetailItem label="Category">{REQUEST_CATEGORY_LABEL[r.category]}</DetailItem>
          <DetailItem label="Source">{REQUEST_SOURCE_LABEL[r.source]}</DetailItem>
          <DetailItem label="Customer">{r.customer.legalName}</DetailItem>
          <DetailItem label="Site">{r.site.name} ({r.site.siteCode})</DetailItem>
          <DetailItem label="Asset">
            {r.asset ? (
              <a className="text-primary hover:underline" href={href(`/assets/${r.asset!.id}`)}>
                {r.asset.assetCode} · {r.asset.serialNumber ?? "no serial"}
              </a>
            ) : (
              "Not specified"
            )}
          </DetailItem>
          <DetailItem label="Preferred visit">{fmtDate(r.preferredVisitAt)}</DetailItem>
          <DetailItem label="First response">{r.firstResponseAt ? fmtDateTime(r.firstResponseAt) : "—"}</DetailItem>
        </DetailList>
        <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/60 p-4 text-sm leading-relaxed">{r.description}</p>
        {r.rejectedReason ? <p className="mt-3 rounded-md bg-[color:var(--status-danger-bg)] p-3 text-sm text-[color:var(--status-danger)]">Rejected: {r.rejectedReason}</p> : null}
      </SectionCard>

      {/* Triage actions */}
      {open ? (
        <SectionCard title="Triage actions" description="Workflow B: qualify the request before committing field resources.">
          <div className="flex flex-wrap gap-2">
            {r.status === "new" && canTriage ? (
              <Button variant="outline" onClick={() => setTriageOpen(true)}>Triage / adjust severity</Button>
            ) : null}
            {["new", "triaged", "needs_information"].includes(r.status) && canWrite ? (
              <Button variant="outline" onClick={() => setAcceptOpen(true)}>
                <CheckCircle2 className="mr-1.5 size-4" aria-hidden /> Accept
              </Button>
            ) : null}
            {["new", "triaged", "needs_information"].includes(r.status) && canTriage ? (
              <Button variant="outline" onClick={() => act.mutate({ action: "request-information" })}>
                <MessageCircleQuestion className="mr-1.5 size-4" aria-hidden /> Request information
              </Button>
            ) : null}
            {["new", "triaged", "needs_information"].includes(r.status) && canTriage ? (
              <Button variant="outline" className="text-[color:var(--status-danger)]" onClick={() => setRejectOpen(true)}>
                <Ban className="mr-1.5 size-4" aria-hidden /> Reject
              </Button>
            ) : null}
            {["converted"].includes(r.status) === false && r.status === "accepted" && canWrite ? (
              <Button variant="ghost" onClick={() => act.mutate({ action: "close" })}>
                <XCircle className="mr-1.5 size-4" aria-hidden /> Close without work order
              </Button>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      {/* Linked work orders */}
      <SectionCard title={`Work orders (${r.workOrders?.length ?? 0})`}>
        {!r.workOrders?.length ? (
          <EmptyState title="No work orders yet" description={r.status === "converted" ? "This request was converted — check the work order created from it." : "Convert this request to dispatch a field team."} />
        ) : (
          <ul className="divide-y rounded-lg border">
            {r.workOrders.map((wo) => (
              <li key={wo.id}>
                <a href={href(`/work-orders/${wo.id}`)} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{wo.title}</p>
                    <p className="text-xs text-muted-foreground">{wo.workOrderNo}</p>
                  </div>
                  <TextBadge tone={wo.status === "closed" ? "neutral" : wo.status === "cancelled" ? "danger" : "info"}>{wo.status.replace(/_/g, " ")}</TextBadge>
                </a>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Duplicates */}
      {r.possibleDuplicates?.length ? (
        <SectionCard title="Possible duplicates" description="Recent requests for the same asset — link at triage if this is a repeat.">
          <ul className="space-y-2">
            {r.possibleDuplicates.map((d) => (
              <li key={d.id}>
                <a href={href(`/requests/${d.id}`)} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                  <span className="font-medium">{d.requestNo} — {d.subject}</span>
                  <span className="text-xs text-muted-foreground">{fmtRelative(d.createdAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <ConvertDialog request={r} open={convertOpen} onOpenChange={setConvertOpen} />
      <TriageDialog request={r} open={triageOpen} onOpenChange={setTriageOpen} />
      <SimpleActionDialog
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        title="Accept request"
        description="Accepting records the first-response timestamp (SLA clock stops)."
        submitLabel="Accept"
        noteLabel="Note (optional)"
        onSubmit={(note) => act.mutate({ action: "accept", body: { note: note || undefined } })}
      />
      <SimpleActionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject request"
        description="A reason is mandatory and is kept with the audit trail."
        submitLabel="Reject"
        noteLabel="Reason *"
        requireNote
        danger
        onSubmit={(reason) => act.mutate({ action: "reject", body: { reason } })}
      />
    </div>
  );
}

function ShieldIcon({ covered }: { covered: boolean }) {
  return covered ? (
    <CheckCircle2 className="size-5 text-[color:var(--status-success)]" aria-hidden />
  ) : (
    <MessageCircleQuestion className="size-5 text-[color:var(--status-warning)]" aria-hidden />
  );
}

function TriageDialog({ request, open, onOpenChange }: { request: ServiceRequest; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [severity, setSeverity] = useState<Severity>(request.severity);
  const [category, setCategory] = useState<RequestCategory>(request.category);
  const [duplicateOfId, setDuplicateOfId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dupes = useQuery({
    queryKey: ["requests", "dupes", request.id],
    queryFn: () => apiGet<ServiceRequest[]>("/api/v1/service-requests", { assetId: request.assetId ?? undefined, limit: 10 }),
    enabled: open && Boolean(request.assetId),
  });

  const triage = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/service-requests/${request.id}/triage`, {
        severity,
        category,
        duplicateOfId: duplicateOfId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      toast({ title: "Triage saved" });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Triage failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Triage {request.requestNo}</DialogTitle>
          <DialogDescription>Confirm severity and category — SLA targets snapshot from these.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Severity" htmlFor="tr-sev" required>
            <EnumSelect id="tr-sev" options={severityOptions} value={severity} onValueChange={(v) => setSeverity(v as Severity)} />
          </Field>
          <Field label="Category" htmlFor="tr-cat" required>
            <EnumSelect id="tr-cat" options={requestCategoryOptions} value={category} onValueChange={(v) => setCategory(v as RequestCategory)} />
          </Field>
          {request.assetId ? (
            <Field label="Duplicate of" htmlFor="tr-dupe" hint="Mark if this repeats an open request for the same asset">
              <EnumSelect
                id="tr-dupe"
                options={[
                  { value: "", label: "Not a duplicate" },
                  ...(dupes.data ?? [])
                    .filter((d) => d.id !== request.id)
                    .map((d) => ({ value: d.id, label: `${d.requestNo} — ${d.subject}` })),
                ]}
                value={duplicateOfId}
                onValueChange={setDuplicateOfId}
              />
            </Field>
          ) : null}
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); triage.mutate(); }} disabled={triage.isPending}>{triage.isPending ? "Saving…" : "Save triage"}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SimpleActionDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  noteLabel,
  requireNote,
  danger,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  noteLabel: string;
  requireNote?: boolean;
  danger?: boolean;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setNote(""); setError(null); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={noteLabel} htmlFor={`sa-note-${title}`} required={requireNote}>
            <Textarea id={`sa-note-${title}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={requireNote ? "Mandatory — will be audited" : "Optional"} />
          </Field>
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant={danger ? "destructive" : "default"}
              disabled={requireNote && !note.trim()}
              onClick={() => {
                if (requireNote && !note.trim()) {
                  setError(`${noteLabel.replace(" *", "")} is required`);
                  return;
                }
                setError(null);
                onSubmit(note);
                setNote("");
                onOpenChange(false);
              }}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                 */
/* ------------------------------------------------------------------ */

export function RequestsView({ requestId }: { requestId?: string }) {
  const canWrite = useCan()("requests:write");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const requests = useQuery({
    queryKey: ["requests", { search, status, severity }],
    queryFn: () =>
      apiGet<ServiceRequest[]>("/api/v1/service-requests", {
        search: search || undefined,
        status: status || undefined,
        severity: severity || undefined,
        limit: 200,
      }),
  });

  if (requestId) return <RequestDetail requestId={requestId} />;

  const columns: ColumnDef<ServiceRequest, unknown>[] = [
    { accessorKey: "requestNo", header: "Request", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>()}</span> },
    {
      accessorKey: "subject",
      header: "Subject",
      cell: (i) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{i.getValue<string>()}</p>
          <p className="truncate text-xs text-muted-foreground">{i.row.original.customer.legalName} · {i.row.original.site.name}</p>
        </div>
      ),
    },
    { accessorKey: "category", header: "Category", cell: (i) => REQUEST_CATEGORY_LABEL[i.getValue<RequestCategory>()] },
    { accessorKey: "severity", header: "Severity", cell: (i) => <StatusBadge style={SEVERITY_STYLE[i.getValue<Severity>()]} /> },
    { accessorKey: "status", header: "Status", cell: (i) => <StatusBadge style={REQUEST_STATUS_STYLE[i.getValue<ServiceRequest["status"]>()]} /> },
    {
      accessorKey: "coverage",
      header: "Coverage",
      cell: (i) => {
        const cov = i.row.original.coverage;
        if (!cov) return <span className="text-muted-foreground">—</span>;
        return cov.covered ? (
          <TextBadge tone="success">Covered ({cov.contracts.length})</TextBadge>
        ) : (
          <TextBadge tone="warning">Uncovered</TextBadge>
        );
      },
    },
    { accessorKey: "createdAt", header: "Logged", cell: (i) => <span className="text-muted-foreground">{fmtDate(i.getValue<string>())}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service requests"
        description="Every customer-reported issue — phone, email, WhatsApp or portal — queued for triage."
        actions={canWrite && <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Log request</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search requests" placeholder="Search subject, request no…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <EnumSelect id="rq-filter-status" triggerClassName="w-40" options={[{ value: "", label: "All statuses" }, ...requestStatusOptions]} value={status} onValueChange={setStatus} placeholder="All statuses" />
        <EnumSelect id="rq-filter-sev" triggerClassName="w-40" options={[{ value: "", label: "All severities" }, ...severityOptions]} value={severity} onValueChange={setSeverity} placeholder="All severities" />
      </div>

      <DataTable
        columns={columns}
        data={requests.data ?? []}
        loading={requests.isLoading}
        onRowClick={(row) => navigate(`/requests/${row.id}`)}
        rowNoun="requests"
        emptyTitle="No requests match"
        emptyDescription="Log the first customer-reported issue to start the workflow."
        emptyAction={canWrite ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Log request</Button> : undefined}
        ariaLabel="Service requests"
      />

      {canWrite ? <CreateRequestDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </div>
  );
}
