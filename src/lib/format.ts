/**
 * Presentation formatters — dates, durations, money, addresses.
 * Tenant timezone rendering happens server-side where relevant; the console
 * shows absolute times in the user's locale with explicit timezone labels.
 */
import type { Address } from "@/lib/api/types";

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : timeFmt.format(d);
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const diffMs = d - Date.now();
  const absMin = Math.abs(diffMs) / 60000;
  const absHr = absMin / 60;
  const absDay = absHr / 24;
  const fmt = (v: number, unit: string) =>
    `${Math.round(v)} ${unit}${Math.round(v) === 1 ? "" : "s"} ${diffMs < 0 ? "ago" : "from now"}`;
  if (absMin < 1) return diffMs < 0 ? "just now" : "in a moment";
  if (absMin < 60) return fmt(absMin, "min");
  if (absHr < 24) return fmt(absHr, "hour");
  return fmt(absDay, "day");
}

/** Due-date chip: overdue items show "x days overdue". */
export function fmtDue(iso: string | null | undefined): { text: string; overdue: boolean } {
  if (!iso) return { text: "—", overdue: false };
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return { text: "—", overdue: false };
  const overdue = d < Date.now();
  return { text: fmtRelative(iso), overdue };
}

export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

export function fmtHours(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/** Money: minor units (string|number) + ISO currency → localized string. */
export function fmtMoney(amountMinor: string | number | null | undefined, currency = "INR"): string {
  if (amountMinor == null || amountMinor === "") return "—";
  const units = Number(amountMinor);
  if (Number.isNaN(units)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(units / 100);
  } catch {
    return `${currency} ${(units / 100).toLocaleString("en-IN")}`;
  }
}

export function fmtBytes(sizeBytes: string | number | null | undefined): string {
  if (sizeBytes == null) return "—";
  const b = Number(sizeBytes);
  if (Number.isNaN(b)) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtAddress(address: Address | null | undefined): string {
  if (!address) return "—";
  const parts = [address.line1, address.city, address.state, address.postalCode].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

export function fmtPercent(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v)}%`;
}

export function fmtNumber(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("en-IN");
}

/** Duration between two ISO stamps in hours (for SLA chips). */
export function hoursBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  if (!fromIso || !toIso) return null;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 3_600_000;
}
