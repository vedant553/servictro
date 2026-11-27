"use client";

import dynamic from "next/dynamic";

// Auth state (localStorage, refresh cookie) is client-only — skip SSR for
// the console shell entirely; the splash renders while the bundle loads.
const ServictroAppRoot = dynamic(() => import("@/components/app/app-root").then((m) => m.ServictroAppRoot), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <span className="grid size-12 place-items-center rounded-xl bg-[#0b1f33] text-xl font-bold text-white">S</span>
      <p className="text-sm text-muted-foreground">Loading Servictro…</p>
    </div>
  ),
});

export default function Home() {
  return <ServictroAppRoot />;
}
