"use client";

/**
 * Checklist templates — versioned, immutable definitions (ADR-018).
 * Editors compose items (check / measurement / informational); publishing a
 * new version never mutates work orders that already snapshot an older one.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, patch as apiPatch, ApiError } from "@/lib/api/client";
import type { ChecklistTemplate, ChecklistTemplateDetail } from "@/lib/api/types";
import type { ChecklistDefinition } from "@serviceos/contracts";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, EmptyState, SectionCard, InlineError, DetailItem } from "@/components/app/shared/primitives";
import { Field, TextInput, EnumSelect, TextArea } from "@/components/app/shared/form-fields";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import { assetFamilyOptions } from "@/design-system/tokens";
import { useCan } from "@/lib/auth/store";
import { fmtDateTime } from "@/lib/format";
import { useHashRoute } from "@/lib/router";
import { ListChecks, Plus, Layers, Trash2 } from "lucide-react";
import type { AssetFamily } from "@serviceos/contracts";

interface DraftItem {
  key: string;
  label: string;
  type: "check" | "measurement" | "informational";
  required: boolean;
  unit: string;
  minValue: string;
  maxValue: string;
  instructions: string;
}

function CreateTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [name, setName] = useState("");
  const [assetFamily, setAssetFamily] = useState<AssetFamily>("lt_panel");
  const [items, setItems] = useState<DraftItem[]>([]);

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { key: "", label: "", type: "check", required: true, unit: "", minValue: "", maxValue: "", instructions: "" },
    ]);

  const updateItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const create = useMutation({
    mutationFn: () => {
      const definition: ChecklistDefinition = {
        schemaVersion: 1,
        items: items.map((it) => ({
          key: it.key,
          label: it.label,
          type: it.type,
          required: it.required,
          unit: it.type === "measurement" && it.unit ? it.unit : undefined,
          minValue: it.minValue ? Number(it.minValue) : undefined,
          maxValue: it.maxValue ? Number(it.maxValue) : undefined,
          instructions: it.instructions || undefined,
        })),
      };
      return apiPost<ChecklistTemplate>("/api/v1/checklist-templates", { templateKey, name, assetFamily, definition });
    },
    onSuccess: (t) => {
      queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
      toast({ title: "Template created", description: `${t.name} (v${t.activeVersion})` });
      setTemplateKey(""); setName(""); setItems([]);
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create the template"),
  });

  const keysValid = items.every((it) => /^[a-z0-9_]{2,60}$/.test(it.key)) && new Set(items.map((i) => i.key)).size === items.length;
  const valid = templateKey && name && items.length > 0 && items.every((it) => it.label.length >= 2) && keysValid &&
    items.every((it) => it.type !== "measurement" || it.unit);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create checklist template</DialogTitle>
          <DialogDescription>Version 1 is created immutable. Work orders snapshot the version they are assigned.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template key" htmlFor="t-key" required hint="lower_snake_case, stable identifier">
              <TextInput id="t-key" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} placeholder="lt_panel_pm" />
            </Field>
            <Field label="Name" htmlFor="t-name" required>
              <TextInput id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="LT Panel — Quarterly PM" />
            </Field>
            <Field label="Asset family" htmlFor="t-family" required>
              <EnumSelect id="t-family" options={assetFamilyOptions} value={assetFamily} onValueChange={(v) => setAssetFamily(v as AssetFamily)} />
            </Field>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Items ({items.length})</p>
              <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="mr-1 size-3.5" aria-hidden />Add item</Button>
            </div>
            {!items.length ? (
              <p className="text-sm text-muted-foreground">Add checklist items — checks, measurements with units and limits, or informational steps.</p>
            ) : (
              <ul className="space-y-3">
                {items.map((it, idx) => (
                  <li key={idx} className="rounded-md border bg-card p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Key" htmlFor={`it-key-${idx}`} required error={it.key && !/^[a-z0-9_]{2,60}$/.test(it.key) ? "lower_snake_case, 2–60 chars" : undefined}>
                        <TextInput id={`it-key-${idx}`} value={it.key} onChange={(e) => updateItem(idx, { key: e.target.value })} placeholder="visual_inspection" />
                      </Field>
                      <Field label="Label" htmlFor={`it-label-${idx}`} required error={it.label && it.label.length < 2 ? "Min 2 characters" : undefined}>
                        <TextInput id={`it-label-${idx}`} value={it.label} onChange={(e) => updateItem(idx, { label: e.target.value })} placeholder="Visual inspection of busbar chamber" />
                      </Field>
                      <Field label="Type" htmlFor={`it-type-${idx}`} required>
                        <EnumSelect
                          id={`it-type-${idx}`}
                          options={[
                            { value: "check", label: "Check (pass/fail)" },
                            { value: "measurement", label: "Measurement (value)" },
                            { value: "informational", label: "Informational" },
                          ]}
                          value={it.type}
                          onValueChange={(v) => updateItem(idx, { type: v as DraftItem["type"] })}
                        />
                      </Field>
                      {it.type === "measurement" ? (
                        <div className="grid grid-cols-3 gap-2">
                          <Field label="Unit" htmlFor={`it-unit-${idx}`} required>
                            <TextInput id={`it-unit-${idx}`} value={it.unit} onChange={(e) => updateItem(idx, { unit: e.target.value })} placeholder="MΩ" />
                          </Field>
                          <Field label="Min" htmlFor={`it-min-${idx}`}>
                            <TextInput id={`it-min-${idx}`} inputMode="decimal" value={it.minValue} onChange={(e) => updateItem(idx, { minValue: e.target.value })} placeholder="500" />
                          </Field>
                          <Field label="Max" htmlFor={`it-max-${idx}`}>
                            <TextInput id={`it-max-${idx}`} inputMode="decimal" value={it.maxValue} onChange={(e) => updateItem(idx, { maxValue: e.target.value })} />
                          </Field>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Field label="Instructions (optional)" htmlFor={`it-ins-${idx}`}>
                        <TextInput id={`it-ins-${idx}`} value={it.instructions} onChange={(e) => updateItem(idx, { instructions: e.target.value })} placeholder="De-energize before opening" />
                      </Field>
                      <div className="flex items-end gap-2 pb-1.5">
                        <label className="flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={it.required} onChange={(e) => updateItem(idx, { required: e.target.checked })} className="size-4 accent-[color:var(--primary)]" />
                          Required
                        </label>
                        <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-[color:var(--status-danger)]" aria-label="Remove item" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); create.mutate(); }} disabled={create.isPending || !valid}>
              {create.isPending ? "Creating…" : "Create template"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewVersionDialog({ template, open, onOpenChange }: { template: ChecklistTemplateDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const current = template.versions.find((v) => v.version === template.activeVersion)?.definition ?? { schemaVersion: 1, items: [] };
  const [json, setJson] = useState(JSON.stringify(current, null, 2));
  const [error, setError] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () => apiPost(`/api/v1/checklist-templates/${template.id}/versions`, { definition: JSON.parse(json) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
      toast({ title: "New version published" });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Invalid definition — check JSON syntax"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New version — {template.name}</DialogTitle>
          <DialogDescription>Edit the JSON definition (validated server-side against schema v1). Existing snapshots are unaffected.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Definition" htmlFor="v-json" required>
            <TextArea id="v-json" rows={14} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
          </Field>
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); publish.mutate(); }} disabled={publish.isPending}>
              <Layers className="mr-1.5 size-4" aria-hidden /> {publish.isPending ? "Publishing…" : "Publish version"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDetailSection({ templateId }: { templateId: string }) {
  const canManage = useCan()("checklists:manage");
  const [versionOpen, setVersionOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["checklist-templates", templateId],
    queryFn: () => apiGet<ChecklistTemplateDetail>(`/api/v1/checklist-templates/${templateId}`),
  });

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Loading template…</p>;
  if (detail.isError || !detail.data) return <EmptyState title="Template not found" />;

  const t = detail.data;
  const versions = [...(t.versions ?? [])].sort((a, b) => b.version - a.version);
  const active = versions.find((v) => v.version === t.activeVersion);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.name}
        description={`${t.templateKey} · ${t.assetFamily.replace(/_/g, " ")} · ${versions.length} version(s); v${t.activeVersion} is active`}
        actions={canManage && <Button onClick={() => setVersionOpen(true)}><Layers className="mr-1.5 size-4" aria-hidden />New version</Button>}
      />

      <SectionCard title={`Active definition (v${t.activeVersion}) — ${active?.definition.items.length ?? 0} items`}>
        <ol className="space-y-2">
          {(active?.definition.items ?? []).map((item, i) => (
            <li key={item.key} className="rounded-lg border p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="text-muted-foreground">{i + 1}.</span>
                {item.label}
                {item.required ? <TextBadge tone="danger">Required</TextBadge> : <TextBadge>Optional</TextBadge>}
                {item.type === "measurement" && item.unit ? <TextBadge tone="info">{item.unit}</TextBadge> : null}
                <span className="font-mono text-xs text-muted-foreground">{item.key}</span>
              </p>
              {item.instructions ? <p className="mt-1 text-xs text-muted-foreground">{item.instructions}</p> : null}
              {item.type === "measurement" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Accept range: {item.minValue ?? "–"} … {item.maxValue ?? "–"} {item.unit ?? ""}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Version history">
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">Version {v.version}</span>
              <span className="text-xs text-muted-foreground">{v.definition.items.length} items · {fmtDateTime(v.createdAt)}</span>
              {v.version === t.activeVersion ? <TextBadge tone="success">Active</TextBadge> : null}
            </li>
          ))}
        </ul>
      </SectionCard>

      {canManage ? <NewVersionDialog template={t} open={versionOpen} onOpenChange={setVersionOpen} /> : null}
    </div>
  );
}

export function ChecklistsView() {
  const canManage = useCan()("checklists:manage");
  const route = useHashRoute();
  const [createOpen, setCreateOpen] = useState(false);
  const templateId = route.segments[1];

  const templates = useQuery({
    queryKey: ["checklist-templates", "list"],
    queryFn: () => apiGet<ChecklistTemplate[]>("/api/v1/checklist-templates", { limit: 100 }),
  });

  if (templateId) return <TemplateDetailSection templateId={templateId} />;

  const columns: ColumnDef<ChecklistTemplate, unknown>[] = [
    { accessorKey: "templateKey", header: "Key", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>()}</span> },
    { accessorKey: "name", header: "Template", cell: (i) => <span className="font-medium">{i.getValue<string>()}</span> },
    { accessorKey: "itemCount", header: "Items", cell: (i) => <span className="tabular-nums">{i.getValue<number>()}</span> },
    { accessorKey: "activeVersion", header: "Active", cell: (i) => <TextBadge tone="info">v{i.getValue<number>()}</TextBadge> },
    {
      accessorKey: "status",
      header: "Status",
      cell: (i) => <StatusBadge style={{ label: i.getValue<string>() === "active" ? "Active" : "Archived", tone: i.getValue<string>() === "active" ? "success" : "neutral" }} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Checklist templates"
        description="Standard operating procedures for field execution — versioned and immutable once assigned."
        actions={canManage && <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Create template</Button>}
      />
      <DataTable
        columns={columns}
        data={templates.data ?? []}
        loading={templates.isLoading}
        onRowClick={(row) => (window.location.hash = `#/checklists/${row.id}`)}
        emptyTitle="No templates"
        emptyDescription="Create LT panel and HT switchgear PM checklists to standardize field work."
        emptyAction={canManage ? <Button size="sm" onClick={() => setCreateOpen(true)}><ListChecks className="mr-1.5 size-4" aria-hidden />Create template</Button> : undefined}
        ariaLabel="Checklist templates"
      />
      {canManage ? <CreateTemplateDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </div>
  );
}
