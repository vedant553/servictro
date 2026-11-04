"use client";

/**
 * Notifications centre + audit trail + tenant settings — the workspace views.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { get as apiGet, post as apiPost, patch as apiPatch, ApiError } from "@/lib/api/client";
import type { AppNotification, AuditEvent, Tenant } from "@/lib/api/types";
import { DataTable } from "@/components/app/shared/data-table";
import { PageHeader, SectionCard, EmptyState, DetailList, DetailItem, InlineError } from "@/components/app/shared/primitives";
import { Field, TextInput, EnumSelect } from "@/components/app/shared/form-fields";
import { TextBadge } from "@/components/app/shared/status-badge";
import { useAuth, useCan, useCurrentMembership } from "@/lib/auth/store";
import { fmtDateTime, fmtRelative, fmtDuration } from "@/lib/format";
import { href } from "@/lib/router";
import { Bell, CheckCheck, ScrollText, Settings, Save } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function NotificationsView() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState("");

  const notifications = useQuery({
    queryKey: ["notifications", "all", unreadOnly],
    queryFn: () => apiGet<AppNotification[]>("/api/v1/notifications", { limit: 100, unread: unreadOnly || undefined }),
  });

  const markAll = useMutation({
    mutationFn: () => apiPost("/api/v1/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="In-app alerts for assignments, SLA risk, PM generation and renewals."
        actions={
          <div className="flex items-center gap-2">
            <EnumSelect
              id="nt-filter"
              options={[
                { value: "", label: "All" },
                { value: "true", label: "Unread only" },
              ]}
              value={unreadOnly}
              onValueChange={setUnreadOnly}
            />
            <Button variant="outline" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              <CheckCheck className="mr-1.5 size-4" aria-hidden /> Mark all read
            </Button>
          </div>
        }
      />
      {notifications.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !notifications.data?.length ? (
        <EmptyState icon={<Bell />} title="No notifications" description="Alerts arrive as work progresses." />
      ) : (
        <ul className="space-y-2">
          {notifications.data.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg border p-4 ${!n.readAt ? "border-primary/30 bg-[color:var(--status-info-bg)]/40" : "bg-card"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{n.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                    {n.category.replace(/_/g, " ")} · {fmtRelative(n.createdAt)}
                  </p>
                </div>
                {!n.readAt ? (
                  <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                    Mark read
                  </Button>
                ) : null}
                {n.entityType === "work_order" && n.entityId ? (
                  <a href={href(`/work-orders/${n.entityId}`)}>
                    <Button size="sm" variant="outline">Open work order</Button>
                  </a>
                ) : n.entityType === "service_request" && n.entityId ? (
                  <a href={href(`/requests/${n.entityId}`)}>
                    <Button size="sm" variant="outline">Open request</Button>
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

const actionLabel = (action: string): string => action.replace(/\./g, " · ").replace(/_/g, " ");

export function AuditView() {
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");

  const audit = useQuery({
    queryKey: ["audit", { action, resourceType }],
    queryFn: () =>
      apiGet<AuditEvent[]>("/api/v1/audit-events", {
        action: action || undefined,
        resourceType: resourceType || undefined,
        limit: 100,
      }),
  });

  const columns: ColumnDef<AuditEvent, unknown>[] = [
    { accessorKey: "createdAt", header: "When", cell: (i) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(i.getValue<string>())}</span> },
    { accessorKey: "action", header: "Action", cell: (i) => <span className="font-mono text-xs font-medium">{i.getValue<string>()}</span> },
    { accessorKey: "resourceType", header: "Resource", cell: (i) => <TextBadge>{i.getValue<string>().replace(/_/g, " ")}</TextBadge> },
    {
      accessorKey: "metadata",
      header: "Detail",
      cell: (i) => {
        const meta = i.getValue<Record<string, unknown>>();
        const text = Object.entries(meta ?? {})
          .slice(0, 3)
          .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)}`)
          .join(" · ");
        return <span className="text-xs text-muted-foreground">{text || "—"}</span>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every privileged mutation: actor, resource, reason and request id — tamper-evident trail."
      />
      <div className="flex flex-wrap items-center gap-2">
        <EnumSelect
          id="aud-action"
          options={[
            { value: "", label: "All actions" },
            ...Array.from(new Set((audit.data ?? []).map((e) => e.action))).sort().map((a) => ({ value: a, label: actionLabel(a) })),
          ]}
          value={action}
          onValueChange={setAction}
          placeholder="All actions"
        />
        <EnumSelect
          id="aud-resource"
          options={[
            { value: "", label: "All resources" },
            ...Array.from(new Set((audit.data ?? []).map((e) => e.resourceType))).sort().map((r) => ({ value: r, label: r.replace(/_/g, " ") })),
          ]}
          value={resourceType}
          onValueChange={setResourceType}
          placeholder="All resources"
        />
      </div>
      <DataTable columns={columns} data={audit.data ?? []} loading={audit.isLoading} emptyTitle="No audit events match" ariaLabel="Audit events" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const TIMEZONE_OPTIONS = ["Asia/Kolkata", "UTC", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"].map((t) => ({ value: t, label: t }));
const LOCALE_OPTIONS = [
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
];
const CURRENCY_OPTIONS = ["INR", "USD", "EUR", "AED", "SGD"].map((c) => ({ value: c, label: c }));

export function SettingsView() {
  const { toast } = useToast();
  const refreshTenant = useAuth((s) => s.refreshTenant);
  const tenant = useAuth((s) => s.tenant);
  const membership = useCurrentMembership();
  const canManage = useCan()("tenant:manage");
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [locale, setLocale] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (tenant && loadedFor !== tenant.id) {
    setLoadedFor(tenant.id);
    setName(tenant.name);
    setLegalName(tenant.legalName ?? "");
    setTimezone(tenant.timezone);
    setLocale(tenant.locale);
    setCurrencyCode(tenant.currencyCode);
  }

  const save = useMutation({
    mutationFn: () =>
      apiPatch<Tenant>("/api/v1/tenants/current", {
        name,
        legalName: legalName || undefined,
        timezone,
        locale,
        currencyCode,
      }),
    onSuccess: () => {
      refreshTenant();
      toast({ title: "Workspace settings saved" });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Save failed"),
  });

  const sla = tenant?.settings?.slaResponseMinutes as Record<string, number> | undefined;
  const slaResolution = tenant?.settings?.slaResolutionMinutes as Record<string, number> | undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace settings"
        description={membership ? `${membership.tenantName} · your role: ${membership.role.replace(/_/g, " ")}` : undefined}
      />

      {!canManage ? (
        <EmptyState icon={<Settings />} title="Read-only" description="Only owners and admins can change workspace settings." />
      ) : (
        <SectionCard title="Organization" description="Names, timezone and money defaults used across the workspace.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Workspace name" htmlFor="set-name" required>
              <TextInput id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Legal name" htmlFor="set-legal">
              <TextInput id="set-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </Field>
            <Field label="Default timezone" htmlFor="set-tz" hint="Sites can override; analytics bucket by site timezone">
              <EnumSelect id="set-tz" options={TIMEZONE_OPTIONS} value={timezone} onValueChange={setTimezone} />
            </Field>
            <Field label="Locale" htmlFor="set-locale">
              <EnumSelect id="set-locale" options={LOCALE_OPTIONS} value={locale} onValueChange={setLocale} />
            </Field>
            <Field label="Currency" htmlFor="set-currency" hint="Applies to contract values">
              <EnumSelect id="set-currency" options={CURRENCY_OPTIONS} value={currencyCode} onValueChange={setCurrencyCode} />
            </Field>
          </div>
          <InlineError message={error} />
          <div className="mt-4">
            <Button onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending || !name || !timezone}>
              <Save className="mr-1.5 size-4" aria-hidden /> {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </SectionCard>
      )}

      <SectionCard title="SLA defaults" description="Snapshotted onto work orders at creation; contracts override these when set.">
        <DetailList>
          {(["critical", "high", "medium", "low"] as const).map((sev) => (
            <DetailItem key={sev} label={`${sev} response / resolution`}>
              {fmtDuration(sla?.[sev])} / {fmtDuration(slaResolution?.[sev])}
            </DetailItem>
          ))}
        </DetailList>
        <p className="mt-3 text-xs text-muted-foreground">
          Values are tenant settings (ADR gap #2) — validate targets with pilots before treating them as commitments.
        </p>
      </SectionCard>

      <SectionCard title="Environment" description="What this deployment includes and what it deliberately defers.">
        <DetailList>
          <DetailItem label="Plan">{tenant?.plan ?? "—"}</DetailItem>
          <DetailItem label="Tenant status">{tenant?.status ?? "—"}</DetailItem>
          <DetailItem label="Data isolation">PostgreSQL row-level security + tenant-scoped transactions</DetailItem>
          <DetailItem label="Email / WhatsApp">Not configured (ADR-011) — in-app notifications only</DetailItem>
          <DetailItem label="File storage">Local private storage (ADR-010) — S3 in production</DetailItem>
          <DetailItem label="Mobile client">Installable PWA (ADR-008) — native app post-pilot</DetailItem>
        </DetailList>
      </SectionCard>
    </div>
  );
}
