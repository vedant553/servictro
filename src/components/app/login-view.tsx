"use client";

/**
 * Sign-in view. Left brand rail (navy, product story, workflow), right form.
 * Demo credentials are surfaced only because this deployment ships seeded
 * fictional demo tenants (ADR-015) — one click fills the form.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, TextInput } from "@/components/app/shared/form-fields";
import { InlineError } from "@/components/app/shared/primitives";
import { useAuth } from "@/lib/auth/store";
import { Factory, ShieldCheck, ClipboardList, LineChart, LogIn, Loader2, Zap } from "lucide-react";

const HIGHLIGHTS = [
  { icon: Factory, title: "Asset register", text: "LT/HT panels, switchgear and transformers with QR nameplates and full service history." },
  { icon: ClipboardList, title: "Service desk", text: "Intake to triage to work orders with SLA clocks driven by warranty and AMC contracts." },
  { icon: Zap, title: "Field execution", text: "Checklists, measurements and customer acknowledgement captured at the panel." },
  { icon: LineChart, title: "Service analytics", text: "SLA attainment, technician workload and renewal pipeline — computed from real data." },
];

export function LoginView() {
  const login = useAuth((s) => s.login);
  const loginError = useAuth((s) => s.loginError);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0b1f33] p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />
        {/* Teal corner glow — subtle industrial accent */}
        <div
          className="pointer-events-none absolute -right-40 -top-40 size-96 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #22d3ee 0%, transparent 70%)" }}
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <img src="/logo-mark.png" alt="Servictro" className="size-10 rounded-lg" />
            <div>
              <p className="text-lg font-semibold leading-tight">Servictro</p>
              <p className="text-xs text-white/70">After-sales service & asset operations</p>
            </div>
          </div>
        </div>
        <div className="relative max-w-lg space-y-8">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold leading-tight">
              Every panel you shipped,
              <br />
              every service visit it needs.
            </h1>
            <p className="text-sm leading-relaxed text-white/75">
              Servictro connects your installed base to the service desk: assets, contracts, work orders, field
              checklists and analytics in one operational system for electrical OEMs.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title} className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                <h.icon className="size-5 text-[#22d3ee]" aria-hidden />
                <p className="mt-2 text-sm font-medium">{h.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/65">{h.text}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-white/60">
          <ShieldCheck className="size-4" aria-hidden />
          Multi-tenant with row-level isolation · audit-logged actions
        </p>
      </div>

      {/* Form */}
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 lg:hidden">
            <div className="flex items-center gap-3">
              <img src="/logo-mark.png" alt="Servictro" className="size-9 rounded-lg ring-1 ring-border" />
              <p className="text-lg font-semibold">Servictro</p>
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use the work email your team invited you with.</p>
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
              />
            </Field>
            <Field label="Password" htmlFor="login-password" required error={fieldErrors.password}>
              <TextInput
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={fieldErrors.password}
              />
            </Field>
            <InlineError message={loginError} />
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <Card className="bg-muted/30">
            <CardContent className="space-y-2.5 p-4 text-sm">
              <p className="text-sm font-semibold">Demo workspace</p>
              <p className="text-xs text-muted-foreground">
                Seeded with two isolated fictional tenants. One click fills the form below.
              </p>
              <div className="grid gap-2 pt-1">
                <Button type="button" variant="outline" size="sm" className="justify-between" onClick={() => fillDemo("owner@aurora.example", "DemoOwner#2026")}>
                  <span className="font-medium">Aurora Switchgear — Owner</span>
                  <span className="text-xs text-muted-foreground">owner@aurora.example</span>
                </Button>
                <Button type="button" variant="outline" size="sm" className="justify-between" onClick={() => fillDemo("tech@aurora.example", "DemoTech#2026")}>
                  <span className="font-medium">Aurora Switchgear — Technician</span>
                  <span className="text-xs text-muted-foreground">tech@aurora.example</span>
                </Button>
                <Button type="button" variant="outline" size="sm" className="justify-between" onClick={() => fillDemo("owner@voltline.example", "DemoOwner#2026")}>
                  <span className="font-medium">Voltline Power — Owner</span>
                  <span className="text-xs text-muted-foreground">owner@voltline.example</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
