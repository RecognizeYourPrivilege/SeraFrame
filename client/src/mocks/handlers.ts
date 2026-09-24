import { http, HttpResponse } from "msw";
import type { CreateSource, Server, Source } from "../api/types";
import {
  DEMO_PASSWORD,
  SUGGESTED_PATHS,
  findNode,
  hasStill,
  rejectedPath,
  seedLibrary,
  seedServers,
  seedSources,
  stillsIn,
  treeEntries,
  type MockNode,
} from "./data";
import { renderStill } from "./images";

let authed = false;
let csrfToken: string | null = null;
let failures = 0;
let lockedUntil = 0;
let sources: Source[] = seedSources();
let servers: Server[] = seedServers();
let library: Record<string, MockNode> = seedLibrary();

function error(status: number, code: string, message: string, headers?: HeadersInit) {
  return HttpResponse.json({ error: { code, message } }, { status, headers });
}

function requireAuth() {
  if (!authed) return error(401, "unauthorized", "Not signed in.");
  return null;
}

function requireCsrf(request: Request) {
  const header = request.headers.get("X-CSRF-Token");
  if (!csrfToken || !header || header !== csrfToken) {
    return error(403, "csrf", "CSRF token missing or mismatched.");
  }
  return null;
}

function issueCsrf() {
  csrfToken = crypto.randomUUID().replaceAll("-", "");
  if (typeof document !== "undefined") {
    document.cookie = `seraframe_csrf=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax`;
  }
  return csrfToken;
}

function guardPath(relPath: string) {
  if (rejectedPath(relPath)) return error(400, "path_rejected", "Path rejected.");
  return null;
}

function buildSource(body: CreateSource): { source: Source } | { error: Response } {
  if (body.type === "local") {
    const rootPath = (body.rootPath ?? "").trim();
    if (!rootPath) return { error: error(400, "validation", "rootPath is required.") };
    if (rootPath.includes("\0")) return { error: error(400, "path_rejected", "Path rejected.") };
    const label = body.label?.trim() || rootPath.split("/").filter(Boolean).pop() || rootPath;
    return { source: { id: crypto.randomUUID(), type: "local", label, rootPath } };
  }
  if (body.type !== "sftp") {
    return { error: error(400, "validation", "Unknown source type.") };
  }
  const host = (body.host ?? "").trim();
  const username = (body.username ?? "").trim();
  const remotePath = (body.remotePath ?? "").trim();
  if (!host || !username || !remotePath) {
    return { error: error(400, "validation", "host, username, and remotePath are required.") };
  }
  if (!body.password && !body.privateKey?.trim()) {
    return { error: error(400, "validation", "password or privateKey is required.") };
  }
  if (body.port != null && (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535)) {
    return { error: error(400, "validation", "port must be from 1 to 65535.") };
  }
  const label = body.label?.trim() || host;
  return {
    source: {
      id: crypto.randomUUID(),
      type: "sftp",
      label,
      host,
      port: body.port ?? 22,
      username,
      remotePath,
      hasPassword: Boolean(body.password),
      hasPrivateKey: Boolean(body.privateKey?.trim()),
    },
  };
}

function media(kind: "thumb" | "full") {
  return ({
    request,
    params,
  }: {
    request: Request;
    params: Record<string, string | readonly string[] | undefined>;
  }) => {
    const denied = requireAuth();
    if (denied) return denied;
    const sourceId = String(params.sourceId);
    const relPath = new URL(request.url).searchParams.get("path") ?? "";
    const rejected = guardPath(relPath);
    if (rejected) return rejected;
    const root = library[sourceId];
    if (!root || !hasStill(root, relPath)) return error(404, "not_found", "Still not found.");
    const svg = renderStill(relPath, kind === "thumb" ? "thumb" : "full");
    return new HttpResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "private, max-age=60",
      },
    });
  };
}

export const handlers = [
  http.get("/api/auth/csrf", () => HttpResponse.json({ csrfToken: issueCsrf() })),

  http.get("/api/auth/me", () => {
    if (!authed) return error(401, "unauthorized", "Not signed in.");
    return HttpResponse.json({ authenticated: true });
  }),

  http.post("/api/auth/login", async ({ request }) => {
    const csrfError = requireCsrf(request);
    if (csrfError) return csrfError;
    const now = Date.now();
    if (now < lockedUntil) {
      const seconds = Math.max(1, Math.ceil((lockedUntil - now) / 1000));
      return error(429, "locked_out", "Too many attempts.", { "Retry-After": String(seconds) });
    }
    const body = (await request.json()) as { password?: string };
    if (body.password !== DEMO_PASSWORD) {
      failures += 1;
      if (failures >= 5) {
        failures = 0;
        lockedUntil = Date.now() + 30_000;
        return error(429, "locked_out", "Too many attempts.", { "Retry-After": "30" });
      }
      return error(401, "unauthorized", "Wrong password.");
    }
    failures = 0;
    authed = true;
    return HttpResponse.json({ ok: true });
  }),

  http.post("/api/auth/logout", ({ request }) => {
    const csrfError = requireCsrf(request);
    if (csrfError) return csrfError;
    authed = false;
    return HttpResponse.json({ ok: true });
  }),

  http.get("/api/sources/suggestions", () => {
    const denied = requireAuth();
    if (denied) return denied;
    return HttpResponse.json({ paths: SUGGESTED_PATHS });
  }),

  http.get("/api/sources", () => {
    const denied = requireAuth();
    if (denied) return denied;
    return HttpResponse.json({ sources });
  }),

  http.post("/api/sources", async ({ request }) => {
    const denied = requireAuth() ?? requireCsrf(request);
    if (denied) return denied;
    const body = (await request.json()) as CreateSource;
    const created = buildSource(body);
    if ("error" in created) return created.error;
    sources = [...sources, created.source];
    library[created.source.id] = { stills: [], dirs: [] };
    return HttpResponse.json({ source: created.source }, { status: 201 });
  }),

  http.delete("/api/sources/:id", ({ params, request }) => {
    const denied = requireAuth() ?? requireCsrf(request);
    if (denied) return denied;
    const id = String(params.id);
    if (!sources.some((source) => source.id === id)) return error(404, "not_found", "Source not found.");
    sources = sources.filter((source) => source.id !== id);
    delete library[id];
    return HttpResponse.json({ ok: true });
  }),

  http.get("/api/sources/:id/tree", ({ params, request }) => {
    const denied = requireAuth();
    if (denied) return denied;
    const id = String(params.id);
    const root = library[id];
    if (!root || !sources.some((source) => source.id === id)) {
      return error(404, "not_found", "Source not found.");
    }
    const path = new URL(request.url).searchParams.get("path") ?? "";
    const rejected = guardPath(path);
    if (rejected) return rejected;
    const node = findNode(root, path);
    if (!node) return error(404, "not_found", "Folder not found.");
    return HttpResponse.json({ path, entries: treeEntries(node, path) });
  }),

  http.get("/api/sources/:id/stills", ({ params, request }) => {
    const denied = requireAuth();
    if (denied) return denied;
    const id = String(params.id);
    const root = library[id];
    if (!root || !sources.some((source) => source.id === id)) {
      return error(404, "not_found", "Source not found.");
    }
    const path = new URL(request.url).searchParams.get("path") ?? "";
    const rejected = guardPath(path);
    if (rejected) return rejected;
    const node = findNode(root, path);
    if (!node) return error(404, "not_found", "Folder not found.");
    return HttpResponse.json({ path, stills: stillsIn(id, node, path) });
  }),

  http.get("/api/servers", () => {
    const denied = requireAuth();
    if (denied) return denied;
    return HttpResponse.json({ servers });
  }),

  http.post("/api/servers", async ({ request }) => {
    const denied = requireAuth() ?? requireCsrf(request);
    if (denied) return denied;
    const body = (await request.json()) as { name?: string; url?: string };
    const name = body.name?.trim() ?? "";
    const url = body.url?.trim() ?? "";
    if (!name) return error(400, "validation", "name is required.");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return error(400, "validation", "url must be http or https.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return error(400, "validation", "url must be http or https.");
    }
    const server: Server = { id: crypto.randomUUID(), name, url: parsed.href };
    servers = [...servers, server];
    return HttpResponse.json({ server }, { status: 201 });
  }),

  http.delete("/api/servers/:id", ({ params, request }) => {
    const denied = requireAuth() ?? requireCsrf(request);
    if (denied) return denied;
    const id = String(params.id);
    if (!servers.some((server) => server.id === id)) return error(404, "not_found", "Server not found.");
    servers = servers.filter((server) => server.id !== id);
    return HttpResponse.json({ ok: true });
  }),

  http.get("/api/media/:sourceId/thumb", media("thumb")),
  http.get("/api/media/:sourceId/full", media("full")),
];
