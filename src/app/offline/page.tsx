import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline",
};

/**
 * Offline fallback page (audit PWA-03/07): served by the service worker when
 * a navigation fails and no cached page exists. It deliberately renders
 * without any client data access — it must work from the precache alone.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-[#0b1f33] text-2xl font-bold text-white">S</span>
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Servictro cannot reach the server right now. Your assigned job pack, site details and any captures you made are
        still stored on this device and will sync automatically once the connection returns.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Try again
      </Link>
    </div>
  );
}
