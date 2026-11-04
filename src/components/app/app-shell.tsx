"use client";

/**
 * Console shell: navy sidebar (grouped, permission-filtered), top bar with
 * tenant switcher + notification centre + user menu, and the hash-routed
 * content area. Mobile collapses the sidebar into a sheet.
 */
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth, useCurrentMembership, useCan } from "@/lib/auth/store";
import { get as apiGet, post as apiPost } from "@/lib/api/client";
import type { AppNotification } from "@/lib/api/types";
import { href, useHashRoute } from "@/lib/router";
import { fmtRelative } from "@/lib/format";
import { ROLE_STYLE } from "@/design-system/tokens";
import { StatusBadge } from "@/components/app/shared/status-badge";
import { anyPendingOperations } from "@/lib/offline-store";
import {
  LayoutDashboard,
  ClipboardList,
  Wrench,
  Building2,
  MapPin,
  Boxes,
  FileSignature,
  CalendarClock,
  ListChecks,
  Users,
  ScrollText,
  Settings,
  Bell,
  LogOut,
  Menu,
  CheckCheck,
  ChevronsUpDown,
  HardHat,
  Inbox,
} from "lucide-react";

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

const NAV_GROUPS: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Overview",
    items: [
      { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "analytics:read" },
      { path: "/my-jobs", label: "My jobs", icon: HardHat, permission: "work_orders:execute" },
    ],
  },
  {
    group: "Service operations",
    items: [
      { path: "/requests", label: "Service requests", icon: ClipboardList, permission: "requests:read" },
      { path: "/work-orders", label: "Work orders", icon: Wrench, permission: "work_orders:read" },
    ],
  },
  {
    group: "Installed base",
    items: [
      { path: "/customers", label: "Customers", icon: Building2, permission: "customers:read" },
      { path: "/sites", label: "Sites", icon: MapPin, permission: "sites:read" },
      { path: "/assets", label: "Assets", icon: Boxes, permission: "assets:read" },
    ],
  },
  {
    group: "Coverage & maintenance",
    items: [
      { path: "/contracts", label: "Contracts", icon: FileSignature, permission: "contracts:read" },
      { path: "/maintenance", label: "PM plans & visits", icon: CalendarClock, permission: "maintenance:read" },
      { path: "/checklists", label: "Checklist templates", icon: ListChecks, permission: "checklists:read" },
    ],
  },
  {
    group: "Workspace",
    items: [
      { path: "/team", label: "Team", icon: Users, permission: "team:read" },
      { path: "/audit", label: "Audit log", icon: ScrollText, permission: "audit:read" },
      { path: "/settings", label: "Settings", icon: Settings, permission: "tenant:manage" },
    ],
  },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const route = useHashRoute();
  const can = useCan();
  const membership = useCurrentMembership();
  const tenant = useAuth((s) => s.tenant);

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3 [scrollbar-width:thin]">
      <div className="mb-2 flex items-center gap-3 px-2 py-3">
        <img src="/logo-mark.png" alt="Servictro" className="size-9 shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Servictro</p>
          <p className="truncate text-xs text-white/50">{tenant?.name ?? membership?.tenantName ?? "Workspace"}</p>
        </div>
      </div>

      {NAV_GROUPS.map(({ group, items }) => {
        const visible = items.filter((i) => !i.permission || can(i.permission));
        if (!visible.length) return null;
        return (
          <div key={group} className="mb-1">
            <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-white/40">{group}</p>
            <nav aria-label={group} className="space-y-0.5">
              {visible.map((item) => {
                const active = route.path === item.path || route.path.startsWith(`${item.path}/`);
                return (
                  <a
                    key={item.path}
                    href={href(item.path)}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-md px-2 text-sm text-white/70 transition-colors hover:bg-[#16293f] hover:text-white",
                      active && "bg-primary/90 font-medium text-white hover:bg-primary",
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </a>
                );
              })}
            </nav>
          </div>
        );
      })}

      <div className="mt-auto px-2 pb-1 pt-4 text-[10px] leading-relaxed text-white/30">
        Servictro v0.1 · demo environment
        <br />
        data isolated per tenant
      </div>
    </div>
  );
}

function TenantSwitcher() {
  const memberships = useAuth((s) => s.memberships);
  const selectedTenantId = useAuth((s) => s.selectedTenantId);
  const switchTenant = useAuth((s) => s.switchTenant);
  const [busy, setBusy] = useState(false);
  if (memberships.length < 2) return null;
  const current = memberships.find((m) => m.tenantId === selectedTenantId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 gap-2" disabled={busy} aria-label="Switch workspace">
          <span className="truncate font-medium">{current?.tenantName ?? "Select workspace"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.tenantId}
            onClick={async () => {
              if (m.tenantId === selectedTenantId) return;
              // Account-switch purge (audit SEC-01): offline caches and queues
              // are cleared on switch — warn when unsynced captures exist.
              if (anyPendingOperations()) {
                const proceed = window.confirm(
                  "You have offline captures that have not been synced yet. Switching workspaces now will discard them permanently. Switch anyway?",
                );
                if (!proceed) return;
              }
              setBusy(true);
              try {
                await switchTenant(m.tenantId);
                window.location.hash = "#/dashboard";
                window.location.reload();
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="truncate">{m.tenantName}</span>
              {m.tenantId === selectedTenantId ? <CheckCheck className="size-4 text-primary" aria-hidden /> : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiGet<{ count: number }>("/api/v1/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => apiGet<AppNotification[]>("/api/v1/notifications", { limit: 8 }),
    enabled: open,
  });
  const count = unread.data?.count ?? 0;

  const markRead = async (id: string) => {
    await apiPost(`/api/v1/notifications/${id}/read`);
    await Promise.all([unread.refetch(), list.refetch()]);
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };
  const markAll = async () => {
    await apiPost("/api/v1/notifications/read-all");
    await Promise.all([unread.refetch(), list.refetch()]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-9" aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}>
          <Bell className="size-4.5" aria-hidden />
          {count > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4.5 place-items-center rounded-full bg-[color:var(--status-danger)] px-1 text-[10px] font-semibold text-white">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {count > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAll}>
              <CheckCheck className="mr-1 size-3.5" aria-hidden /> Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {list.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : !list.data?.length ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground">
              <Inbox className="size-6" aria-hidden />
              <p className="text-sm">You&apos;re all caught up.</p>
            </div>
          ) : (
            list.data.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => markRead(n.id)}
                className={cn(
                  "block w-full border-b px-4 py-3 text-left last:border-0 hover:bg-muted/60",
                  !n.readAt && "bg-[color:var(--status-info-bg)]/60",
                )}
              >
                <p className="text-sm font-medium leading-snug">{n.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {n.category.replace(/_/g, " ")} · {fmtRelative(n.createdAt)}
                </p>
              </button>
            ))
          )}
        </div>
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setOpen(false)}>
            <a href={href("/notifications")}>View all notifications</a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const membership = useCurrentMembership();
  const initials = (user?.displayName ?? user?.email ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="Account menu">
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm font-medium md:inline">{user?.displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <p>{user?.displayName}</p>
          <p className="text-xs font-normal text-muted-foreground">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <span className="flex items-center gap-2 text-sm">
            Role
            {membership ? <StatusBadge style={ROLE_STYLE[membership.role]} /> : null}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => (window.location.hash = "#/notifications")}>Notifications</DropdownMenuItem>
        <DropdownMenuItem onClick={() => (window.location.hash = "#/settings")}>Workspace settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void logout()} className="text-[color:var(--status-danger)]">
          <LogOut className="mr-2 size-4" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children, title }: { children: React.ReactNode; title: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const route = useHashRoute();
  const can = useCan();
  const notificationsVisible = can("notifications:read");

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 bg-[#0b1f33] lg:block" aria-label="Primary">
        <SidebarNav />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="size-9 lg:hidden" aria-label="Open navigation">
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-[#0b1f33] p-0 [&>button]:text-white">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="secondary" className="hidden font-normal text-muted-foreground sm:inline-flex">
              {route.segments[0]?.replace(/-/g, " ") ?? "dashboard"}
            </Badge>
            <span className="truncate text-sm font-medium">{title}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <TenantSwitcher />
            {notificationsVisible ? <NotificationBell /> : null}
            <UserMenu />
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6 lg:p-8">{children}</div>
        </main>

        <footer className="mt-auto border-t bg-card px-6 py-3 text-xs text-muted-foreground">
          Servictro — demo environment · fictional seed data · every action is audit-logged
        </footer>
      </div>
    </div>
  );
}
