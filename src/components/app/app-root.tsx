"use client";

/**
 * ServiceOS console root: auth lifecycle + hash router → view registry.
 * One user-visible route ("/") per the deployment sandbox; navigation is
 * hash-based (see src/lib/router.ts). The page entry loads this module with
 * ssr:false because auth state (localStorage, cookies) is client-only.
 */
import { useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth, useCan } from "@/lib/auth/store";
import { useHashRoute, navigate } from "@/lib/router";
import { AppShell } from "@/components/app/app-shell";
import { LoginView } from "@/components/app/login-view";
import { DashboardView } from "@/components/app/views/dashboard-view";
import { CustomersView } from "@/components/app/views/customers-view";
import { SitesView } from "@/components/app/views/sites-view";
import { AssetsView } from "@/components/app/views/assets-view";
import { RequestsView } from "@/components/app/views/requests-view";
import { WorkOrdersView } from "@/components/app/views/work-orders-view";
import { ContractsView } from "@/components/app/views/contracts-view";
import { MaintenanceView } from "@/components/app/views/maintenance-view";
import { ChecklistsView } from "@/components/app/views/checklists-view";
import { TeamView } from "@/components/app/views/team-view";
import { MyJobsView } from "@/components/app/views/my-jobs-view";
import { NotificationsView, AuditView, SettingsView } from "@/components/app/views/workspace-views";
import { EmptyState } from "@/components/app/shared/primitives";
import { Button } from "@/components/ui/button";
import { SearchX, Loader2 } from "lucide-react";
import { registerServiceWorker } from "@/lib/pwa";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Do not retry auth/permission errors — they are deterministic.
        const status = (error as { status?: number })?.status ?? 0;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

const VIEW_TITLES: Record<string, string> = {
  dashboard: "Service dashboard",
  "my-jobs": "My jobs",
  requests: "Service requests",
  "work-orders": "Work orders",
  customers: "Customers",
  sites: "Sites",
  assets: "Asset register",
  contracts: "Contracts",
  maintenance: "Preventive maintenance",
  checklists: "Checklist templates",
  team: "Team",
  audit: "Audit log",
  settings: "Workspace settings",
  notifications: "Notifications",
};

/** Redirects unknown routes to the first view the user can access. */
function RedirectToDefault() {
  const can = useCan();
  useEffect(() => {
    const fallback = can("analytics:read") ? "dashboard" : "my-jobs";
    navigate(fallback);
  }, [can]);
  return <BootSplash />;
}

function RoutedView() {
  const route = useHashRoute();
  const can = useCan();
  const [root, id] = route.segments;
  // Support /assets?siteId=… style filters encoded after the view path.
  const siteParam = route.path.includes("?siteId=") ? route.path.split("?siteId=")[1] : undefined;

  switch (root) {
    case "dashboard":
      return can("analytics:read") ? <DashboardView /> : <NotPermittedView what="analytics" />;
    case "my-jobs":
      return <MyJobsView />;
    case "requests":
      return <RequestsView requestId={id} />;
    case "work-orders":
      return <WorkOrdersView workOrderId={id} />;
    case "customers":
      return <CustomersView customerId={id} />;
    case "sites":
      return <SitesView customerId={id} />;
    case "assets":
      return <AssetsView assetId={id} presetSiteId={siteParam} />;
    case "contracts":
      return <ContractsView contractId={id} />;
    case "maintenance":
      return <MaintenanceView />;
    case "checklists":
      return <ChecklistsView />;
    case "team":
      return can("team:read") ? <TeamView /> : <NotPermittedView what="team" />;
    case "audit":
      return can("audit:read") ? <AuditView /> : <NotPermittedView what="audit" />;
    case "settings":
      return <SettingsView />;
    case "notifications":
      return <NotificationsView />;
    default:
      return <RedirectToDefault />;
  }
}

function NotPermittedView({ what }: { what: string }) {
  return (
    <EmptyState
      icon={<SearchX />}
      title="Not available with your role"
      description={`Your role does not include ${what} access. Ask a workspace admin if you believe this is wrong — the API enforces permissions regardless of this page.`}
      action={
        <Button variant="outline" onClick={() => navigate("my-jobs")}>
          Go to my jobs
        </Button>
      }
    />
  );
}

function BootSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <span className="grid size-12 place-items-center rounded-xl bg-[#0b1f33] text-xl font-bold text-white">S</span>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Restoring your session…
      </p>
    </div>
  );
}

function ServiceOSApp() {
  const phase = useAuth((s) => s.phase);
  const initialize = useAuth((s) => s.initialize);
  const route = useHashRoute();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void initialize();
  }, [initialize]);

  // PWA (audit PWA-02/05): register the service worker once and relay its
  // background-sync triggers as window events (consumed by MyJobsView).
  useEffect(() => {
    registerServiceWorker();
  }, []);

  if (phase === "booting") return <BootSplash />;
  if (phase === "anonymous") return <LoginView />;

  return (
    <AppShell title={VIEW_TITLES[route.segments[0] ?? "dashboard"] ?? "ServiceOS"}>
      <RoutedView />
    </AppShell>
  );
}

export function ServiceOSAppRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <ServiceOSApp />
    </QueryClientProvider>
  );
}
