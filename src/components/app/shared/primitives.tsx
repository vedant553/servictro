"use client";

/**
 * Shared layout primitives for console views: page headers, stat cards,
 * empty states, key/value details, form field wrappers.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { ArrowUpRight, ArrowDownRight, Minus, AlertCircle } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        {breadcrumb ? (
          <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
            {breadcrumb}
          </nav>
        ) : null}
        <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const STAT_TONE: Record<string, { value: string; iconWrap: string; icon: string }> = {
  neutral: { value: "text-foreground", iconWrap: "bg-muted text-muted-foreground", icon: "text-muted-foreground" },
  warning: {
    value: "text-[color:var(--status-warning)]",
    iconWrap: "bg-[color:var(--status-warning-bg)] text-[color:var(--status-warning)]",
    icon: "text-[color:var(--status-warning)]",
  },
  danger: {
    value: "text-[color:var(--status-danger)]",
    iconWrap: "bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger)]",
    icon: "text-[color:var(--status-danger)]",
  },
  success: {
    value: "text-[color:var(--status-success)]",
    iconWrap: "bg-[color:var(--status-success-bg)] text-[color:var(--status-success)]",
    icon: "text-[color:var(--status-success)]",
  },
  info: {
    value: "text-[color:var(--status-info)]",
    iconWrap: "bg-[color:var(--status-info-bg)] text-[color:var(--status-info)]",
    icon: "text-[color:var(--status-info)]",
  },
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  trend?: { direction: "up" | "down" | "flat"; text: string };
  tone?: "neutral" | "warning" | "danger" | "success" | "info";
}) {
  const t = STAT_TONE[tone] ?? STAT_TONE.neutral;
  return (
    <Card className="py-0">
      <CardContent className="flex items-start justify-between gap-3 p-4 md:p-5">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn("text-2xl font-semibold tabular-nums tracking-tight", t.value)}>{value}</p>
          {hint ? <p className="text-xs leading-snug text-muted-foreground">{hint}</p> : null}
          {trend ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {trend.direction === "up" ? (
                <ArrowUpRight className="size-3" aria-hidden />
              ) : trend.direction === "down" ? (
                <ArrowDownRight className="size-3" aria-hidden />
              ) : (
                <Minus className="size-3" aria-hidden />
              )}
              {trend.text}
            </p>
          ) : null}
        </div>
        {icon ? (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg [&>svg]:size-4.5", t.iconWrap)} aria-hidden>
            {icon}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center">
      {icon ? (
        <div className="mb-1 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground [&>svg]:size-5" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>{children}</dl>;
}

export function DetailItem({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1 border-l-2 border-border pl-3", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardContent className={cn("p-4 md:p-5", contentClassName)}>
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <Skeleton className="h-10 w-full rounded-lg" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-11 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md bg-[color:var(--status-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--status-danger)]"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}
