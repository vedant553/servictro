"use client";

/**
 * Sign-in view. Left brand rail (navy, product story, workflow), right form.
 * Demo credentials are surfaced only because this deployment ships seeded
 * fictional demo tenants (ADR-015) — one click fills the form.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/app/shared/form-fields";
import { InlineError } from "@/components/app/shared/primitives";
import { useAuth } from "@/lib/auth/store";
import {
  Factory,
  ShieldCheck,
  ClipboardList,
  LineChart,
  LogIn,
  Loader2,
  Zap,
  Eye,
  EyeOff,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const HIGHLIGHTS = [
  { icon: Factory, title: "Asset register", text: "LT/HT panels, switchgear and transformers with QR nameplates and full service history." },
  { icon: ClipboardList, title: "Service desk", text: "Intake to triage to work orders with SLA clocks driven by warranty and AMC contracts." },
  { icon: Zap, title: "Field execution", text: "Checklists, measurements and customer acknowledgement captured at the panel." },
  { icon: LineChart, title: "Service analytics", text: "SLA attainment, technician workload and renewal pipeline — computed from real data." },
];

const DEMO_ACCOUNTS = [
  { tenant: "GridNova Systems", role: "Owner", email: "owner@gridnova.example", password: "DemoOwner#2026", initials: "GN" },
  { tenant: "GridNova Systems", role: "Technician", email: "tech@gridnova.example", password: "DemoTech#2026", initials: "GT" },
  { tenant: "Voltline Power", role: "Owner", email: "owner@voltline.example", password: "DemoOwner#2026", initials: "VP" },
];

export function LoginView() {
  const login = useAuth((s) => s.login);
  const loginError = useAuth((s) => s.loginError);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = "Enter a valid work email";
    if (password.length < 8) errors.password = "Password must be at least 8 characters";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setSubmitting(true);
    await login(email, password);
    setSubmitting(false);
  };

  const fillDemo = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setFieldErrors({});
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand rail */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0b1f33] p-10 text-white lg:flex xl:p-14">
        {/* Engineering grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              "linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />
        {/* Teal corner glow */}
        <div
          className="pointer-events-none absolute -right-40 -top-40 size-[28rem] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #22d3ee 0%, transparent 70%)" }}
          aria-hidden
        />
        {/* Deep blue floor glow */}
        <div
          className="pointer-events-none absolute -bottom-48 -left-32 size-[26rem] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }}
          aria-hidden
        />

        <div className="relative animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="flex items-center gap-3.5">
            <img src="/logo-mark.png" alt="Servictro" className="size-11 rounded-xl shadow-lg shadow-black/30" />
            <div>
              <p className="text-lg font-semibold leading-tight tracking-tight">Servictro</p>
              <p className="text-xs text-white/70">After-sales service & asset operations</p>
            </div>
            <span className="ml-3 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-white/60">
              Demo
            </span>
          </div>
        </div>

        <div className="relative max-w-xl space-y-9 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="space-y-4">
            <h1 className="text-[2rem] font-semibold leading-[1.15] tracking-tight xl:text-4xl">
              Every panel you shipped,
              <br />
              <span className="bg-gradient-to-r from-[#22d3ee] via-[#67e8f9] to-[#7dd3fc] bg-clip-text text-transparent">
                every service visit it needs.
              </span>
            </h1>
            <p className="max-w-lg text-sm leading-relaxed text-white/80">
              Servictro connects your installed base to the service desk: assets, contracts, work orders, field
              checklists and analytics in one operational system for electrical OEMs.
            </p>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {HIGHLIGHTS.map((h) => (
              <li
                key={h.title}
                className="group rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-all duration-200 hover:border-white/20 hover:bg-white/[0.07]"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-[#22d3ee]/15 text-[#22d3ee] transition-colors group-hover:bg-[#22d3ee]/25">
                  <h.icon className="size-4.5" aria-hidden />
                </span>
                <p className="mt-3 text-sm font-medium">{h.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/70">{h.text}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-6 text-xs text-white/60 animate-in fade-in duration-700">
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[#22d3ee]/80" aria-hidden />
            Multi-tenant with row-level isolation
          </p>
          <span className="hidden h-3 w-px bg-white/15 sm:block" aria-hidden />
          <p className="hidden sm:block">Audit-logged actions</p>
        </div>
      </div>

      {/* Form */}
      <div className="relative flex min-h-screen items-center justify-center bg-background p-6 sm:p-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#0b1f33]/[0.04] to-transparent lg:hidden" aria-hidden />
        <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
          {/* Mobile brand header */}
          <div className="space-y-2 lg:hidden">
            <div className="flex items-center gap-3 rounded-xl border bg-[#0b1f33] p-4 text-white shadow-sm">
              <img src="/logo-mark.png" alt="Servictro" className="size-9 rounded-lg" />
              <div>
                <p className="text-base font-semibold leading-tight">Servictro</p>
                <p className="text-xs text-white/70">After-sales service & asset operations</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-[1.6rem] font-semibold tracking-tight">Sign in to your workspace</h2>
            <p className="text-sm text-muted-foreground">Use the work email your team invited you with.</p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Work email" htmlFor="login-email" required error={fieldErrors.email}>
              <TextInput
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={fieldErrors.email}
                className="h-10"
              />
            </Field>
            <Field label="Password" htmlFor="login-password" required error={fieldErrors.password}>
              <div className="relative">
                <TextInput
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={fieldErrors.password}
                  className="h-10 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
            </Field>
            <InlineError message={loginError} />
            <Button
              type="submit"
              className="h-10 w-full bg-gradient-to-r from-[#2563eb] to-[#0891b2] text-[0.9375rem] font-medium shadow-md shadow-[#0891b2]/20 transition-all hover:opacity-95 hover:shadow-lg hover:shadow-[#0891b2]/25"
              disabled={submitting}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">or explore the demo</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="rounded-xl border bg-muted/30">
            <div className="flex items-start gap-3 border-b px-4 py-3.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#0891b2]/10 text-[#0891b2]">
                <Zap className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Demo workspace</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Seeded with two isolated fictional tenants. One click fills the form.
                </p>
              </div>
            </div>
            <div className="space-y-1.5 p-2">
              {DEMO_ACCOUNTS.map((acct) => (
                <button
                  key={`${acct.email}`}
                  type="button"
                  onClick={() => fillDemo(acct.email, acct.password)}
                  className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-all hover:border-border hover:bg-background hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold",
                      acct.initials === "VP" ? "bg-[#2563eb]/10 text-[#2563eb]" : "bg-[#0891b2]/10 text-[#0891b2]",
                    )}
                    aria-hidden
                  >
                    {acct.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{acct.tenant}</span>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {acct.role}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{acct.email}</span>
                  </span>
                  <ArrowUpRight
                    className="size-4 shrink-0 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          </div>

          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Protected workspace · every sign-in attempt is rate-limited and audit-logged
          </p>
        </div>
      </div>
    </div>
  );
}
