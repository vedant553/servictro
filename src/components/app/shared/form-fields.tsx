"use client";

/**
 * Form primitives — labelled inputs bound to react-hook-form with inline
 * validation feedback, plus enum Select wrappers driven by design tokens.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required ? (
          <span className="ml-0.5 text-[color:var(--status-danger)]" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-[color:var(--status-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  id,
  error,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; error?: string }) {
  return (
    <Input
      id={id}
      aria-invalid={error ? true : undefined}
      className={cn(error && "border-[color:var(--status-danger)]", className)}
      {...props}
    />
  );
}

export function TextArea({
  id,
  error,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { id: string; error?: string }) {
  return (
    <Textarea
      id={id}
      aria-invalid={error ? true : undefined}
      className={cn(error && "border-[color:var(--status-danger)]", className)}
      {...props}
    />
  );
}

/**
 * EnumSelect — Radix forbids SelectItem values of "" (reserved for clearing),
 * so empty-string options ("All statuses", "Not specified"…) are mapped to an
 * internal sentinel and translated back on selection.
 */
const EMPTY_SENTINEL = "__empty__";

export function EnumSelect({
  id,
  options,
  value,
  onValueChange,
  placeholder,
  disabled,
  error,
}: {
  id: string;
  options: Option[];
  value: string | undefined;
  onValueChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}) {
  const toInternal = (v: string | undefined) => (v === undefined || v === "" ? EMPTY_SENTINEL : v);
  const toExternal = (v: string) => (v === EMPTY_SENTINEL ? "" : v);
  return (
    <Select value={toInternal(value)} onValueChange={(v) => onValueChange(toExternal(v))} disabled={disabled}>
      <SelectTrigger id={id} aria-invalid={error ? true : undefined} className={cn("w-full", error && "border-[color:var(--status-danger)]")}>
        <SelectValue placeholder={placeholder ?? "Select…"} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((o) => (
          <SelectItem key={o.value || EMPTY_SENTINEL} value={toInternal(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Chip row for read-only tag lists (skills, requiredSkills…). */
export function TagList({ items, empty = "—" }: { items: string[]; empty?: string }) {
  if (!items?.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) => (
        <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {t}
        </span>
      ))}
    </div>
  );
}
