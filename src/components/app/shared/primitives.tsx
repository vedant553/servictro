"use client";

/**
 * Shared layout primitives for console views: page headers, stat cards,
 * empty states, key/value details, form field wrappers.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

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
        {breadcrumb ? <div className="text-sm text-muted-foreground">{breadcrumb}</div> : null}
        <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

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
  const toneText = {
    neutral: "text-foreground",
    warning: "text-[color:var(--status-warning)]",
    danger: "text-[color:var(--status-danger)]",
    success: "text-[color:var(--status-success)]",
    info: "text-[color:var(--status-info)]",
  }[tone];
  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {icon ? <span className="text-muted-foreground [&>svg]:size-4">{icon}</span> : null}
        </div>
        <p className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", toneText)}>{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        {trend ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card/50 px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground [&>svg]:size-8">{icon}</div> : null}
      <p className="font-medium">{title}</p>
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
    <div className={cn("min-w-0 space-y-0.5", className)}>
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
    <Card className={className}>
      <CardContent className={cn("p-4 md:p-5", contentClassName)}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
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
      <Skeleton className="h-9 w-full" />
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
    <p role="alert" className="rounded-md bg-[color:var(--status-danger-bg)] px-3 py-2 text-sm text-[color:var(--status-danger)]">
      {message}
    </p>
  );
}
