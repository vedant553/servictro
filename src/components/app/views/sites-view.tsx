"use client";

/**
 * Sites view: physical locations where installed equipment operates.
 * Create requires an existing customer; access instructions and timezone
 * are captured up-front because technicians depend on them in the field.
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
import type { Customer, Site } from "@/lib/api/types";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader } from "@/components/app/shared/primitives";
import { Field, TextInput, TextArea, EnumSelect } from "@/components/app/shared/form-fields";
import { StatusBadge } from "@/components/app/shared/status-badge";
import { useCan } from "@/lib/auth/store";
import { fmtAddress } from "@/lib/format";
import { navigate } from "@/lib/router";
import { SITE_STATUSES } from "@serviceos/contracts";
import { MapPin, Plus, Search } from "lucide-react";

const siteSchema = z.object({
  customerId: z.string().uuid("Select the customer this site belongs to"),
  siteCode: z.string().regex(/^[A-Za-z0-9-]{2,24}$/, "2–24 letters, digits or dashes (e.g. SHAKTI-PUNE-01)"),
  name: z.string().min(2, "Site name is required").max(120),
  line1: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  postalCode: z.string().max(20).optional(),
  timezone: z.string().min(1),
  accessInstructions: z.string().max(1000).optional(),
});
type SiteForm = z.infer<typeof siteSchema>;

const TIMEZONES = [
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
  { value: "UTC", label: "UTC" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT)" },
  { value: "Europe/London", label: "Europe/London (BST/GMT)" },
  { value: "America/New_York", label: "America/New_York (ET)" },
];

function CreateSiteDialog({ open, onOpenChange, presetCustomerId }: { open: boolean; onOpenChange: (v: boolean) => void; presetCustomerId?: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SiteForm>({
    resolver: zodResolver(siteSchema),
    defaultValues: { timezone: "Asia/Kolkata", customerId: presetCustomerId },
  });

  const customers = useQuery({
    queryKey: ["customers", "options"],
    queryFn: () => apiGet<Customer[]>("/api/v1/customers", { limit: 200 }),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: (values: SiteForm) =>
      apiPost<Site>("/api/v1/sites", {
        customerId: values.customerId,
        siteCode: values.siteCode,
        name: values.name,
        address:
          values.line1 || values.city || values.state || values.postalCode
            ? { line1: values.line1 || undefined, city: values.city || undefined, state: values.state || undefined, postalCode: values.postalCode || undefined, country: "IN" }
            : undefined,
        timezone: values.timezone,
        accessInstructions: values.accessInstructions || undefined,
      }),
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      toast({ title: "Site created", description: `${site.name} (${site.siteCode})` });
      form.reset({ timezone: "Asia/Kolkata", customerId: presetCustomerId });
      onOpenChange(false);
    },
    onError: (err) => {
      const apiErr = err instanceof ApiError ? err : null;
      const siteCodeError = apiErr?.fieldError("siteCode");
      if (siteCodeError) form.setError("siteCode", { message: siteCodeError });
      else setServerError(apiErr?.message ?? "Could not create the site");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { form.reset({ timezone: "Asia/Kolkata", customerId: presetCustomerId }); setServerError(null); } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add site</DialogTitle>
          <DialogDescription>A physical location (plant, building, panel room) belonging to a customer.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => { setServerError(null); create.mutate(v); })} noValidate>
          <Field label="Customer" htmlFor="s-customer" required error={form.formState.errors.customerId?.message}>
            <EnumSelect
              id="s-customer"
              options={(customers.data ?? []).map((c) => ({ value: c.id, label: `${c.legalName} (${c.accountCode})` }))}
              value={form.watch("customerId")}
              onValueChange={(v) => form.setValue("customerId", v)}
              disabled={Boolean(presetCustomerId) || customers.isLoading}
              placeholder={customers.isLoading ? "Loading customers…" : "Select customer…"}
              error={form.formState.errors.customerId?.message}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site code" htmlFor="s-code" required error={form.formState.errors.siteCode?.message} hint="Shown on work orders">
              <TextInput id="s-code" placeholder="SHAKTI-PUNE-01" {...form.register("siteCode")} error={form.formState.errors.siteCode?.message} />
            </Field>
            <Field label="Site name" htmlFor="s-name" required error={form.formState.errors.name?.message}>
              <TextInput id="s-name" placeholder="Bhosari Plant — Panel Room 2" {...form.register("name")} error={form.formState.errors.name?.message} />
            </Field>
            <Field label="Address line" htmlFor="s-line1" error={form.formState.errors.line1?.message} className="sm:col-span-2">
              <TextInput id="s-line1" placeholder="Plot 14, MIDC Bhosari" {...form.register("line1")} />
            </Field>
            <Field label="City" htmlFor="s-city" error={form.formState.errors.city?.message}>
              <TextInput id="s-city" placeholder="Pune" {...form.register("city")} />
            </Field>
            <Field label="State" htmlFor="s-state" error={form.formState.errors.state?.message}>
              <TextInput id="s-state" placeholder="Maharashtra" {...form.register("state")} />
            </Field>
            <Field label="Postal code" htmlFor="s-postal" error={form.formState.errors.postalCode?.message}>
              <TextInput id="s-postal" placeholder="411026" {...form.register("postalCode")} />
            </Field>
            <Field label="Timezone" htmlFor="s-tz" required error={form.formState.errors.timezone?.message} hint="Visit scheduling uses it">
              <EnumSelect id="s-tz" options={TIMEZONES} value={form.watch("timezone")} onValueChange={(v) => form.setValue("timezone", v)} error={form.formState.errors.timezone?.message} />
            </Field>
          </div>
          <Field label="Access instructions" htmlFor="s-access" error={form.formState.errors.accessInstructions?.message} hint="Gate, PPE and escort requirements technicians must know">
            <TextArea id="s-access" rows={2} placeholder="Enter via Gate 3. PPE mandatory. Escort required beyond crusher area." {...form.register("accessInstructions")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !form.watch("customerId")}>{create.isPending ? "Creating…" : "Create site"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SitesView({ customerId }: { customerId?: string }) {
  const canWrite = useCan()("sites:write");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const sites = useQuery({
    queryKey: ["sites", { search, status, customerId }],
    queryFn: () =>
      apiGet<Site[]>("/api/v1/sites", {
        search: search || undefined,
        status: status || undefined,
        customerId: customerId || undefined,
        limit: 200,
      }),
  });

  const columns: ColumnDef<Site, unknown>[] = [
    { accessorKey: "siteCode", header: "Code", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>()}</span> },
    { accessorKey: "name", header: "Site", cell: (i) => <span className="font-medium">{i.getValue<string>()}</span> },
    { accessorKey: "customer.legalName", header: "Customer", cell: (i) => i.row.original.customer.legalName },
    { accessorKey: "address", header: "Location", cell: (i) => <span className="text-muted-foreground">{fmtAddress(i.row.original.address)}</span> },
    { accessorKey: "timezone", header: "Timezone", cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue<string>()}</span> },
    { accessorKey: "status", header: "Status", cell: (i) => <StatusBadge style={{ label: i.getValue<string>() === "active" ? "Active" : "Inactive", tone: i.getValue<string>() === "active" ? "success" : "warning" }} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sites"
        description="Customer locations where installed equipment operates — the field teams' destination."
        actions={canWrite && <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Add site</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search sites" placeholder="Search by site name or code…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <EnumSelect
          id="site-filter-status"
          options={[{ value: "", label: "All statuses" }, ...SITE_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]}
          value={status}
          onValueChange={setStatus}
          placeholder="All statuses"
        />
      </div>

      <DataTable
        columns={columns}
        data={sites.data ?? []}
        loading={sites.isLoading}
        onRowClick={(row) => navigate(`/assets?siteId=${row.id}`)}
        emptyTitle="No sites match"
        emptyDescription="Add a site under a customer, then register assets into it."
        emptyAction={canWrite ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Add site</Button> : undefined}
        ariaLabel="Sites"
      />

      {canWrite ? <CreateSiteDialog open={createOpen} onOpenChange={setCreateOpen} presetCustomerId={customerId} /> : null}
    </div>
  );
}
