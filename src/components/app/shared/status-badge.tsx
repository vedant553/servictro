"use client";

/**
 * Status badge — renders a domain enum with a human label, a tone colour and
 * a glyph. Colour is never the only signal (WCAG 1.4.1): every variant pairs
 * the tone with an explicit label and, where useful, an icon.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Tone } from "@/design-system/tokens";
import type { EnumStyle } from "@/design-system/tokens";
import { AlertTriangle, CheckCircle2, CircleDashed, CircleDot, Info, ShieldAlert } from "lucide-react";

const TONE_CLASS: Record<Tone, string> = {
  success: "border-transparent text-[color:var(--status-success)] bg-[color:var(--status-success-bg)]",
  warning: "border-transparent text-[color:var(--status-warning)] bg-[color:var(--status-warning-bg)]",
  danger: "border-transparent text-[color:var(--status-danger)] bg-[color:var(--status-danger-bg)]",
  info: "border-transparent text-[color:var(--status-info)] bg-[color:var(--status-info-bg)]",
  neutral: "border-transparent text-[color:var(--status-neutral)] bg-[color:var(--status-neutral-bg)]",
  accent: "border-transparent text-[color:var(--status-accent)] bg-[color:var(--status-accent-bg)]",
};

const TONE_ICON: Record<Tone, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: ShieldAlert,
  info: CircleDot,
  neutral: CircleDashed,
  accent: Info,
};

export function StatusBadge({ style, className }: { style: EnumStyle; className?: string }) {
  const Icon = TONE_ICON[style.tone];
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium whitespace-nowrap", TONE_CLASS[style.tone], className)}>
      <Icon className="size-3" aria-hidden />
      {style.label}
    </Badge>
  );
}

export function TextBadge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1 whitespace-nowrap font-medium", TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}
