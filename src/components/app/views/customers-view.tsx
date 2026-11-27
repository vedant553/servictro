"use client";

/**
 * Customers view: register search/filter, create with duplicate warning
 * (Blueprint CRM-01), and a detail screen with contacts management.
 */
import { Input } from "@/components/ui/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, ApiError } from "@/lib/api/client";
import type { Customer, CustomerContact } from "@/lib/api/types";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, EmptyState, DetailList, DetailItem, SectionCard, InlineError } from "@/components/app/shared/primitives";
import { Field, TextInput, TextArea, EnumSelect } from "@/components/app/shared/form-fields";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import { useCan } from "@/lib/auth/store";
import { fmtDate, fmtAddress } from "@/lib/format";
import { href, navigate, goBack } from "@/lib/router";
import { Building2, Plus, Search, UserPlus, Trash2, AlertTriangle } from "lucide-react";
import { CUSTOMER_STATUSES, type CustomerStatus } from "@serviceos/contracts";

const customerSchema = z.object({
  legalName: z.string().min(3, "Legal name is required (min 3 characters)").max(160),
  segment: z.string().max(60).optional(),
  billingLine1: z.string().max(200).optional(),
  billingCity: z.string().max(80).optional(),
  billingState: z.string().max(80).optional(),
  billingPostalCode: z.string().max(20).optional(),
  notes: z.string().max(2000).optional(),
});
type CustomerForm = z.infer<typeof customerSchema>;

const contactSchema = z.object({
  name: z.string().min(2, "Contact name is required").max(120),
  role: z.string().max(80).optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});
type ContactForm = z.infer<typeof contactSchema>;

function CreateCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CustomerForm>({
    resolver: zodResolver(customerSchema),
    defaultValues: {},
  });
  const legalName = form.watch("legalName");

  const dupeCheck = useQuery({
    queryKey: ["customers", "duplicates", legalName],
    queryFn: () =>
      apiGet<Array<{ id: string; legalName: string; accountCode: string }>>("/api/v1/customers/duplicates", { legalName }),
    enabled: open && (legalName?.length ?? 0) >= 3,
  });
  const dupes = dupeCheck.data ?? [];

  const create = useMutation({
    mutationFn: (values: CustomerForm) =>
      apiPost<Customer>("/api/v1/customers", {
        legalName: values.legalName,
        segment: values.segment || undefined,
        notes: values.notes || undefined,
        billingAddress:
          values.billingLine1 || values.billingCity || values.billingState || values.billingPostalCode
            ? {
                line1: values.billingLine1 || undefined,
                city: values.billingCity || undefined,
                state: values.billingState || undefined,
                postalCode: values.billingPostalCode || undefined,
                country: "IN",
              }
            : undefined,
      }),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: "Customer created", description: `${customer.legalName} (${customer.accountCode})` });
      form.reset();
      onOpenChange(false);
      navigate(`/customers/${customer.id}`);
    },
    onError: (err) => setServerError(err instanceof ApiError ? err.message : "Could not create the customer"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { form.reset(); setServerError(null); } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Register customer</DialogTitle>
          <DialogDescription>Create the buying organization. Sites and assets attach to it next.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => { setServerError(null); create.mutate(values); })}
          noValidate
        >
          <Field label="Legal name" htmlFor="c-legalName" required error={form.formState.errors.legalName?.message}>
            <TextInput id="c-legalName" placeholder="Shakti Cement Industries Ltd." {...form.register("legalName")} error={form.formState.errors.legalName?.message} />
          </Field>

          {dupes.length > 0 ? (
            <div role="alert" className="flex gap-2 rounded-md border border-[color:var(--status-warning)]/40 bg-[color:var(--status-warning-bg)] p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[color:var(--status-warning)]" aria-hidden />
              <div>
                <p className="font-medium">Possible duplicates found</p>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {dupes.map((d) => (
                    <li key={d.id}>
                      {d.legalName} ({d.accountCode})
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">Continue only if this is a genuinely different organization.</p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Segment" htmlFor="c-segment" error={form.formState.errors.segment?.message} hint="e.g. Cement, Textiles, Pharma">
              <TextInput id="c-segment" placeholder="Cement" {...form.register("segment")} />
            </Field>
            <Field label="Billing city" htmlFor="c-city" error={form.formState.errors.billingCity?.message}>
              <TextInput id="c-city" placeholder="Pune" {...form.register("billingCity")} />
            </Field>
            <Field label="Billing address" htmlFor="c-line1" error={form.formState.errors.billingLine1?.message} className="sm:col-span-2">
              <TextInput id="c-line1" placeholder="Plot 14, MIDC Bhosari" {...form.register("billingLine1")} />
            </Field>
            <Field label="State" htmlFor="c-state" error={form.formState.errors.billingState?.message}>
              <TextInput id="c-state" placeholder="Maharashtra" {...form.register("billingState")} />
            </Field>
            <Field label="Postal code" htmlFor="c-postal" error={form.formState.errors.billingPostalCode?.message}>
              <TextInput id="c-postal" placeholder="411026" {...form.register("billingPostalCode")} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="c-notes" error={form.formState.errors.notes?.message}>
            <TextArea id="c-notes" rows={2} placeholder="Key account context…" {...form.register("notes")} />
          </Field>
          <InlineError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddContactDialog({ customerId, open, onOpenChange }: { customerId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ContactForm>({ resolver: zodResolver(contactSchema), defaultValues: { isPrimary: false } });

  const add = useMutation({
    mutationFn: (values: ContactForm) =>
      apiPost(`/api/v1/customers/${customerId}/contacts`, {
        name: values.name,
        role: values.role || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
        isPrimary: values.isPrimary ?? false,
        notes: values.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", customerId] });
      toast({ title: "Contact added" });
      form.reset();
      onOpenChange(false);
    },
    onError: (err) => setServerError(err instanceof ApiError ? err.message : "Could not add the contact"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) form.reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
          <DialogDescription>Person to call for service coordination at this customer.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => { setServerError(null); add.mutate(v); })} noValidate>
          <Field label="Name" htmlFor="ct-name" required error={form.formState.errors.name?.message}>
            <TextInput id="ct-name" placeholder="R. Deshmukh" {...form.register("name")} error={form.formState.errors.name?.message} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" htmlFor="ct-role" error={form.formState.errors.role?.message}>
              <TextInput id="ct-role" placeholder="Maintenance manager" {...form.register("role")} />
            </Field>
            <Field label="Phone" htmlFor="ct-phone" error={form.formState.errors.phone?.message}>
              <TextInput id="ct-phone" placeholder="+91 98xx xxxxxx" {...form.register("phone")} />
            </Field>
          </div>
          <Field label="Email" htmlFor="ct-email" error={form.formState.errors.email?.message}>
            <TextInput id="ct-email" type="email" placeholder="name@customer.com" {...form.register("email")} error={form.formState.errors.email?.message} />
          </Field>
          <Field label="Notes" htmlFor="ct-notes" error={form.formState.errors.notes?.message}>
            <TextArea id="ct-notes" rows={2} placeholder="Prefers WhatsApp; available after 14:00…" {...form.register("notes")} />
          </Field>
          <InlineError message={serverError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={add.isPending}>{add.isPending ? "Adding…" : "Add contact"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDetail({ customerId }: { customerId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = useCan()("customers:write");
  const [contactOpen, setContactOpen] = useState(false);
  const [status, setStatus] = useState<CustomerStatus | "">("");

  const detail = useQuery({
    queryKey: ["customers", customerId],
    queryFn: () => apiGet<Customer & { contacts: CustomerContact[] }>(`/api/v1/customers/${customerId}`),
  });

  const updateStatus = useMutation({
    mutationFn: (next: CustomerStatus) => {
      const current = detail.data;
      if (!current) throw new Error("Not loaded");
      return import("@/lib/api/client").then(({ patch }) =>
        patch<Customer>(`/api/v1/customers/${customerId}`, { status: next, expectedVersion: current.version }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: "Customer updated" });
    },
    onError: (err) => toast({ title: "Update failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  const removeContact = useMutation({
    mutationFn: (contactId: string) => import("@/lib/api/client").then(({ del }) => del(`/api/v1/customers/${customerId}/contacts/${contactId}`)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", customerId] });
      toast({ title: "Contact removed" });
    },
    onError: (err) => toast({ title: "Remove failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Loading customer…</p>;
  if (detail.isError || !detail.data)
    return <EmptyState title="Customer not found" description="It may have been removed, or you lack access." action={<Button variant="outline" onClick={() => navigate("/customers")}>Back to customers</Button>} />;

  const c = detail.data;
  const contacts = (c as { contacts?: CustomerContact[] }).contacts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <a className="hover:underline" href={href("/customers")}>
            Customers
          </a>
        }
        title={c.legalName}
        description={`${c.accountCode} · registered ${fmtDate(c.createdAt)}`}
        actions={
          canWrite && (
            <div className="flex items-center gap-2">
              <EnumSelect
                id="cust-status"
                options={(CUSTOMER_STATUSES as readonly string[]).map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
                value={status || c.status}
                onValueChange={(v) => { setStatus(v as CustomerStatus); updateStatus.mutate(v as CustomerStatus); }}
              />
              <Button variant="outline" onClick={() => goBack("/customers")}>Back</Button>
            </div>
          )
        }
      />

      <SectionCard title="Account">
        <DetailList>
          <DetailItem label="Account code">{c.accountCode}</DetailItem>
          <DetailItem label="Status">{c.status}</DetailItem>
          <DetailItem label="Segment">{c.segment ?? "—"}</DetailItem>
          <DetailItem label="Billing address">{fmtAddress(c.billingAddress ?? null)}</DetailItem>
          <DetailItem label="Sites">{c.siteCount}</DetailItem>
          <DetailItem label="Contracts">{c.contractCount}</DetailItem>
        </DetailList>
        {c.notes ? <p className="mt-4 rounded-md bg-muted/60 p-3 text-sm">{c.notes}</p> : null}
      </SectionCard>

      <SectionCard
        title={`Contacts (${contacts.length})`}
        actions={
          canWrite && (
            <Button size="sm" onClick={() => setContactOpen(true)}>
              <UserPlus className="mr-1.5 size-4" aria-hidden /> Add contact
            </Button>
          )
        }
      >
        {!contacts.length ? (
          <EmptyState title="No contacts yet" description="Add at least one service coordination contact." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {contacts.map((ct) => (
              <div key={ct.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {ct.name}
                      {ct.isPrimary ? <TextBadge tone="info">Primary</TextBadge> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">{ct.role ?? "—"}</p>
                  </div>
                  {canWrite && (
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-[color:var(--status-danger)]" aria-label={`Remove ${ct.name}`} onClick={() => removeContact.mutate(ct.id)}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
                <p className="mt-2 break-words text-sm">{ct.email ?? "—"} · {ct.phone ?? "—"}</p>
                {ct.notes ? <p className="mt-1 text-xs text-muted-foreground">{ct.notes}</p> : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {canWrite ? <AddContactDialog customerId={customerId} open={contactOpen} onOpenChange={setContactOpen} /> : null}
    </div>
  );
}

export function CustomersView({ customerId }: { customerId?: string }) {
  const canWrite = useCan()("customers:write");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);

  const customers = useQuery({
    queryKey: ["customers", { search, status }],
    queryFn: () => apiGet<Customer[]>("/api/v1/customers", { search: search || undefined, status: status || undefined, limit: 100 }),
  });

  if (customerId) return <CustomerDetail customerId={customerId} />;

  const columns: ColumnDef<Customer, unknown>[] = [
    { accessorKey: "accountCode", header: "Code", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>()}</span> },
    {
      accessorKey: "legalName",
      header: "Customer",
      cell: (i) => <span className="font-medium">{i.getValue<string>()}</span>,
    },
    { accessorKey: "segment", header: "Segment", cell: (i) => i.getValue<string>() ?? <span className="text-muted-foreground">—</span> },
    { accessorKey: "status", header: "Status", cell: (i) => <StatusBadge style={{ label: i.getValue<string>(), tone: i.getValue<string>() === "active" ? "success" : i.getValue<string>() === "archived" ? "neutral" : "warning" }} /> },
    { accessorKey: "siteCount", header: "Sites", cell: (i) => <span className="tabular-nums">{i.getValue<number>()}</span> },
    { accessorKey: "contractCount", header: "Contracts", cell: (i) => <span className="tabular-nums">{i.getValue<number>()}</span> },
    { accessorKey: "createdAt", header: "Registered", cell: (i) => <span className="text-muted-foreground">{fmtDate(i.getValue<string>())}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Buying organizations with installed equipment. One record per legal entity."
        actions={
          canWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Register customer
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Search customers"
            placeholder="Search by name or account code…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <EnumSelect
          id="cust-filter-status"
          triggerClassName="w-40"
          options={[{ value: "", label: "All statuses" }, ...CUSTOMER_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]}
          value={status}
          onValueChange={setStatus}
          placeholder="All statuses"
        />
      </div>

      <DataTable
        columns={columns}
        data={customers.data ?? []}
        loading={customers.isLoading}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        rowNoun="customers"
        emptyTitle="No customers match"
        emptyDescription={search ? "Try a different search or clear filters." : "Register your first customer to start building the installed base."}
        emptyAction={canWrite ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Register customer</Button> : undefined}
        ariaLabel="Customers"
      />

      {canWrite ? <CreateCustomerDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </div>
  );
}
