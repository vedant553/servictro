"use client";

/**
 * Auth/session state for the ServiceOS web console.
 *
 * The access token lives in memory ONLY (XSS hardening, Tech Spec §15.1);
 * the refresh token is an httpOnly cookie the browser sends to /api/v1/auth.
 * The selected tenant persists in localStorage as a *hint* — the backend
 * always re-verifies membership on every request.
 */
import { create } from "zustand";
import { bindAuth } from "@/lib/api/client";
import type { AuthSession, Membership, Tenant } from "@/lib/api/types";
import { get as apiGet, post as apiPost } from "@/lib/api/client";
import { clearOfflineData } from "@/lib/offline-store";

export type AuthPhase = "booting" | "authenticated" | "anonymous";

interface AuthState {
  phase: AuthPhase;
  accessToken: string | null;
  user: AuthSession["user"] | null;
  memberships: Membership[];
  selectedTenantId: string | null;
  tenant: Tenant | null;
  loginError: string | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  refreshTenant: () => Promise<void>;
}

const TENANT_HINT_KEY = "serviceos.selectedTenantId";

function persistHint(tenantId: string | null): void {
  try {
    if (tenantId) localStorage.setItem(TENANT_HINT_KEY, tenantId);
    else localStorage.removeItem(TENANT_HINT_KEY);
  } catch {
    /* storage unavailable (private mode) — hint is optional by design */
  }
}

export const useAuth = create<AuthState>((set, get) => {
  const applySession = (session: AuthSession, remember = true) => {
    if (remember) persistHint(session.selectedTenantId);
    set({
      phase: "authenticated",
      accessToken: session.accessToken,
      user: session.user,
      memberships: session.memberships,
      selectedTenantId: session.selectedTenantId,
      loginError: null,
    });
  };

  const loadTenant = async () => {
    const { phase, selectedTenantId } = get();
    if (phase !== "authenticated" || !selectedTenantId) return;
    try {
      const tenant = await apiGet<Tenant>("/api/v1/tenants/current");
      set({ tenant });
    } catch {
      /* tenant settings are non-critical for shell rendering */
    }
  };

  /**
   * Login / refresh / switch-tenant return memberships WITHOUT the permission
   * arrays (only GET /auth/me carries them — by design, they are derived from
   * the role catalog). Hydrate them right after a session is applied.
   */
  const hydratePermissions = async () => {
    if (get().phase !== "authenticated") return;
    try {
      const me = await apiGet<{ memberships: Membership[] }>("/api/v1/auth/me");
      if (me?.memberships?.length) set({ memberships: me.memberships });
    } catch {
      /* keep role-only memberships; permission checks stay conservative */
    }
  };

  // Wire the API client to this store (once, at module evaluation).
  bindAuth(
    () => get().accessToken,
    (next) => set({ accessToken: next }),
    () =>
      set({
        phase: "anonymous",
        accessToken: null,
        user: null,
        memberships: [],
        selectedTenantId: null,
        tenant: null,
      }),
  );

  return {
    phase: "booting",
    accessToken: null,
    user: null,
    memberships: [],
    selectedTenantId: null,
    tenant: null,
    loginError: null,

    initialize: async () => {
      try {
        const session = await apiPost<AuthSession>("/api/v1/auth/refresh");
        if (session?.accessToken) {
          applySession(session, false);
          await Promise.all([loadTenant(), hydratePermissions()]);
        } else {
          set({ phase: "anonymous" });
        }
      } catch {
        set({ phase: "anonymous" });
      }
    },

    login: async (email, password) => {
      try {
        const session = await apiPost<AuthSession>("/api/v1/auth/login", { email, password });
        applySession(session);
        await Promise.all([loadTenant(), hydratePermissions()]);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sign-in failed";
        set({ loginError: message });
        return false;
      }
    },

    logout: async () => {
      try {
        await apiPost("/api/v1/auth/logout");
      } catch {
        /* local sign-out must succeed even if the API is unreachable */
      }
      // Purge ALL offline caches/queues (audit SEC-01): cached job packs
      // carry site addresses and access instructions — they must never
      // outlive the session that fetched them.
      clearOfflineData();
      persistHint(null);
      set({
        phase: "anonymous",
        accessToken: null,
        user: null,
        memberships: [],
        selectedTenantId: null,
        tenant: null,
        loginError: null,
      });
    },

    switchTenant: async (tenantId) => {
      // Same purge on workspace switching (audit SEC-01): queued captures
      // are user+tenant scoped and must not be pushed under the new
      // tenant's authorization. The UI warns before switching when
      // unsynced work exists (app-shell TenantSwitcher).
      clearOfflineData();
      const session = await apiPost<AuthSession>("/api/v1/auth/switch-tenant", { tenantId });
      applySession(session);
      await Promise.all([loadTenant(), hydratePermissions()]);
    },

    refreshTenant: loadTenant,
  };
});

/* Convenience selectors — every selector MUST return a reference-stable
 * value (zustand v5 uses useSyncExternalStore; fresh objects/arrays per
 * call cause re-render loops). */
const NO_MEMBERSHIP: Membership | null = null;
const NO_PERMISSIONS: string[] = [];

export const useCurrentMembership = (): Membership | null =>
  useAuth((s) => s.memberships.find((m) => m.tenantId === s.selectedTenantId) ?? NO_MEMBERSHIP);

export function usePermissions(): string[] {
  return useAuth((s) => s.memberships.find((m) => m.tenantId === s.selectedTenantId)?.permissions ?? NO_PERMISSIONS);
}

export function useCan(): (permission: string) => boolean {
  const permissions = usePermissions();
  return (permission: string) => permissions.includes(permission);
}
