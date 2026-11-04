"use client";

/**
 * Assets view — the installed-base register (Workflow A).
 * List with family/site/customer filters, registration with per-family
 * nameplate specification, and a detail screen surfacing warranty/AMC
 * coverage (ADR-007: entitlement lives in contracts), QR nameplate,
 * documents and the full service timeline.
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
import { get as apiGet, post as apiPost, apiUpload, ApiError } from "@/lib/api/client";
import type { Asset, Customer, Site, Attachment } from "@/lib/api/types";
import type { AssetSpecification } from "@serviceos/contracts";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, EmptyState, DetailList, DetailItem, SectionCard, InlineError, StatCard } from "@/components/app/shared/primitives";
import { Field, TextInput, TextArea, EnumSelect, TagList } from "@/components/app/shared/form-fields";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import { ASSET_FAMILY_STYLE, ASSET_STATUS_STYLE, assetFamilyOptions } from "@/design-system/tokens";
import { useCan } from "@/lib/auth/store";
import { fmtDate, fmtDateTime, fmtBytes } from "@/lib/format";
import { href, navigate, goBack } from "@/lib/router";
import { ASSET_FAMILIES, ASSET_STATUSES, ASSET_DOCUMENT_TYPES, type AssetFamily, type AssetStatus } from "@serviceos/contracts";
import { Boxes, Plus, Search, QrCode, Upload, FileText, Download, History, ShieldCheck } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Registration form                                                    */
/* ------------------------------------------------------------------ */

const specNum = (label: string, min: number, max: number) =>
  z
    .string()
    .optional()
    .refine((v) => v === undefined || v === "" || (!Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= max), `${label}: enter a number between ${min} and ${max}`);

const assetSchema = z.object({
  siteId: z.string().uuid("Select the site where this asset is installed"),
  assetCode: z.string().regex(/^[A-Za-z0-9-]{2,24}$/, "2–24 letters, digits or dashes"),
  serialNumber: z.string().max(80).optional(),
  assetFamily: z.enum(ASSET_FAMILIES),
  manufacturer: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  commissioningDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
  // nameplate — electrical
  ratedVoltageV: specNum("Rated voltage", 1, 1000000),
  voltageClassKv: specNum("Voltage class", 0.1, 800),
  phaseCount: specNum("Phases", 1, 3),
  ratedCurrentA: specNum("Rated current", 1, 100000),
  shortCircuitWithstandKa: specNum("SC withstand", 1, 200),
  breakingCapacityKa: specNum("Breaking capacity", 1, 100),
  ratedFrequencyHz: specNum("Frequency", 10, 400),
  insulationMedium: z.string().max(40).optional(),
  // nameplate — construction
  ipRating: z.string().max(12).optional(),
  incomerType: z.string().max(40).optional(),
  busbarMaterial: z.string().max(20).optional(),
  outgoingFeederCount: specNum("Feeders", 0, 200),
});
type AssetForm = z.infer<typeof assetSchema>;

function buildSpecification(values: AssetForm): AssetSpecification | undefined {
  const num = (v?: string) => (v === undefined || v === "" ? undefined : Number(v));
  const electrical = {
    ratedVoltageV: num(values.ratedVoltageV),
    voltageClassKv: num(values.voltageClassKv),
    phaseCount: num(values.phaseCount),
    ratedCurrentA: num(values.ratedCurrentA),
    shortCircuitWithstandKa: num(values.shortCircuitWithstandKa),
    breakingCapacityKa: num(values.breakingCapacityKa),
    ratedFrequencyHz: num(values.ratedFrequencyHz),
    insulationMedium: values.insulationMedium || undefined,
  };
  const construction = {
    ipRating: values.ipRating || undefined,
    incomerType: values.incomerType || undefined,
    busbarMaterial: values.busbarMaterial || undefined,
    outgoingFeederCount: num(values.outgoingFeederCount),
  };
  const hasElectrical = Object.values(electrical).some((v) => v !== undefined);
  const hasConstruction = Object.values(construction).some((v) => v !== undefined);
  if (!hasElectrical && !hasConstruction) return undefined;
  const spec: AssetSpecification = { schemaVersion: 1 };
  if (hasElectrical) spec.electrical = electrical;
  if (hasConstruction) spec.construction = construction;
  return spec;
}

function isHighVoltage(family: AssetFamily): boolean {
  return family === "ht_switchgear" || family === "vcb_panel" || family === "rmu" || family === "transformer" || family === "busduct";
}

function CreateAssetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AssetForm>({
    resolver: zodResolver(assetSchema),
    defaultValues: { assetFamily: "lt_panel" },
  });
  const family = form.watch("assetFamily");

  const sites = useQuery({
    queryKey: ["sites", "options"],
    queryFn: () => apiGet<Site[]>("/api/v1/sites", { limit: 300 }),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: (values: AssetForm) =>
      apiPost<Asset>("/api/v1/assets", {
        siteId: values.siteId,
        assetCode: values.assetCode,
        serialNumber: values.serialNumber || undefined,
        assetFamily: values.assetFamily,
        manufacturer: values.manufacturer || undefined,
        model: values.model || undefined,
        commissioningDate: values.commissioningDate || undefined,
        specification: buildSpecification(values),
        notes: values.notes || undefined,
      }),
    onSuccess: (asset) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast({ title: "Asset registered", description: `${asset.assetCode} — ${asset.model ?? "no model recorded"}` });
      form.reset({ assetFamily: "lt_panel" });
      onOpenChange(false);
      navigate(`/assets/${asset.id}`);
    },
    onError: (err) => {
      const apiErr = err instanceof ApiError ? err : null;
      const codeError = apiErr?.fieldError("assetCode");
      if (codeError) form.setError("assetCode", { message: codeError });
      else setServerError(apiErr?.message ?? "Could not register the asset");
    },
  });

  const reset = () => { form.reset({ assetFamily: "lt_panel" }); setServerError(null); };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register asset</DialogTitle>
          <DialogDescription>Capture the nameplate now — warranty, PM scheduling and analytics all depend on it.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => { setServerError(null); create.mutate(v); })} noValidate>
          <Field label="Site" htmlFor="a-site" required error={form.formState.errors.siteId?.message}>
            <EnumSelect
              id="a-site"
              options={(sites.data ?? []).map((s) => ({ value: s.id, label: `${s.siteCode} — ${s.name} (${s.customer.legalName})` }))}
              value={form.watch("siteId")}
              onValueChange={(v) => form.setValue("siteId", v)}
              disabled={sites.isLoading}
              placeholder={sites.isLoading ? "Loading sites…" : "Select site…"}
              error={form.formState.errors.siteId?.message}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Asset code" htmlFor="a-code" required error={form.formState.errors.assetCode?.message} hint="Your internal tag, e.g. AST-000101">
              <TextInput id="a-code" placeholder="AST-000101" {...form.register("assetCode")} error={form.formState.errors.assetCode?.message} />
            </Field>
            <Field label="Serial number" htmlFor="a-serial" error={form.formState.errors.serialNumber?.message} hint="Nameplate serial">
              <TextInput id="a-serial" placeholder="AUR-LT-2024-0789" {...form.register("serialNumber")} />
            </Field>
            <Field label="Asset family" htmlFor="a-family" required>
              <EnumSelect id="a-family" options={assetFamilyOptions} value={family} onValueChange={(v) => form.setValue("assetFamily", v as AssetFamily)} />
            </Field>
            <Field label="Commissioning date" htmlFor="a-comm" error={form.formState.errors.commissioningDate?.message} hint="Warranty anchors to it">
              <TextInput id="a-comm" type="date" {...form.register("commissioningDate")} />
            </Field>
            <Field label="Manufacturer" htmlFor="a-manu" error={form.formState.errors.manufacturer?.message}>
              <TextInput id="a-manu" placeholder="Aurora Switchgear" {...form.register("manufacturer")} />
            </Field>
            <Field label="Model" htmlFor="a-model" error={form.formState.errors.model?.message}>
              <TextInput id="a-model" placeholder="ASG-415-LT-12F" {...form.register("model")} />
            </Field>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-3 text-sm font-semibold">Nameplate specification {isHighVoltage(family) ? "(HT fields shown)" : "(LT fields shown)"}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {isHighVoltage(family) ? (
                <>
                  <Field label="Voltage class (kV)" htmlFor="a-kv" error={form.formState.errors.voltageClassKv?.message}>
                    <TextInput id="a-kv" inputMode="decimal" placeholder="11" {...form.register("voltageClassKv")} error={form.formState.errors.voltageClassKv?.message} />
                  </Field>
                  <Field label="Breaking capacity (kA)" htmlFor="a-ka" error={form.formState.errors.breakingCapacityKa?.message}>
                    <TextInput id="a-ka" inputMode="decimal" placeholder="25" {...form.register("breakingCapacityKa")} error={form.formState.errors.breakingCapacityKa?.message} />
                  </Field>
                  <Field label="Insulation medium" htmlFor="a-insul" error={form.formState.errors.insulationMedium?.message}>
                    <TextInput id="a-insul" placeholder="vacuum / SF6 / air" {...form.register("insulationMedium")} />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Rated voltage (V)" htmlFor="a-v" error={form.formState.errors.ratedVoltageV?.message}>
                    <TextInput id="a-v" inputMode="decimal" placeholder="415" {...form.register("ratedVoltageV")} error={form.formState.errors.ratedVoltageV?.message} />
                  </Field>
                  <Field label="Phases" htmlFor="a-ph" error={form.formState.errors.phaseCount?.message}>
                    <TextInput id="a-ph" inputMode="numeric" placeholder="3" {...form.register("phaseCount")} error={form.formState.errors.phaseCount?.message} />
                  </Field>
                  <Field label="SC withstand (kA)" htmlFor="a-sc" error={form.formState.errors.shortCircuitWithstandKa?.message}>
                    <TextInput id="a-sc" inputMode="decimal" placeholder="35" {...form.register("shortCircuitWithstandKa")} error={form.formState.errors.shortCircuitWithstandKa?.message} />
                  </Field>
                </>
              )}
              <Field label="Rated current (A)" htmlFor="a-a" error={form.formState.errors.ratedCurrentA?.message}>
                <TextInput id="a-a" inputMode="decimal" placeholder="800" {...form.register("ratedCurrentA")} error={form.formState.errors.ratedCurrentA?.message} />
              </Field>
              <Field label="Frequency (Hz)" htmlFor="a-hz" error={form.formState.errors.ratedFrequencyHz?.message}>
                <TextInput id="a-hz" inputMode="numeric" placeholder="50" {...form.register("ratedFrequencyHz")} />
              </Field>
              <Field label="Outgoing feeders" htmlFor="a-feed" error={form.formState.errors.outgoingFeederCount?.message}>
                <TextInput id="a-feed" inputMode="numeric" placeholder="8" {...form.register("outgoingFeederCount")} />
              </Field>
              <Field label="IP rating" htmlFor="a-ip" error={form.formState.errors.ipRating?.message}>
                <TextInput id="a-ip" placeholder="IP43" {...form.register("ipRating")} />
              </Field>
              <Field label="Incomer type" htmlFor="a-inc" error={form.formState.errors.incomerType?.message}>
                <TextInput id="a-inc" placeholder="ACB / VCB / MCCB" {...form.register("incomerType")} />
              </Field>
              <Field label="Busbar material" htmlFor="a-bus" error={form.formState.errors.busbarMaterial?.message}>
                <TextInput id="a-bus" placeholder="copper / aluminium" {...form.register("busbarMaterial")} />
              </Field>
            </div>
          </div>

          <Field label="Notes" htmlFor="a-notes" error={form.formState.errors.notes?.message}>
            <TextArea id="a-notes" rows={2} placeholder="Special tools, firmware versions, customer-specific constraints…" {...form.register("notes")} />
          </Field>
          <InlineError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !form.watch("siteId")}>{create.isPending ? "Registering…" : "Register asset"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Document upload + link                                               */
/* ------------------------------------------------------------------ */

interface AssetDocumentRow {
  id: string;
  documentType: string;
  title: string;
  revision: string | null;
  notes: string | null;
  attachment: { id: string; originalName: string; contentType: string; sizeBytes: string; downloadUrl: string } | null;
  createdAt: string;
}

function LinkDocumentDialog({ assetId, open, onOpenChange }: { assetId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>("");
  const [title, setTitle] = useState("");
  const [revision, setRevision] = useState("");
  const [error, setError] = useState<string | null>(null);

  const link = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const attachment = await apiUpload<Attachment>("/api/v1/files", file, { ownerType: "asset", ownerId: assetId });
      return apiPost(`/api/v1/assets/${assetId}/documents`, {
        attachmentId: attachment.id,
        documentType: documentType || "other",
        title: title || file.name,
        revision: revision || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets", assetId] });
      toast({ title: "Document linked" });
      setFile(null); setTitle(""); setRevision(""); setDocumentType("");
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Upload failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach document</DialogTitle>
          <DialogDescription>Upload the file, then classify it (SLD, GA drawing, test certificate…).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="File" htmlFor="doc-file" required hint="PDF, PNG or JPEG · max 25 MB">
            <Input id="doc-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Document type" htmlFor="doc-type" required>
            <EnumSelect
              id="doc-type"
              options={ASSET_DOCUMENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }))}
              value={documentType}
              onValueChange={setDocumentType}
              placeholder="Select type…"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="doc-title" error={undefined}>
              <TextInput id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Panel GA — rev C" />
            </Field>
            <Field label="Revision" htmlFor="doc-rev">
              <TextInput id="doc-rev" value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="C" />
            </Field>
          </div>
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); link.mutate(); }} disabled={link.isPending || !file || !documentType}>
              <Upload className="mr-1.5 size-4" aria-hidden /> {link.isPending ? "Uploading…" : "Upload & link"}
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

interface AssetDetailResponse extends Asset {
  documents: AssetDocumentRow[];
  contractAssets: Array<{
    contractId: string;
    coverageType: string;
    contract: { id: string; contractNo: string; contractType: string; status: string; startDate: string; endDate: string };
  }>;
  _count: { requests: number; workOrders: number; measurements: number; plannedVisits: number };
  coverage: Array<{ contractId: string; contractNo: string; contractType: string; coverageType: string; startDate: string; endDate: string }>;
}

const timelineKindLabel: Record<string, string> = {
  request: "Service request",
  work_order: "Work order",
  planned_visit: "Planned visit",
  measurement: "Measurement",
  commissioning: "Commissioned",
};

function AssetDetail({ assetId }: { assetId: string }) {
  const canWrite = useCan()("assets:write");
  const [docOpen, setDocOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const detail = useQuery({
    queryKey: ["assets", assetId],
    queryFn: () => apiGet<AssetDetailResponse>(`/api/v1/assets/${assetId}`),
  });
  const timeline = useQuery({
    queryKey: ["assets", assetId, "timeline"],
    queryFn: () =>
      apiGet<Array<Record<string, unknown>>> (`/api/v1/assets/${assetId}/timeline`),
  });
  const qr = useQuery({
    queryKey: ["assets", assetId, "qr"],
    queryFn: () => apiGet<{ assetCode: string; url: string; qrSvg: string }>(`/api/v1/assets/${assetId}/qr`),
    enabled: qrOpen,
  });

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Loading asset…</p>;
  if (detail.isError || !detail.data)
    return <EmptyState title="Asset not found" action={<Button variant="outline" onClick={() => navigate("/assets")}>Back to assets</Button>} />;

  const a = detail.data;
  const spec = a.specification;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<a className="hover:underline" href={href("/assets")}>Assets</a>}
        title={`${a.assetCode}${a.serialNumber ? ` · ${a.serialNumber}` : ""}`}
        description={`${ASSET_FAMILY_STYLE[a.assetFamily].label} · ${a.manufacturer ?? "manufacturer n/a"} ${a.model ?? ""} · installed at ${a.site.name} (${a.site.customer.legalName})`}
        actions={
          <div className="flex items-center gap-2">
            {canWrite ? (
              <Button variant="outline" onClick={() => setQrOpen(true)}>
                <QrCode className="mr-1.5 size-4" aria-hidden /> QR nameplate
              </Button>
            ) : null}
            {canWrite ? (
              <Button onClick={() => setDocOpen(true)}>
                <Upload className="mr-1.5 size-4" aria-hidden /> Attach document
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => goBack("/assets")}>Back</Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Status" value={ASSET_STATUS_STYLE[a.status].label} icon={<ShieldCheck />} tone={a.status === "active" ? "success" : "neutral"} />
        <StatCard label="Service requests" value={a._count.requests} icon={<FileText />} />
        <StatCard label="Work orders" value={a._count.workOrders} icon={<History />} />
        <StatCard label="Planned visits" value={a._count.plannedVisits} icon={<Boxes />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Identity">
          <DetailList className="sm:grid-cols-2">
            <DetailItem label="Asset code"><span className="font-mono">{a.assetCode}</span></DetailItem>
            <DetailItem label="Serial number"><span className="font-mono">{a.serialNumber ?? "—"}</span></DetailItem>
            <DetailItem label="Family">{ASSET_FAMILY_STYLE[a.assetFamily].label}</DetailItem>
            <DetailItem label="Manufacturer / model">{[a.manufacturer, a.model].filter(Boolean).join(" ") || "—"}</DetailItem>
            <DetailItem label="Commissioned">{fmtDate(a.commissioningDate)}</DetailItem>
            <DetailItem label="Site">
              <a className="text-primary hover:underline" href={href(`/assets?siteId=${a.site.id}`)}>{a.site.siteCode}</a>
            </DetailItem>
          </DetailList>
          {a.notes ? <p className="mt-4 rounded-md bg-muted/60 p-3 text-sm">{a.notes}</p> : null}
        </SectionCard>

        <SectionCard title="Nameplate specification" description="Captured at registration; drives analytics and checklists.">
          {!spec ? (
            <EmptyState title="No nameplate data" description={canWrite ? "Edit the asset to add electrical and construction details." : "—"} />
          ) : (
            <div className="space-y-4">
              {spec.electrical ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Electrical</p>
                  <DetailList className="sm:grid-cols-2">
                    {Object.entries(spec.electrical).map(([k, v]) => (
                      <DetailItem key={k} label={k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}>
                        <span className="tabular-nums">{String(v)}</span>
                      </DetailItem>
                    ))}
                  </DetailList>
                </div>
              ) : null}
              {spec.construction ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Construction</p>
                  <DetailList className="sm:grid-cols-2">
                    {Object.entries(spec.construction).map(([k, v]) => (
                      <DetailItem key={k} label={k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}>
                        {String(v)}
                      </DetailItem>
                    ))}
                  </DetailList>
                </div>
              ) : null}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Warranty & AMC coverage" description="Entitlement is derived from linked contracts (ADR-007) — never stored as free text.">
        {!a.coverage?.length ? (
          <EmptyState title="Not under contract" description="No warranty, AMC or service contract currently covers this asset." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {a.coverage.map((cov) => (
              <a key={cov.contractId} href={href(`/contracts/${cov.contractId}`)} className="rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/50">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{cov.contractNo}</p>
                  <TextBadge tone={cov.contractType === "warranty" ? "info" : "success"}>{cov.contractType.toUpperCase()}</TextBadge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {cov.coverageType.replace(/_/g, " ")} · {fmtDate(cov.startDate)} → {fmtDate(cov.endDate)}
                </p>
              </a>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={`Documents (${a.documents?.length ?? 0})`}>
        {!a.documents?.length ? (
          <EmptyState title="No documents" description="Attach the single-line diagram, GA drawing, test certificates or manuals." />
        ) : (
          <ul className="divide-y rounded-lg border">
            {a.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.documentType.replace(/_/g, " ")}
                      {d.revision ? ` · rev ${d.revision}` : ""}
                      {d.attachment ? ` · ${fmtBytes(d.attachment.sizeBytes)}` : ""}
                    </p>
                  </div>
                </div>
                {d.attachment?.downloadUrl ? (
                  <a href={d.attachment.downloadUrl} className="shrink-0" aria-label={`Download ${d.title}`}>
                    <Button variant="outline" size="sm">
                      <Download className="mr-1 size-3.5" aria-hidden /> Download
                    </Button>
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Service timeline" description="Chronological history: requests, work orders, measurements and planned visits.">
        {!timeline.data?.length ? (
          <EmptyState title="No history yet" description="Service activity on this asset will appear here." />
        ) : (
          <ol className="relative space-y-4 border-l pl-5">
            {timeline.data.map((entry, idx) => {
              const kind = String(entry.kind);
              const occurredAt = String(entry.occurredAt ?? entry.createdAt ?? "");
              const title =
                entry.title ? String(entry.title) :
                entry.subject ? String(entry.subject) :
                entry.measurementKey ? `Measurement: ${entry.measurementKey}` :
                timelineKindLabel[kind] ?? kind;
              const meta = [
                entry.workOrderNo ? String(entry.workOrderNo) : null,
                entry.requestNo ? String(entry.requestNo) : null,
                entry.status ? `status: ${String(entry.status)}` : null,
                entry.measuredValue !== undefined ? `${entry.measuredValue} ${entry.unit ?? ""}` : null,
                entry.dueAt ? `due ${fmtDate(String(entry.dueAt))}` : null,
              ].filter(Boolean);
              return (
                <li key={`${kind}-${idx}`} className="relative">
                  <span className="absolute -left-[27px] top-1 size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">
                    {timelineKindLabel[kind] ?? kind} · {fmtDateTime(occurredAt)}
                    {meta.length ? ` · ${meta.join(" · ")}` : ""}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </SectionCard>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>QR nameplate — {a.assetCode}</DialogTitle>
            <DialogDescription>Print and fix to the panel. Scanning opens the asset service history.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {qr.isLoading ? (
              <p className="text-sm text-muted-foreground">Generating…</p>
            ) : qr.data ? (
              <>
                <div className="rounded-lg border bg-white p-4" dangerouslySetInnerHTML={{ __html: qr.data.qrSvg }} />
                <p className="break-all text-center text-xs text-muted-foreground">{qr.data.url}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    const blob = new Blob([qr.data!.qrSvg], { type: "image/svg+xml" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `${a.assetCode}-qr.svg`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="mr-1.5 size-4" aria-hidden /> Download SVG
                </Button>
              </>
            ) : (
              <InlineError message="QR could not be generated" />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {canWrite ? <LinkDocumentDialog assetId={assetId} open={docOpen} onOpenChange={setDocOpen} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List                                                                 */
/* ------------------------------------------------------------------ */

export function AssetsView({ assetId, presetSiteId }: { assetId?: string; presetSiteId?: string }) {
  const canWrite = useCan()("assets:write");
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState("");
  const [status, setStatus] = useState("");
  const [siteId, setSiteId] = useState(presetSiteId ?? "");
  const [createOpen, setCreateOpen] = useState(false);

  const assets = useQuery({
    queryKey: ["assets", { search, family, status, siteId }],
    queryFn: () =>
      apiGet<Asset[]>("/api/v1/assets", {
        search: search || undefined,
        family: family || undefined,
        status: status || undefined,
        siteId: siteId || undefined,
        limit: 300,
      }),
  });

  if (assetId) return <AssetDetail assetId={assetId} />;

  const columns: ColumnDef<Asset, unknown>[] = [
    { accessorKey: "assetCode", header: "Code", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>()}</span> },
    { accessorKey: "serialNumber", header: "Serial", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>() ?? "—"}</span> },
    {
      accessorKey: "assetFamily",
      header: "Family",
      cell: (i) => <StatusBadge style={ASSET_FAMILY_STYLE[i.getValue<AssetFamily>()]} />,
    },
    { accessorKey: "model", header: "Model", cell: (i) => i.getValue<string>() ?? <span className="text-muted-foreground">—</span> },
    {
      accessorKey: "site",
      header: "Site / customer",
      cell: (i) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{i.row.original.site.name}</p>
          <p className="truncate text-xs text-muted-foreground">{i.row.original.site.customer.legalName}</p>
        </div>
      ),
    },
    { accessorKey: "commissioningDate", header: "Commissioned", cell: (i) => <span className="text-muted-foreground">{fmtDate(i.getValue<string>())}</span> },
    { accessorKey: "status", header: "Status", cell: (i) => <StatusBadge style={ASSET_STATUS_STYLE[i.getValue<AssetStatus>()]} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asset register"
        description="Every panel, switchgear and transformer you are responsible for — the foundation of service history."
        actions={canWrite && <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Register asset</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search assets" placeholder="Search by code, serial or manufacturer…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <EnumSelect id="asset-filter-family" triggerClassName="w-40" options={[{ value: "", label: "All families" }, ...assetFamilyOptions]} value={family} onValueChange={setFamily} placeholder="All families" />
        <EnumSelect
          id="asset-filter-status"
          triggerClassName="w-40"
          options={[{ value: "", label: "All statuses" }, ...ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_STYLE[s].label }))]}
          value={status}
          onValueChange={setStatus}
          placeholder="All statuses"
        />
        {presetSiteId ? (
          <Button variant="ghost" size="sm" onClick={() => setSiteId("")}>
            Clear site filter
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={assets.data ?? []}
        loading={assets.isLoading}
        onRowClick={(row) => navigate(`/assets/${row.id}`)}
        rowNoun="assets"
        emptyTitle="No assets match"
        emptyDescription="Register assets to unlock contracts, PM and analytics."
        emptyAction={canWrite ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Register asset</Button> : undefined}
        ariaLabel="Assets"
      />

      {canWrite ? <CreateAssetDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </div>
  );
}
