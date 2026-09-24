import { ApiError, isAbortError } from "./errors";
import type {
  CreateSource,
  CsrfResponse,
  MeResponse,
  Ok,
  Server,
  Source,
  Still,
  TreeEntry,
} from "./types";

/**
 * Typed client for SeraFrame integration contract v1 (`app/main.py` at 6109125).
 * Session cookie `seraframe_session` is HttpOnly and is never read here.
 * Mutating methods send `X-CSRF-Token`. The API accepts the request only when
 * that header equals the non-HttpOnly `seraframe_csrf` cookie.
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type UnauthorizedHandler = () => void;

let csrfToken: string | null = null;
let onUnauthorized: UnauthorizedHandler | null = null;

export type RequestOptions = {
  signal?: AbortSignal;
};

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

export function clearCsrfToken(): void {
  csrfToken = null;
}

export function resetClientForTests(): void {
  csrfToken = null;
  onUnauthorized = null;
}

function readCsrfCookie(): string | null {
  if (typeof document === "undefined" || !document.cookie) return null;
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "seraframe_csrf") {
      const value = decodeURIComponent(rest.join("="));
      return value || null;
    }
  }
  return null;
}

function readRetryAfter(res: Response): number | null {
  const raw = res.headers.get("Retry-After");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds;
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.round((when - Date.now()) / 1000));
}

async function toApiError(res: Response): Promise<ApiError> {
  const retryAfter = readRetryAfter(res);
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    const code = body.error?.code || "io_error";
    const message = body.error?.message || res.statusText || "Request failed.";
    return new ApiError(res.status, code, message, retryAfter);
  } catch {
    return new ApiError(res.status, "io_error", res.statusText || "Request failed.", retryAfter);
  }
}

async function fetchCsrf(): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/auth/csrf", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(0, "io_error", "Network error. Check your connection.");
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw await toApiError(res);
  }
  const body = (await res.json()) as CsrfResponse;
  if (!body.csrfToken) {
    throw new ApiError(res.status, "io_error", "CSRF token missing from server.");
  }
  csrfToken = body.csrfToken;
  return body.csrfToken;
}

/**
 * The API accepts a mutation only when `X-CSRF-Token` equals the
 * `seraframe_csrf` cookie (`app/main.py` csrf_guard). Prefer that cookie.
 * If the cached token and the cookie disagree, fetch a new pair.
 */
export async function ensureCsrf(force = false): Promise<string> {
  const cookie = readCsrfCookie();
  if (!force && cookie && (!csrfToken || csrfToken === cookie)) {
    csrfToken = cookie;
    return cookie;
  }
  if (!force && csrfToken && !cookie) return csrfToken;
  const issued = await fetchCsrf();
  const refreshed = readCsrfCookie();
  if (refreshed && refreshed === issued) {
    csrfToken = refreshed;
    return refreshed;
  }
  csrfToken = issued;
  return issued;
}

export async function prefetchCsrf(): Promise<void> {
  await ensureCsrf(true);
}

type RequestInitJson = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

async function request<T>(path: string, init: RequestInitJson, csrfRetry = true): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (MUTATING.has(method)) headers.set("X-CSRF-Token", await ensureCsrf(false));

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(0, "io_error", "Network error. Check your connection.");
  }

  if (res.status === 401) onUnauthorized?.();

  if (!res.ok) {
    const apiError = await toApiError(res);
    if (apiError.code === "csrf" && csrfRetry && MUTATING.has(method)) {
      clearCsrfToken();
      await ensureCsrf(true);
      return request<T>(path, init, false);
    }
    throw apiError;
  }

  return (await res.json()) as T;
}

function withPath(base: string, path?: string): string {
  if (path == null || path === "") return base;
  return `${base}?path=${encodeURIComponent(path)}`;
}

function sourcePath(id: string, suffix: string, path?: string): string {
  return withPath(`/api/sources/${encodeURIComponent(id)}${suffix}`, path);
}

export const api = {
  me: (opts: RequestOptions = {}) => request<MeResponse>("/api/auth/me", opts),

  login: (password: string, opts: RequestOptions = {}) =>
    request<Ok>("/api/auth/login", { method: "POST", body: { password }, ...opts }),

  logout: (opts: RequestOptions = {}) => request<Ok>("/api/auth/logout", { method: "POST", ...opts }),

  listSources: (opts: RequestOptions = {}) => request<{ sources: Source[] }>("/api/sources", opts),

  sourceSuggestions: (opts: RequestOptions = {}) =>
    request<{ paths: string[] }>("/api/sources/suggestions", opts),

  createSource: (body: CreateSource, opts: RequestOptions = {}) =>
    request<{ source: Source }>("/api/sources", { method: "POST", body, ...opts }),

  deleteSource: (id: string, opts: RequestOptions = {}) =>
    request<Ok>(`/api/sources/${encodeURIComponent(id)}`, { method: "DELETE", ...opts }),

  sourceTree: (id: string, path?: string, opts: RequestOptions = {}) =>
    request<{ path: string; entries: TreeEntry[] }>(sourcePath(id, "/tree", path), opts),

  sourceStills: (id: string, path?: string, opts: RequestOptions = {}) =>
    request<{ path: string; stills: Still[] }>(sourcePath(id, "/stills", path), opts),

  listServers: (opts: RequestOptions = {}) => request<{ servers: Server[] }>("/api/servers", opts),

  createServer: (body: { name: string; url: string }, opts: RequestOptions = {}) =>
    request<{ server: Server }>("/api/servers", { method: "POST", body, ...opts }),

  deleteServer: (id: string, opts: RequestOptions = {}) =>
    request<Ok>(`/api/servers/${encodeURIComponent(id)}`, { method: "DELETE", ...opts }),
};
