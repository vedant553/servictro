"use client";

/**
 * Field execution surface (Workflow C, technician + reviewer side):
 * checklist capture with outcome rules, electrical measurements,
 * observations, parts usage, completion summary, customer acknowledgement
 * and the versioned service report lifecycle (generate → approve → publish).
 *
 * Statuses in which execution may be captured: scheduled / in_progress / on_hold
 * (EXECUTION_STATUSES, ADR-017). Guards are server-authoritative — the UI only
 * reflects them.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { post as apiPost, ApiError } from "@/lib/api/client";
import type { WorkOrder, ChecklistResultItem } from "@/lib/api/types";
import { SectionCard, EmptyState, InlineError, DetailItem } from "@/components/app/shared/primitives";
import { Field, TextInput, TextArea, EnumSelect, TagList } from "@/components/app/shared/form-fields";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import { CHECKLIST_OUTCOME_STYLE, REPORT_STATUS_STYLE, ACK_METHOD_STYLE, ackMethodOptions } from "@/design-system/tokens";
import { fmtDateTime } from "@/lib/format";
import { CHECKLIST_OUTCOMES, ACKNOWLEDGEMENT_METHODS, type ChecklistOutcome, type AcknowledgementMethod } from "@serviceos/contracts";
import { ListChecks, Ruler, MessageSquarePlus, Package, CheckCircle2, PenLine, FileText, Download, ThumbsUp, Send } from "lucide-react";

const outcomeOptions = CHECKLIST_OUTCOMES.map((o) => ({ value: o, label: CHECKLIST_OUTCOME_STYLE[o].label }));

/* ------------------------------------------------------------------ */
/* Checklist capture                                                    */
/* ------------------------------------------------------------------ */

export function ChecklistPanel({ workOrder, canExecute }: { workOrder: WorkOrder; canExecute: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const definition = workOrder.checklistTemplateVersion?.definition;
  const results = workOrder.checklistResults ?? [];
  const [draft, setDraft] = useState<Record<string, { outcome: ChecklistOutcome; value?: string; note?: string; exceptionReason?: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const items = Object.entries(draft).map(([itemKey, d]) => ({
        itemKey,
        outcome: d.outcome,
        value: d.value !== undefined && d.value !== "" ? Number(d.value) : undefined,
        note: d.note || undefined,
        exceptionReason: d.exceptionReason || undefined,
      }));
      return apiPost(`/api/v1/work-orders/${workOrder.id}/checklist`, { items });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      setDraft({});
      toast({ title: "Checklist saved" });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save the checklist"),
  });

  if (!definition) return null;
  const templateName = workOrder.checklistTemplateVersion?.template?.name ?? "Checklist";

  const resultFor = (key: string): ChecklistResultItem | undefined => results.find((r) => r.itemKey === key);
  const draftFor = (key: string) => draft[key];

  return (
    <SectionCard
      title={`Checklist — ${templateName} (v${workOrder.checklistTemplateVersion!.version})`}
      description="Required items need a definite outcome (pass/fail/N/A) or an exception with a reason before review."
      actions={
        canExecute && Object.keys(draft).length > 0 ? (
          <Button size="sm" onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending}>
            {save.isPending ? "Saving…" : `Save ${Object.keys(draft).length} item(s)`}
          </Button>
        ) : null
      }
    >
      <ul className="space-y-2">
        {definition.items.map((item) => {
          const saved = resultFor(item.key);
          const d = draftFor(item.key);
          const outcome = d?.outcome ?? saved?.outcome ?? "not_checked";
          const value = d?.value ?? (saved?.value != null ? String(saved.value) : "");
          return (
            <li key={item.key} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {item.label}
                    {item.required ? <TextBadge tone="danger">Required</TextBadge> : null}
                    {item.type === "measurement" && item.unit ? <TextBadge tone="info">{item.unit}</TextBadge> : null}
                  </p>
                  {item.instructions ? <p className="mt-0.5 text-xs text-muted-foreground">{item.instructions}</p> : null}
                  {saved && !d ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Recorded: <StatusBadge style={CHECKLIST_OUTCOME_STYLE[saved.outcome]} className="ml-1" />
                      {saved.value != null ? ` · ${saved.value}${item.unit ? ` ${item.unit}` : ""}` : ""}
                      {saved.note ? ` · ${saved.note}` : ""}
                    </p>
                  ) : null}
                </div>
                {canExecute ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {item.type === "measurement" ? (
                      <Input
                        aria-label={`Measured value for ${item.label}${item.minValue != null || item.maxValue != null ? ` (accept ${item.minValue ?? "–"}–${item.maxValue ?? "–"} ${item.unit ?? ""})` : ""}`}
                        className="h-9 w-28"
                        inputMode="decimal"
                        placeholder={`${item.minValue ?? ""}–${item.maxValue ?? ""}`}
                        value={value}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [item.key]: { ...(prev[item.key] ?? { outcome }), value: e.target.value } }))}
                      />
                    ) : null}
                    <EnumSelect
                      id={`cl-${item.key}`}
                      options={outcomeOptions}
                      value={outcome}
                      onValueChange={(v) => setDraft((prev) => ({ ...prev, [item.key]: { ...(prev[item.key] ?? { value: value || undefined }), outcome: v as ChecklistOutcome } }))}
                    />
                  </div>
                ) : (
                  <StatusBadge style={CHECKLIST_OUTCOME_STYLE[outcome]} />
                )}
              </div>
              {canExecute && outcome === "exception" ? (
                <div className="mt-2">
                  <Input
                    aria-label={`Exception reason for ${item.label}`}
                    placeholder="Exception reason (mandatory for 'exception')"
                    value={d?.exceptionReason ?? ""}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [item.key]: { ...(prev[item.key] ?? { outcome }), exceptionReason: e.target.value } }))}
                  />
                </div>
              ) : null}
              {canExecute && outcome !== "not_checked" ? (
                <div className="mt-2">
                  <Input
                    aria-label={`Note for ${item.label}`}
                    placeholder="Optional note"
                    value={d?.note ?? ""}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [item.key]: { ...(prev[item.key] ?? { outcome }), note: e.target.value } }))}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <InlineError message={error} />
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Measurements                                                         */
/* ------------------------------------------------------------------ */

export function MeasurementsPanel({ workOrder, canExecute }: { workOrder: WorkOrder; canExecute: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ measurementKey: "", measuredValue: "", unit: "", phase: "", instrumentId: "", calibrationReference: "", note: "" });

  const add = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/work-orders/${workOrder.id}/measurements`, {
        measurementKey: form.measurementKey,
        measuredValue: Number(form.measuredValue),
        unit: form.unit,
        phase: form.phase || undefined,
        instrumentId: form.instrumentId || undefined,
        calibrationReference: form.calibrationReference || undefined,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      toast({ title: "Measurement recorded" });
      setForm({ measurementKey: "", measuredValue: "", unit: "", phase: "", instrumentId: "", calibrationReference: "", note: "" });
      setOpen(false);
    },
    onError: (err) => {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? "Could not record the measurement");
    },
  });

  const measurements = workOrder.measurements ?? [];
  const suggestedKeys = (workOrder.checklistTemplateVersion?.definition.items ?? []).filter((i) => i.type === "measurement");

  return (
    <SectionCard
      title={`Measurements (${measurements.length})`}
      description="Electrical readings captured on-site — IR values, contact resistance, temperatures."
      actions={canExecute && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Ruler className="mr-1 size-3.5" aria-hidden />Add</Button>}
    >
      {!measurements.length ? (
        <EmptyState title="No measurements" description="Record readings against checklist measurement keys." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Key</th>
                <th className="py-2 pr-4">Value</th>
                <th className="py-2 pr-4">Phase</th>
                <th className="py-2 pr-4">Instrument</th>
                <th className="py-2">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{m.measurementKey}</td>
                  <td className="py-2 pr-4 font-medium tabular-nums">{m.measuredValue} {m.unit}</td>
                  <td className="py-2 pr-4">{m.phase ?? "—"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{m.instrumentId ?? "—"}</td>
                  <td className="py-2 text-muted-foreground">{fmtDateTime(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record measurement</DialogTitle>
            <DialogDescription>Reading + instrument traceability for the service report.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Measurement key" htmlFor="m-key" required hint={suggestedKeys.length ? `Suggested: ${suggestedKeys.map((k) => k.key).join(", ")}` : "e.g. insulation_resistance_mohm"}>
              <Input id="m-key" list="m-key-suggestions" value={form.measurementKey} onChange={(e) => setForm({ ...form, measurementKey: e.target.value })} placeholder="insulation_resistance_mohm" />
              <datalist id="m-key-suggestions">
                {suggestedKeys.map((k) => (
                  <option key={k.key} value={k.key} />
                ))}
              </datalist>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Measured value" htmlFor="m-val" required>
                <TextInput id="m-val" inputMode="decimal" value={form.measuredValue} onChange={(e) => setForm({ ...form, measuredValue: e.target.value })} placeholder="550" />
              </Field>
              <Field label="Unit" htmlFor="m-unit" required>
                <TextInput id="m-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="MΩ / μΩ / °C" />
              </Field>
              <Field label="Phase (optional)" htmlFor="m-phase">
                <TextInput id="m-phase" value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })} placeholder="RY / YB / BR" />
              </Field>
              <Field label="Instrument ID (optional)" htmlFor="m-inst">
                <TextInput id="m-inst" value={form.instrumentId} onChange={(e) => setForm({ ...form, instrumentId: e.target.value })} placeholder="MEG-0042" />
              </Field>
            </div>
            <Field label="Calibration reference (optional)" htmlFor="m-cal">
              <TextInput id="m-cal" value={form.calibrationReference} onChange={(e) => setForm({ ...form, calibrationReference: e.target.value })} placeholder="CAL-2026-118" />
            </Field>
            <InlineError message={error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => { setError(null); add.mutate(); }} disabled={add.isPending || !form.measurementKey || !form.measuredValue || !form.unit}>
                {add.isPending ? "Recording…" : "Record"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Observations & parts                                                 */
/* ------------------------------------------------------------------ */

export function ObservationsPanel({ workOrder, canExecute }: { workOrder: WorkOrder; canExecute: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [kind, setKind] = useState("finding");
  const observations = workOrder.observations ?? [];

  const add = useMutation({
    mutationFn: () => apiPost(`/api/v1/work-orders/${workOrder.id}/observations`, { text, kind }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      setText("");
      toast({ title: "Observation added" });
    },
    onError: (err) => toast({ title: "Failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  return (
    <SectionCard title={`Observations (${observations.length})`} description="Findings and actions recorded during execution — they flow into the service report.">
      {canExecute ? (
        <form
          className="mb-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 3) add.mutate();
          }}
        >
          <Input aria-label="Observation text" placeholder="Feeder 3 breaker contacts show pitting…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <div className="w-40">
              <EnumSelect id="obs-kind" options={[
                { value: "observation", label: "Observation" },
                { value: "finding", label: "Finding" },
                { value: "action", label: "Action" },
                { value: "note", label: "Note" },
              ]} value={kind} onValueChange={setKind} />
            </div>
            <Button type="submit" disabled={add.isPending || text.trim().length < 3}>
              <MessageSquarePlus className="mr-1 size-4" aria-hidden /> Add
            </Button>
          </div>
        </form>
      ) : null}
      {!observations.length ? (
        <EmptyState title="No observations yet" />
      ) : (
        <ul className="space-y-2">
          {observations.map((o) => (
            <li key={o.id} className="rounded-lg border p-3 text-sm">
              <p className="flex items-center gap-2">
                <TextBadge tone={o.kind === "finding" ? "warning" : o.kind === "action" ? "info" : "neutral"}>{o.kind}</TextBadge>
                <span className="text-xs text-muted-foreground">{fmtDateTime(o.createdAt)}</span>
              </p>
              <p className="mt-1.5 leading-relaxed">{o.text}</p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function PartsPanel({ workOrder, canExecute }: { workOrder: WorkOrder; canExecute: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ partCode: "", description: "", quantity: "1", unit: "", serialOrBatch: "", note: "" });
  const parts = workOrder.partsUsage ?? [];

  const add = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/work-orders/${workOrder.id}/parts`, {
        partCode: form.partCode,
        description: form.description || undefined,
        quantity: Number(form.quantity),
        unit: form.unit || undefined,
        serialOrBatch: form.serialOrBatch || undefined,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      toast({ title: "Parts recorded" });
      setForm({ partCode: "", description: "", quantity: "1", unit: "", serialOrBatch: "", note: "" });
      setOpen(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not record parts"),
  });

  return (
    <SectionCard
      title={`Parts used (${parts.length})`}
      actions={canExecute && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Package className="mr-1 size-3.5" aria-hidden />Add</Button>}
    >
      {!parts.length ? (
        <EmptyState title="No parts recorded" description="Consumed spares are itemized here for billing and warranty." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {parts.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-mono text-xs font-medium">{p.partCode}</p>
                <p className="truncate text-xs text-muted-foreground">{p.description ?? "—"}{p.serialOrBatch ? ` · S/N ${p.serialOrBatch}` : ""}</p>
              </div>
              <p className="shrink-0 font-medium tabular-nums">{p.quantity} {p.unit ?? ""}</p>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record parts used</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Part code" htmlFor="p-code" required>
              <TextInput id="p-code" value={form.partCode} onChange={(e) => setForm({ ...form, partCode: e.target.value })} placeholder="CNT-ACB-630-3P" />
            </Field>
            <Field label="Description" htmlFor="p-desc">
              <TextInput id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="ACB 630A 3-pole contact kit" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quantity" htmlFor="p-qty" required>
                <TextInput id="p-qty" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </Field>
              <Field label="Unit" htmlFor="p-unit">
                <TextInput id="p-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pcs" />
              </Field>
            </div>
            <Field label="Serial / batch (optional)" htmlFor="p-sn">
              <TextInput id="p-sn" value={form.serialOrBatch} onChange={(e) => setForm({ ...form, serialOrBatch: e.target.value })} />
            </Field>
            <InlineError message={error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => { setError(null); add.mutate(); }} disabled={add.isPending || !form.partCode || !form.quantity}>{add.isPending ? "Recording…" : "Record"}</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Completion / acknowledgement / reports                               */
/* ------------------------------------------------------------------ */

export function CompletionPanel({ workOrder, canExecute, canReview }: { workOrder: WorkOrder; canExecute: boolean; canReview: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  const complete = useMutation({
    mutationFn: () => apiPost(`/api/v1/work-orders/${workOrder.id}/completion`, { completionSummary: summary }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      toast({ title: "Completion summary submitted", description: "Work order moved to pending review." });
      setSummary("");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Completion failed"),
  });

  const eligible = workOrder.status === "in_progress";
  if (workOrder.completionSummary) {
    return (
      <SectionCard title="Completion summary" description="Submitted by the field team; awaiting reviewer approval.">
        <p className="whitespace-pre-wrap rounded-md bg-muted/60 p-4 text-sm leading-relaxed">{workOrder.completionSummary}</p>
      </SectionCard>
    );
  }
  if (!eligible || !canExecute) return null;

  return (
    <SectionCard title="Complete the work" description="Required before the work order can move to pending review (evidence must be captured above).">
      <Field label="Completion summary" htmlFor="comp-summary" required hint="What was done, what was found, what remains">
        <TextArea id="comp-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Replaced feeder 3 contact kit; IR values restored above 500 MΩ; advised load rebalancing…" />
      </Field>
      <InlineError message={error} />
      <div className="mt-3">
        <Button onClick={() => { setError(null); complete.mutate(); }} disabled={complete.isPending || summary.trim().length < 10}>
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden /> {complete.isPending ? "Submitting…" : "Submit for review"}
        </Button>
      </div>
      {!canReview ? <p className="mt-2 text-xs text-muted-foreground">A reviewer (service manager) approves the report after submission.</p> : null}
    </SectionCard>
  );
}

export function AcknowledgementPanel({ workOrder, canExecute }: { workOrder: WorkOrder; canExecute: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ method: "signature" as AcknowledgementMethod, acknowledgedByName: "", acknowledgedByRole: "", notSignedReason: "" });

  const capture = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/work-orders/${workOrder.id}/acknowledgement`, {
        method: form.method,
        acknowledgedByName: form.acknowledgedByName,
        acknowledgedByRole: form.acknowledgedByRole || undefined,
        notSignedReason: form.method === "not_signed" ? form.notSignedReason : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      toast({ title: "Acknowledgement captured" });
      setOpen(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Capture failed"),
  });

  const reports = (workOrder.serviceReports ?? []).filter((r) => r.status === "published" || r.status === "approved");
  const existing = reports.find((r) => r.acknowledgement)?.acknowledgement;
  if (existing && !open) {
    return (
      <SectionCard title="Customer acknowledgement">
        <DetailItem label="Method">{ACK_METHOD_STYLE[existing.method].label}</DetailItem>
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Signed by </span>
          {existing.acknowledgedByName}
          {existing.acknowledgedByRole ? ` (${existing.acknowledgedByRole})` : ""}
        </p>
        {existing.notSignedReason ? <p className="mt-1 text-sm text-[color:var(--status-warning)]">Not signed: {existing.notSignedReason}</p> : null}
      </SectionCard>
    );
  }
  if (!canExecute || workOrder.status === "closed") return null;

  return (
    <SectionCard
      title="Customer acknowledgement"
      description="Mandatory before closure (Tech Spec §12.3): signature, name confirmation, or a documented refusal."
      actions={<Button size="sm" variant="outline" onClick={() => setOpen(true)}><PenLine className="mr-1 size-3.5" aria-hidden />Capture</Button>}
    >
      <EmptyState title="Not yet captured" description="Capture the customer's acknowledgement of the completed service." />
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Capture acknowledgement</DialogTitle>
            <DialogDescription>Recorded against the published report version.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Method" htmlFor="ack-method" required>
              <EnumSelect id="ack-method" options={ackMethodOptions} value={form.method} onValueChange={(v) => setForm({ ...form, method: v as AcknowledgementMethod })} />
            </Field>
            {form.method !== "not_signed" ? (
              <>
                <Field label="Acknowledged by (name)" htmlFor="ack-name" required>
                  <TextInput id="ack-name" value={form.acknowledgedByName} onChange={(e) => setForm({ ...form, acknowledgedByName: e.target.value })} placeholder="R. Deshmukh" />
                </Field>
                <Field label="Role (optional)" htmlFor="ack-role">
                  <TextInput id="ack-role" value={form.acknowledgedByRole} onChange={(e) => setForm({ ...form, acknowledgedByRole: e.target.value })} placeholder="Maintenance manager" />
                </Field>
              </>
            ) : (
              <Field label="Reason not signed" htmlFor="ack-reason" required>
                <TextArea id="ack-reason" rows={2} value={form.notSignedReason} onChange={(e) => setForm({ ...form, notSignedReason: e.target.value })} placeholder="Customer contact unavailable; report left with security desk." />
              </Field>
            )}
            <InlineError message={error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => { setError(null); capture.mutate(); }}
                disabled={capture.isPending || (form.method !== "not_signed" ? !form.acknowledgedByName.trim() : !form.notSignedReason.trim())}
              >
                {capture.isPending ? "Saving…" : "Capture acknowledgement"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

export function ReportsPanel({ workOrder, canExecute, canReview, canPublish }: { workOrder: WorkOrder; canExecute: boolean; canReview: boolean; canPublish: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const reports = workOrder.serviceReports ?? [];

  const generate = useMutation({
    mutationFn: () => apiPost(`/api/v1/work-orders/${workOrder.id}/service-reports`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      toast({ title: "Report generated", description: "Draft PDF created from the work-order snapshot." });
    },
    onError: (err) => toast({ title: "Generation failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });
  const act = useMutation({
    mutationFn: (kind: "approve" | "publish") => apiPost(`/api/v1/work-orders/reports/${reports[0]?.id}/${kind}`),
    onSuccess: (_d, kind) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders", workOrder.id] });
      toast({ title: kind === "approve" ? "Report approved" : "Report published" });
    },
    onError: (err) => toast({ title: "Action failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  const latest = reports[0];

  return (
    <SectionCard
      title={`Service reports (${reports.length})`}
      description="Versioned and immutable once published — corrections create a superseding version (Tech Spec §12.3)."
      actions={
        <div className="flex gap-2">
          {canExecute && workOrder.status !== "draft" && workOrder.status !== "cancelled" && !latest ? (
            <Button size="sm" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}>
              <FileText className="mr-1 size-3.5" aria-hidden /> {generate.isPending ? "Generating…" : "Generate"}
            </Button>
          ) : null}
          {latest && latest.status === "pending_review" && canReview ? (
            <Button size="sm" variant="outline" onClick={() => act.mutate("approve")} disabled={act.isPending}>
              <ThumbsUp className="mr-1 size-3.5" aria-hidden /> Approve
            </Button>
          ) : null}
          {latest && latest.status === "approved" && canPublish ? (
            <Button size="sm" onClick={() => act.mutate("publish")} disabled={act.isPending}>
              <Send className="mr-1 size-3.5" aria-hidden /> Publish
            </Button>
          ) : null}
        </div>
      }
    >
      {!reports.length ? (
        <EmptyState title="No reports yet" description="Generate the PDF after execution evidence is captured." />
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-medium">
                  Version {r.version}
                  <StatusBadge style={REPORT_STATUS_STYLE[r.status]} />
                </p>
                {r.downloadUrl ? (
                  <a href={r.downloadUrl} aria-label={`Download report version ${r.version}`}>
                    <Button size="sm" variant="outline"><Download className="mr-1 size-3.5" aria-hidden /> PDF</Button>
                  </a>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Generated {fmtDateTime(r.generatedAt)}
                {r.approvedAt ? ` · approved by ${r.approvedByName ?? "reviewer"} ${fmtDateTime(r.approvedAt)}` : ""}
                {r.publishedAt ? ` · published ${fmtDateTime(r.publishedAt)}` : ""}
              </p>
              {r.summary ? <p className="mt-2 line-clamp-3 text-sm">{r.summary}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Event timeline                                                       */
/* ------------------------------------------------------------------ */

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  status_changed: "Status changed",
  assigned: "Technician assigned",
  unassigned: "Unassigned",
  checklist_saved: "Checklist saved",
  observation_added: "Observation added",
  measurement_added: "Measurement added",
  parts_recorded: "Parts recorded",
  report_generated: "Report generated",
  report_published: "Report published",
  acknowledgement_captured: "Acknowledgement captured",
  note_added: "Note added",
};

export function EventsPanel({ workOrder }: { workOrder: WorkOrder }) {
  const events = [...(workOrder.events ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return (
    <SectionCard title="Activity" description="Every transition and capture is event-sourced and auditable.">
      {!events.length ? (
        <EmptyState title="No events" />
      ) : (
        <ol className="relative space-y-4 border-l pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[27px] top-1 size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
              <p className="text-sm font-medium">{EVENT_LABELS[e.eventType] ?? e.eventType}</p>
              <p className="text-xs text-muted-foreground">
                {fmtDateTime(e.occurredAt)}
                {e.fromStatus && e.toStatus ? ` · ${e.fromStatus.replace(/_/g, " ")} → ${e.toStatus.replace(/_/g, " ")}` : ""}
                {e.reason ? ` · reason: ${e.reason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

export function RequiredSkillsRow({ workOrder }: { workOrder: WorkOrder }) {
  if (!workOrder.requiredSkills?.length) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Required skills</span>
      <TagList items={workOrder.requiredSkills} />
    </div>
  );
}
