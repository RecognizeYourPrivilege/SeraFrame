import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, resetClientForTests, setUnauthorizedHandler } from "./client";
import { ApiError } from "./errors";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetClientForTests();
    document.cookie = "seraframe_csrf=; Max-Age=0; Path=/";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send a CSRF header on GET /api/auth/me", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: true }));
    await api.me();
    const init = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/me");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBeNull();
    expect(init?.credentials).toBe("same-origin");
  });

  it("loads a CSRF token and sends it on login", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-1" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.login("secret");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/csrf");
    const loginInit = fetchMock.mock.calls[1]?.[1];
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/login");
    expect(loginInit?.method).toBe("POST");
    expect(new Headers(loginInit?.headers).get("X-CSRF-Token")).toBe("token-1");
    expect(loginInit?.body).toBe(JSON.stringify({ password: "secret" }));
  });

  it("reuses the cached CSRF token for a later mutation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-1" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.login("secret");
    await api.logout();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const logoutInit = fetchMock.mock.calls[2]?.[1];
    expect(new Headers(logoutInit?.headers).get("X-CSRF-Token")).toBe("token-1");
  });

  it("uses the seraframe_csrf cookie when no token is cached", async () => {
    document.cookie = "seraframe_csrf=from-cookie; Path=/";
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.logout();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("from-cookie");
  });

  it("refetches CSRF once after a csrf error and does not reuse the stale cookie", async () => {
    document.cookie = "seraframe_csrf=stale; Path=/";
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "csrf", message: "csrf token missing or invalid" } }, 403),
      )
      .mockImplementationOnce(async () => {
        document.cookie = "seraframe_csrf=fresh; Path=/";
        return jsonResponse({ csrfToken: "fresh" });
      })
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.logout();

    expect(fetchMock.mock.calls.map((call) => [call[0], call[1]?.method ?? "GET"])).toEqual([
      ["/api/auth/logout", "POST"],
      ["/api/auth/csrf", "GET"],
      ["/api/auth/logout", "POST"],
    ]);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-CSRF-Token")).toBe("stale");
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("X-CSRF-Token")).toBe("fresh");
  });

  it("parses error code, message, and Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "locked_out", message: "Too many attempts." } }, 429, {
        "Retry-After": "30",
      }),
    );

    await expect(api.me()).rejects.toMatchObject({
      name: "ApiError",
      status: 429,
      code: "locked_out",
      message: "Too many attempts.",
      retryAfter: 30,
    } satisfies Partial<ApiError>);
  });

  it("changes the password with the current and new values and a CSRF header", async () => {
    document.cookie = "seraframe_csrf=from-cookie; Path=/";
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.changePassword({ currentPassword: "old", newPassword: "new-secret" });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/change-password");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ currentPassword: "old", newPassword: "new-secret" }));
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("from-cookie");
  });

  it("keeps the session when change-password rejects the current password", async () => {
    document.cookie = "seraframe_csrf=from-cookie; Path=/";
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "unauthorized", message: "current password is incorrect" } }, 401),
    );

    await expect(api.changePassword({ currentPassword: "nope", newPassword: "next" })).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "current password is incorrect",
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("signs out when change-password reports the session is gone", async () => {
    document.cookie = "seraframe_csrf=from-cookie; Path=/";
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "unauthorized", message: "authentication required" } }, 401),
    );

    await expect(api.changePassword({ currentPassword: "old", newPassword: "next" })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("lists sessions without a CSRF header and deletes another session with one", async () => {
    document.cookie = "seraframe_csrf=from-cookie; Path=/";
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sessions: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.listSessions();
    await api.revokeSession("id/with space");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/sessions");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-CSRF-Token")).toBeNull();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/sessions/id%2Fwith%20space");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("X-CSRF-Token")).toBe("from-cookie");
  });

  it("reads prefs and puts appearance without feature toggles", async () => {
    document.cookie = "seraframe_csrf=from-cookie; Path=/";
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ appearance: null, firstRunAppearanceDone: false }))
      .mockResolvedValueOnce(jsonResponse({ appearance: "dark", firstRunAppearanceDone: true }))
      .mockResolvedValueOnce(jsonResponse({ appearance: "light", firstRunAppearanceDone: true }));

    await expect(api.getPrefs()).resolves.toEqual({ appearance: null, firstRunAppearanceDone: false });
    await api.putPrefs({ appearance: "dark", firstRunAppearanceDone: true });
    await api.putPrefs({ appearance: "light" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/prefs");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-CSRF-Token")).toBeNull();
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ appearance: "dark", firstRunAppearanceDone: true }),
    );
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ appearance: "light" }));
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("X-CSRF-Token")).toBe("from-cookie");
  });

  it("notifies the unauthorized handler on 401", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "unauthorized", message: "Not signed in." } }, 401),
    );

    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("encodes source id and folder path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ path: "a/b", stills: [] }));
    await api.sourceStills("id/with space", "portraits/a.png");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/sources/id%2Fwith%20space/stills?path=portraits%2Fa.png",
    );
  });

  it("posts a create-source body unchanged", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token-1" }))
      .mockResolvedValueOnce(jsonResponse({ source: { id: "1", type: "local", label: "out" } }, 201));

    await api.createSource({ type: "local", rootPath: "/opt/comfyui_output" });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ type: "local", rootPath: "/opt/comfyui_output" }),
    );
  });
});
