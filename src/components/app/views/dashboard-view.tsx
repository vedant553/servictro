"use client";

/**
 * Service analytics dashboard — every figure is a live aggregate from
 * /api/v1/analytics (ADR-019: no fabricated metrics, ever).
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { get as apiGet } from "@/lib/api/client";
import type { AnalyticsOverview, AnalyticsServiceVolume } from "@/lib/api/types";
import { PageHeader, StatCard, SectionCard, EmptyState } from "@/components/app/shared/primitives";
import { fmtPercent, fmtNumber, fmtHours, fmtRelative } from "@/lib/format";
import { href } from "@/lib/router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ClipboardList, Wrench, ShieldAlert, Gauge, CalendarClock, FileSignature, Boxes, Inbox, ArrowRight, Users } from "lucide-react";

const chartTooltipProps = {
  contentStyle: { borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 },
} as const;

export function DashboardView() {
  const overview = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => apiGet<AnalyticsOverview>("/api/v1/analytics/overview"),
  });
  const service = useQuery({
    queryKey: ["analytics", "service"],
    queryFn: () => apiGet<AnalyticsServiceVolume>("/api/v1/analytics/service", { days: 30 }),
  });

  if (overview.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Loading live aggregates…" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="h-16 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        title="Analytics unavailable"
        description="The analytics service could not be reached. Retry, or check service health."
        action={
          <Button variant="outline" onClick={() => overview.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const o = overview.data;
  const volume = (service.data?.volume ?? []).map((d) => ({
    ...d,
    label: new Date(d.day).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service dashboard"
        description={`Live aggregates across your workspace — computed ${fmtRelative(o.generatedAt)}.`}
      />

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open requests"
          value={fmtNumber(o.requests.open)}
          hint={`${o.requests.newAwaitingTriage} new awaiting triage`}
          icon={<ClipboardList />}
        />
        <StatCard
          label="Open work orders"
          value={fmtNumber(o.workOrders.open)}
          hint={`${fmtNumber(o.workOrders.completedLast30Days)} completed in last 30 days`}
          icon={<Wrench />}
        />
        <StatCard
          label="Overdue work orders"
          value={fmtNumber(o.workOrders.overdue)}
          tone={o.workOrders.overdue > 0 ? "danger" : "success"}
          hint={o.workOrders.overdue > 0 ? "past resolution due" : "nothing past due"}
          icon={<ShieldAlert />}
        />
        <StatCard
          label="SLA attainment (30d)"
          value={fmtPercent(o.workOrders.slaAttainmentPercent)}
          tone={(o.workOrders.slaAttainmentPercent ?? 100) >= 90 ? "success" : "warning"}
          hint={`avg resolution ${fmtHours(o.workOrders.averageResolutionHours)}`}
          icon={<Gauge />}
        />
        <StatCard
          label="PM visits due (30d)"
          value={fmtNumber(o.maintenance.upcomingPm30Days)}
          icon={<CalendarClock />}
        />
        <StatCard
          label="Contracts expiring (90d)"
          value={fmtNumber(o.contracts.expiringWithin90Days)}
          tone={o.contracts.expiringWithin90Days > 0 ? "warning" : "neutral"}
          hint="renewal pipeline"
          icon={<FileSignature />}
        />
        <StatCard
          label="Assets in service"
          value={fmtNumber(o.assets.activeTotal)}
          hint={o.assets.mandatoryFieldsComplete != null ? `${fmtPercent(o.assets.mandatoryFieldsComplete)} nameplate-complete` : undefined}
          icon={<Boxes />}
        />
        <StatCard
          label="New awaiting triage"
          value={fmtNumber(o.requests.newAwaitingTriage)}
          tone={o.requests.newAwaitingTriage > 0 ? "warning" : "success"}
          icon={<Inbox />}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard
          title="Service volume — last 30 days"
          description="Requests received, work orders created and work orders closed per day."
          className="lg:col-span-3"
        >
          {volume.length === 0 ? (
            <EmptyState title="No activity in the window" description="Create service requests and work orders to populate this chart." />
          ) : (
            <div className="h-72" role="img" aria-label="Area chart of daily service volume over the last 30 days">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volume} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gRequests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gClosed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickMargin={8} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip {...chartTooltipProps} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="requests" name="Requests" stroke="var(--chart-1)" fill="url(#gRequests)" strokeWidth={2} />
                  <Area type="monotone" dataKey="closed" name="Closed WOs" stroke="var(--chart-2)" fill="url(#gClosed)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Technician workload"
          description="Open work orders currently assigned per technician."
          className="lg:col-span-2"
        >
          {!o.technicianWorkload?.length ? (
            <EmptyState title="No open assignments" description="Assign technicians to work orders to see workload distribution." />
          ) : (
            <div className="h-72" role="img" aria-label="Bar chart of open work orders per technician">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={o.technicianWorkload} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis type="category" dataKey="displayName" width={110} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="openJobs" name="Open jobs" fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Request status breakdown + quick links */}
      <div className="grid gap-4 lg:grid-cols-5">
        <SectionCard title="Requests by status" className="lg:col-span-2">
          <ul className="space-y-2">
            {Object.entries(o.requests.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <li key={status} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="capitalize">{status.replace(/_/g, " ")}</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </li>
              ))}
          </ul>
        </SectionCard>

        <SectionCard title="Jump to workflow" className="lg:col-span-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { path: "/requests", label: "Triage new requests", icon: Inbox },
              { path: "/work-orders", label: "Run work orders", icon: Wrench },
              { path: "/maintenance", label: "Generate PM visits", icon: CalendarClock },
              { path: "/contracts", label: "Work the renewal pipeline", icon: FileSignature },
              { path: "/assets", label: "Register an asset", icon: Boxes },
              { path: "/team", label: "Manage the team", icon: Users },
            ].map((q) => (
              <a
                key={q.path}
                href={href(q.path)}
                className="group flex items-center justify-between rounded-md border px-3 py-2.5 text-sm font-medium hover:border-primary/40 hover:bg-accent/60"
              >
                <span className="flex items-center gap-2">
                  <q.icon className="size-4 text-muted-foreground" aria-hidden />
                  {q.label}
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </a>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
