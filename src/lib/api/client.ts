/**
 * Servictro typed API client (web console → NestJS API).
 *
 * - Same-origin relative URLs only. The platform gateway routes requests that
 *   carry `?XTransformPort=4000` to the API; everything else hits Next.js.
 * - Bearer access token kept in memory only (never localStorage); refresh
 *   token lives in an httpOnly SameSite cookie scoped to /api/v1/auth.
 * - On TOKEN_EXPIRED the client performs a single silent refresh + retry.
 * - Errors are normalized to ApiError with the backend envelope shape.
 */
import type { ApiEnvelope, ApiErrorBody } from "@serviceos/contracts";

export const API_GATEWAY_PORT = "4000";

let tokenGetter: () => string | null = () => null;
let tokenExchanged: ((next: string) => void) | null = null;
let unauthorizedHandler: (() => void) | null = null;

/** Wired by the auth store — avoids a circular module dependency. */
export function bindAuth(
  get: () => string | null,
  exchanged: (next: string) => void,
  onUnauthorized: () => void,
): void {
  tokenGetter = get;
  tokenExchanged = exchanged;
  unauthorizedHandler = onUnauthorized;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Array<{ field: string; reason: string }>;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: Array<{ field: string; reason: string }>, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level validation message for react-hook-form setError calls. */
  fieldError(field: string): string | undefined {
    return this.details?.find((d) => d.field === field)?.reason;
  }
}

type QueryValue = string | number | boolean | null | undefined;

/** Merges query params and always injects the gateway port selector. */
function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path, "http://local.invalid");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set("XTransformPort", API_GATEWAY_PORT);
  return `${url.pathname}${url.search}`;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** internal: prevent refresh loops */
  _retry?: boolean;
}

async function rawRequest(path: string, options: RequestOptions, signal?: AbortSignal): Promise<Response> {
  const token = tokenGetter();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    body,
    credentials: "include",
    signal,
  });
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as ApiEnvelope<T> | ApiErrorBody) : null;
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? res.statusText, err?.details, (json as ApiErrorBody | null)?.meta?.requestId);
  }
  return (json as ApiEnvelope<T>).data;
}

/** One silent token refresh, shared across concurrent 401s. */
let refreshInFlight: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(buildUrl("/api/v1/auth/refresh"), {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return null;
        const json = (await res.json()) as ApiEnvelope<{ accessToken: string | null }>;
        const next = json.data?.accessToken ?? null;
        if (next && tokenExchanged) tokenExchanged(next);
        return next;
      } catch {
        return null;
      } finally {
        setTimeout(() => (refreshInFlight = null), 0);
      }
    })();
  }
  return refreshInFlight;
}

export async function api<T>(path: string, options: RequestOptions = {}, signal?: AbortSignal): Promise<T> {
  let res = await rawRequest(path, options, signal);
  if (res.status === 401 && !options._retry) {
    const body = (await res.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error?.code === "TOKEN_EXPIRED") {
      const next = await tryRefresh();
      if (next) {
        res = await rawRequest(path, { ...options, _retry: true }, signal);
      } else {
        unauthorizedHandler?.();
        throw new ApiError(401, body.error.code, body.error.message, body.error.details, body.meta?.requestId);
      }
    }
  }
  return parseEnvelope<T>(res);
}

/** Multipart upload. Returns the attachment with a gateway-routed download URL. */
export async function apiUpload<T>(
  path: string,
  file: File,
  query: Record<string, QueryValue> = {},
  signal?: AbortSignal,
): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const token = tokenGetter();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let res = await fetch(buildUrl(path, query), {
    method: "POST",
    headers,
    body: form,
    credentials: "include",
    signal,
  });
  // Bounded authentication retry (audit DATA-08): exactly ONE silent refresh
  // + replay — the previous unbounded recursion could loop forever when the
  // server kept answering 401 (expired/expired-again or revoked session).
  if (res.status === 401) {
    const next = await tryRefresh();
    if (next) {
      const retryHeaders: Record<string, string> = {};
      const retryToken = tokenGetter();
      if (retryToken) retryHeaders.Authorization = `Bearer ${retryToken}`;
      res = await fetch(buildUrl(path, query), {
        method: "POST",
        headers: retryHeaders,
        body: rebuildForm(file),
        credentials: "include",
        signal,
      });
    } else {
      unauthorizedHandler?.();
    }
  }
  return parseEnvelope<T>(res);
}

/** FormData bodies cannot be reused after a fetch — rebuild for the single retry. */
function rebuildForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

/** Named REST helpers keep call-sites terse and consistently typed. */
export const get = <T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) => api<T>(path, { method: "GET", query }, signal);
export const post = <T>(path: string, body?: unknown, query?: Record<string, QueryValue>, signal?: AbortSignal) =>
  api<T>(path, { method: "POST", body, query }, signal);
export const patch = <T>(path: string, body?: unknown, query?: Record<string, QueryValue>, signal?: AbortSignal) =>
  api<T>(path, { method: "PATCH", body, query }, signal);
export const del = <T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) =>
  api<T>(path, { method: "DELETE", query }, signal);
