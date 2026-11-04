"use client";

/**
 * PWA runtime helpers (audit PWA-02/05).
 *
 * - registerServiceWorker(): called once from the app root; registers /sw.js
 *   and relays worker messages (background-sync triggers) as window events.
 * - requestBackgroundSync(): asks the browser to fire the 'serviceos-sync'
 *   event on the next connectivity — including after the tab was closed —
 *   which wakes the page (via the SW message) to push the durable queue.
 *   Falls back silently where Background Sync is unsupported (all non-
 *   Chromium browsers): the page still auto-syncs on 'online' + on load.
 */

export const SW_SYNC_EVENT = "serviceos:trigger-sync";

export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((registration) => {
      void requestBackgroundSyncOn(registration);
    })
    .catch(() => undefined); // progressive enhancement — the app works without a SW

  const onMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string })?.type === SW_SYNC_EVENT) {
      window.dispatchEvent(new CustomEvent(SW_SYNC_EVENT));
    }
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
}

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

async function requestBackgroundSyncOn(registration: SyncRegistration): Promise<void> {
  try {
    await registration.sync?.register("serviceos-sync");
  } catch {
    /* unsupported or permission denied — online/load auto-sync covers it */
  }
}

export async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = (await navigator.serviceWorker.ready) as SyncRegistration;
    await requestBackgroundSyncOn(registration);
  } catch {
    /* best-effort */
  }
}
