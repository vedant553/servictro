"use client";

/**
 * Hash-based client router.
 *
 * The deployment sandbox exposes exactly one URL to the user (the Next.js "/"
 * route), so the console implements its own navigation state via the location
 * hash — deep-linkable (#/work-orders/<id>), back/forward friendly, and it
 * never collides with the platform gateway's path routing.
 */
import { useCallback, useEffect, useState } from "react";

export interface HashRoute {
  /** e.g. "/work-orders/42" (always starts with "/", no trailing hash) */
  path: string;
  /** path split into non-empty segments: ["work-orders", "42"] */
  segments: string[];
}

function readRoute(): HashRoute {
  const raw = window.location.hash.replace(/^#/, "");
  const path = raw === "" ? "/dashboard" : raw.startsWith("/") ? raw : `/${raw}`;
  return { path, segments: path.split("/").filter(Boolean) };
}

export function navigate(path: string): void {
  const target = path.startsWith("/") ? path : `/${path}`;
  if (window.location.hash === `#${target}`) return;
  window.location.hash = target;
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>({ path: "/dashboard", segments: ["dashboard"] });

  useEffect(() => {
    const apply = () => setRoute(readRoute());
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  return route;
}

/** Imperative back navigation that still works with hashes. */
export function goBack(fallback = "/dashboard"): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

/** Anchor-friendly href for a route (keeps Link-like patterns available). */
export function href(path: string): string {
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}

export function useNavigate() {
  return useCallback((path: string) => navigate(path), []);
}
