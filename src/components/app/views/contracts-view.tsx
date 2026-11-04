"use client";

/**
 * Contracts — warranty / AMC / service coverage (Workflow D).
 * Entitlement is defined here and flows into request coverage checks and
 * PM generation. Renewal pipeline surfaces contracts expiring within a
 * configurable window (default 90 days).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, patch as apiPatch, ApiError } from "@/lib/api/client";
import type { ServiceContract, Customer, Asset } from "@/lib/api/types";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, EmptyState, DetailList, DetailItem, SectionCard, InlineError, StatCard } from "@/components/app/shared/primitives";
import { Field, TextInput, TextArea, EnumSelect } from "@/components/app/shared/form-fields";
import { StatusBadge, TextBadge } from "@/components/app/shared/status-badge";
import { CONTRACT_TYPE_STYLE, CONTRACT_STATUS_STYLE, RENEWAL_STATUS_STYLE } from "@/design-system/tokens";
import { useCan } from "@/lib/auth/store";
import { fmtDate, fmtMoney, fmtDuration } from "@/lib/format";
import { href, navigate, goBack } from "@/lib/router";
import { CONTRACT_TYPES, COVERAGE_TYPES, RENEWAL_STATUSES, type ContractType, type CoverageType, type RenewalStatus } from "@serviceos/contracts";
import { FileSignature, Plus, RefreshCw, TrendingUp } from "lucide-react";

const contractTypeOptions = CONTRACT_TYPES.map((t) => ({ value: t, label: CONTRACT_TYPE_STYLE[t].label }));
const coverageTypeOptions = COVERAGE_TYPES.map((c) => ({ value: c, label: c.replace(/_/g, " ") }));
const renewalStatusOptions = RENEWAL_STATUSES.map((r) => ({ value: r, label: RENEWAL_STATUS_STYLE[r].label }));

interface AssetSelection {
  assetId: string;
  coverageType: CoverageType;
  includedVisits?: string;
}

function CreateContractDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [contractType, setContractType] = useState<ContractType>("amc");
  const [contractNo, setContractNo] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [amount, setAmount] = useState("");
  const [responseTarget, setResponseTarget] = useState("");
  const [resolutionTarget, setResolutionTarget] = useState("");
  const [includedVisits, setIncludedVisits] = useState("");
  const [terms, setTerms] = useState("");
  const [assetSel, setAssetSel] = useState<AssetSelection[]>([]);

  const customers = useQuery({ queryKey: ["customers", "options"], queryFn: () => apiGet<Customer[]>("/api/v1/customers", { limit: 200 }), enabled: open });
  const assets = useQuery({
    queryKey: ["assets", "options", customerId],
    queryFn: () => apiGet<Asset[]>("/api/v1/assets", { customerId, limit: 300 }),
    enabled: open && Boolean(customerId),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<ServiceContract>("/api/v1/service-contracts", {
        customerId,
        contractNo: contractNo || undefined,
        contractType,
        startDate,
        endDate,
        amountMinor: amount ? Math.round(Number(amount) * 100) : undefined,
        responseTargetMinutes: responseTarget ? Number(responseTarget) : undefined,
        resolutionTargetMinutes: resolutionTarget ? Number(resolutionTarget) : undefined,
        includedVisitsPerYear: includedVisits ? Number(includedVisits) : undefined,
        terms: terms || undefined,
        assets: assetSel.map((a) => ({
          assetId: a.assetId,
          coverageType: a.coverageType,
          includedVisits: a.includedVisits ? Number(a.includedVisits) : undefined,
        })),
      }),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      toast({ title: "Contract created", description: `${c.contractNo} covering ${assetSel.length} asset(s)` });
      onOpenChange(false);
      navigate(`/contracts/${c.id}`);
    },
    onError: (err) => {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? "Could not create the contract");
    },
  });

  const valid = customerId && startDate && endDate && assetSel.length > 0 && new Date(endDate) > new Date(startDate);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create contract</DialogTitle>
          <DialogDescription>Warranty, AMC or one-off service — must cover at least one asset to have effect.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="ct-customer" required>
              <EnumSelect
                id="ct-customer"
                options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.legalName }))}
                value={customerId}
                onValueChange={setCustomerId}
                placeholder={customers.isLoading ? "Loading…" : "Select customer…"}
              />
            </Field>
            <Field label="Contract type" htmlFor="ct-type" required>
              <EnumSelect id="ct-type" options={contractTypeOptions} value={contractType} onValueChange={(v) => setContractType(v as ContractType)} />
            </Field>
            <Field label="Contract no (optional)" htmlFor="ct-no" hint="Auto-numbered CTR-2026-… when blank">
              <TextInput id="ct-no" value={contractNo} onChange={(e) => setContractNo(e.target.value)} placeholder="AMC/2026/042" />
            </Field>
            <Field label="Annual value (₹)" htmlFor="ct-amount" hint="Stored as minor units with ISO currency">
              <TextInput id="ct-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="180000" />
            </Field>
            <Field label="Start date" htmlFor="ct-start" required>
              <TextInput id="ct-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="End date" htmlFor="ct-end" required>
              <TextInput id="ct-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="Response target (minutes)" htmlFor="ct-resp" hint="SLA clocks snapshot from this">
              <TextInput id="ct-resp" inputMode="numeric" value={responseTarget} onChange={(e) => setResponseTarget(e.target.value)} placeholder="240" />
            </Field>
            <Field label="Resolution target (minutes)" htmlFor="ct-reso">
              <TextInput id="ct-reso" inputMode="numeric" value={resolutionTarget} onChange={(e) => setResolutionTarget(e.target.value)} placeholder="2880" />
            </Field>
            <Field label="Included visits / year" htmlFor="ct-visits">
              <TextInput id="ct-visits" inputMode="numeric" value={includedVisits} onChange={(e) => setIncludedVisits(e.target.value)} placeholder="4" />
            </Field>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-2 text-sm font-semibold">Covered assets ({assetSel.length})</p>
            {assetSel.length ? (
              <ul className="mb-3 space-y-2">
                {assetSel.map((a, idx) => {
                  const asset = assets.data?.find((x) => x.id === a.assetId);
                  return (
                    <li key={a.assetId} className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {asset?.assetCode ?? a.assetId}
                        <span className="ml-1 text-xs text-muted-foreground">{asset?.model ?? ""}</span>
                      </span>
                      <div className="w-40">
                        <EnumSelect
                          id={`cov-${a.assetId}`}
                          options={coverageTypeOptions}
                          value={a.coverageType}
                          onValueChange={(v) => setAssetSel((prev) => prev.map((x, i) => (i === idx ? { ...x, coverageType: v as CoverageType } : x)))}
                        />
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setAssetSel((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remove asset">
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mb-3 text-xs text-muted-foreground">Select assets below — each gets its own coverage type.</p>
            )}
            <Field label="Add asset" htmlFor="ct-asset" error={undefined}>
              <EnumSelect
                id="ct-asset"
                options={(assets.data ?? [])
                  .filter((a) => !assetSel.some((s) => s.assetId === a.id))
                  .map((a) => ({ value: a.id, label: `${a.assetCode}${a.serialNumber ? ` · ${a.serialNumber}` : ""} — ${a.site.name}` }))}
                value=""
                onValueChange={(v) => {
                  if (v) setAssetSel((prev) => [...prev, { assetId: v, coverageType: "full" }]);
                }}
                disabled={!customerId}
                placeholder={customerId ? (assets.isLoading ? "Loading…" : "Select asset to add…") : "Pick a customer first"}
              />
            </Field>
          </div>

          <Field label="Terms (optional)" htmlFor="ct-terms">
            <TextArea id="ct-terms" rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Exclusions, response conditions, escalation matrix…" />
          </Field>
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); create.mutate(); }} disabled={create.isPending || !valid}>
              {create.isPending ? "Creating…" : "Create contract"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenewDialog({ contract, open, onOpenChange }: { contract: ServiceContract; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [amount, setAmount] = useState(contract.amountMinor ? String(Number(contract.amountMinor) / 100) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const renew = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/service-contracts/${contract.id}/renew`, {
        startDate,
        endDate,
        amountMinor: amount ? Math.round(Number(amount) * 100) : undefined,
        note: note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      toast({ title: "Contract renewed", description: `${contract.contractNo} extended to ${fmtDate(endDate)}` });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Renewal failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setError(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Renew {contract.contractNo}</DialogTitle>
          <DialogDescription>Creates a renewed successor contract; the old one is marked renewed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New start" htmlFor="rn-start" required>
              <TextInput id="rn-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="New end" htmlFor="rn-end" required>
              <TextInput id="rn-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Field label="New annual value (₹)" htmlFor="rn-amount">
            <TextInput id="rn-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Note (optional)" htmlFor="rn-note">
            <TextArea id="rn-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Negotiated 5% uplift; spares included…" />
          </Field>
          <InlineError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => { setError(null); renew.mutate(); }} disabled={renew.isPending || !startDate || !endDate}>
              <RefreshCw className="mr-1.5 size-4" aria-hidden /> {renew.isPending ? "Renewing…" : "Renew contract"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContractDetail({ contractId }: { contractId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan()("contracts:manage");
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewalStatus, setRenewalStatus] = useState("");

  const detail = useQuery({
    queryKey: ["contracts", contractId],
    queryFn: () => apiGet<ServiceContract>(`/api/v1/service-contracts/${contractId}`),
  });

  const updateRenewal = useMutation({
    mutationFn: (next: RenewalStatus) =>
      apiPatch(`/api/v1/service-contracts/${contractId}`, { renewalStatus: next, expectedVersion: detail.data?.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      toast({ title: "Renewal status updated" });
    },
    onError: (err) => toast({ title: "Update failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Loading contract…</p>;
  if (detail.isError || !detail.data)
    return <EmptyState title="Contract not found" action={<Button variant="outline" onClick={() => navigate("/contracts")}>Back</Button>} />;

  const c = detail.data;
  const expiringSoon = c.daysRemaining != null && c.daysRemaining <= 90 && c.daysRemaining >= 0;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<a className="hover:underline" href={href("/contracts")}>Contracts</a>}
        title={`${c.contractNo} — ${c.customer.legalName}`}
        description={`${CONTRACT_TYPE_STYLE[c.contractType].label} · ${fmtDate(c.startDate)} → ${fmtDate(c.endDate)}${c.daysRemaining != null ? ` · ${c.daysRemaining} days remaining` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {canManage && expiringSoon && c.status === "active" ? (
              <Button onClick={() => setRenewOpen(true)}>
                <RefreshCw className="mr-1.5 size-4" aria-hidden /> Renew
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => goBack("/contracts")}>Back</Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Status" value={CONTRACT_STATUS_STYLE[c.status].label} tone={c.status === "active" ? "success" : "neutral"} icon={<FileSignature />} />
        <StatCard label="Value" value={fmtMoney(c.amountMinor, c.currencyCode)} />
        <StatCard label="Days remaining" value={c.daysRemaining ?? "—"} tone={expiringSoon ? "warning" : "neutral"} />
        <StatCard label="Renewal" value={RENEWAL_STATUS_STYLE[c.renewalStatus].label} tone={c.renewalStatus === "due_soon" ? "warning" : c.renewalStatus === "renewed" ? "success" : "neutral"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Terms">
          <DetailList>
            <DetailItem label="Customer">{c.customer.legalName}</DetailItem>
            <DetailItem label="Type">{CONTRACT_TYPE_STYLE[c.contractType].label}</DetailItem>
            <DetailItem label="Window">{fmtDate(c.startDate)} → {fmtDate(c.endDate)}</DetailItem>
            <DetailItem label="Value">{fmtMoney(c.amountMinor, c.currencyCode)}</DetailItem>
            <DetailItem label="Response target">{c.responseTargetMinutes ? fmtDuration(c.responseTargetMinutes) : "—"}</DetailItem>
            <DetailItem label="Resolution target">{c.resolutionTargetMinutes ? fmtDuration(c.resolutionTargetMinutes) : "—"}</DetailItem>
            <DetailItem label="Included visits / year">{c.includedVisitsPerYear ?? "—"}</DetailItem>
          </DetailList>
          {c.terms ? <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-sm">{c.terms}</p> : null}
        </SectionCard>

        <SectionCard title={`Covered assets (${c.assets?.length ?? 0})`} description="Coverage type per asset; entitlement checks read exactly this.">
          {!c.assets?.length ? (
            <EmptyState title="No assets linked" description="This contract does not cover any equipment yet." />
          ) : (
            <ul className="divide-y rounded-lg border">
              {c.assets.map((a) => {
                const code = a.asset?.assetCode ?? a.assetCode ?? a.assetId ?? "—";
                const family = a.asset?.assetFamily ?? a.assetFamily;
                const assetId = a.asset?.id ?? a.assetId ?? a.id;
                return (
                  <li key={assetId ?? code}>
                    <a href={href(`/assets/${assetId}`)} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-medium">{code}</p>
                        <p className="text-xs text-muted-foreground">{family ? family.replace(/_/g, " ") : ""}{a.asset?.serialNumber ? ` · S/N ${a.asset.serialNumber}` : ""}</p>
                      </div>
                      <TextBadge tone={a.coverageType === "full" ? "success" : "info"}>{a.coverageType.replace(/_/g, " ")}</TextBadge>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {c.maintenancePlans?.length ? (
        <SectionCard title={`Linked PM plans (${c.maintenancePlans.length})`}>
          <ul className="divide-y rounded-lg border">
            {c.maintenancePlans.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{p.planCode}</p>
                </div>
                <TextBadge tone={p.status === "active" ? "success" : "neutral"}>{p.status}</TextBadge>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {canManage ? (
        <SectionCard title="Renewal tracking">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-56">
              <EnumSelect
                id="renewal-status"
                options={renewalStatusOptions}
                value={renewalStatus || c.renewalStatus}
                onValueChange={(v) => { setRenewalStatus(v); updateRenewal.mutate(v as RenewalStatus); }}
              />
            </div>
            <p className="text-sm text-muted-foreground">Track the pipeline: due soon → in progress → renewed / lost.</p>
          </div>
          {c.renewalNotes ? <p className="mt-3 rounded-md bg-muted/60 p-3 text-sm">{c.renewalNotes}</p> : null}
        </SectionCard>
      ) : null}

      {canManage ? <RenewDialog contract={c} open={renewOpen} onOpenChange={setRenewOpen} /> : null}
    </div>
  );
}

export function ContractsView({ contractId }: { contractId?: string }) {
  const canManage = useCan()("contracts:manage");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [renewalStatus, setRenewalStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const contracts = useQuery({
    queryKey: ["contracts", { type, status, renewalStatus }],
    queryFn: () =>
      apiGet<ServiceContract[]>("/api/v1/service-contracts", {
        type: type || undefined,
        status: status || undefined,
        renewalStatus: renewalStatus || undefined,
        limit: 200,
      }),
  });
  const renewals = useQuery({
    queryKey: ["contracts", "renewals"],
    queryFn: () => apiGet<ServiceContract[]>("/api/v1/service-contracts/renewals", { days: 90 }),
  });

  if (contractId) return <ContractDetail contractId={contractId} />;

  const columns: ColumnDef<ServiceContract, unknown>[] = [
    { accessorKey: "contractNo", header: "Contract", cell: (i) => <span className="font-mono text-xs">{i.getValue<string>()}</span> },
    { accessorKey: "customer.legalName", header: "Customer", cell: (i) => <span className="font-medium">{i.row.original.customer.legalName}</span> },
    { accessorKey: "contractType", header: "Type", cell: (i) => <StatusBadge style={CONTRACT_TYPE_STYLE[i.getValue<ContractType>()]} /> },
    { accessorKey: "status", header: "Status", cell: (i) => <StatusBadge style={CONTRACT_STATUS_STYLE[i.row.original.status]} /> },
    { accessorKey: "renewalStatus", header: "Renewal", cell: (i) => <StatusBadge style={RENEWAL_STATUS_STYLE[i.row.original.renewalStatus]} /> },
    { accessorKey: "endDate", header: "Ends", cell: (i) => <span className="text-muted-foreground">{fmtDate(i.getValue<string>())}</span> },
    {
      accessorKey: "amountMinor",
      header: "Value",
      cell: (i) => <span className="tabular-nums">{fmtMoney(i.getValue<string>(), i.row.original.currencyCode)}</span>,
    },
  ];

  const pipeline = renewals.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="Warranty, AMC and service coverage — the entitlement engine for requests, SLAs and preventive maintenance."
        actions={canManage && <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Create contract</Button>}
      />

      {/* Renewal pipeline */}
      <SectionCard
        title={`Renewal pipeline — next 90 days (${pipeline.length})`}
        description="Revenue at risk: active contracts expiring soon without a recorded renewal."
      >
        {!pipeline.length ? (
          <EmptyState title="Nothing expiring in 90 days" description="The renewal pipeline is clear." />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {pipeline.map((c) => (
              <li key={c.id}>
                <a href={href(`/contracts/${c.id}`)} className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/50">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.contractNo} · {c.customer.legalName}</p>
                    <p className="text-xs text-muted-foreground">
                      {CONTRACT_TYPE_STYLE[c.contractType].label} · ends {fmtDate(c.endDate)}
                      {c.daysRemaining != null ? ` (${c.daysRemaining} d)` : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">{fmtMoney(c.amountMinor, c.currencyCode)}</span>
                    <TrendingUp className="size-4 text-[color:var(--status-warning)]" aria-hidden />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="flex flex-wrap items-center gap-2">
        <EnumSelect id="cf-type" triggerClassName="w-36" options={[{ value: "", label: "All types" }, ...contractTypeOptions]} value={type} onValueChange={setType} placeholder="All types" />
        <EnumSelect
          id="cf-status"
          triggerClassName="w-36"
          options={[
            { value: "", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "active", label: "Active" },
            { value: "expired", label: "Expired" },
            { value: "terminated", label: "Terminated" },
            { value: "renewed", label: "Renewed" },
          ]}
          value={status}
          onValueChange={setStatus}
          placeholder="All statuses"
        />
        <EnumSelect id="cf-renewal" triggerClassName="w-40" options={[{ value: "", label: "All renewal states" }, ...renewalStatusOptions]} value={renewalStatus} onValueChange={setRenewalStatus} placeholder="All renewal states" />
      </div>

      <DataTable
        columns={columns}
        data={contracts.data ?? []}
        loading={contracts.isLoading}
        onRowClick={(row) => navigate(`/contracts/${row.id}`)}
        rowNoun="contracts"
        emptyTitle="No contracts match"
        emptyDescription="Create warranty and AMC contracts to drive coverage and PM."
        emptyAction={canManage ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden />Create contract</Button> : undefined}
        ariaLabel="Contracts"
      />

      {canManage ? <CreateContractDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </div>
  );
}
