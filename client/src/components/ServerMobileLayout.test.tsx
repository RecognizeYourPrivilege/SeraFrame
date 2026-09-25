import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetClientForTests } from "../api/client";
import { DEFAULT_PREFS, PREFS_KEY, writePrefs, type MobileLayout } from "../lib/prefs";
import { AppShell } from "./AppShell";
import { PrefsProvider } from "../lib/prefs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubViewport(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const matches = phone ? query.includes("max-width: 768px") : query.includes("min-width: 840px");
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("connected server mobile layout", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    localStorage.clear();
    window.location.hash = "#/library";
    resetClientForTests();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.mobileLayout;
  });

  async function render(layout: MobileLayout, phone: boolean) {
    writePrefs({ ...DEFAULT_PREFS, mobileLayout: layout }, localStorage);
    stubViewport(phone);
    window.location.hash = "#/server/srv-1";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/servers") {
          return jsonResponse({ servers: [{ id: "srv-1", name: "Comfy", url: "about:blank" }] });
        }
        return jsonResponse({ error: { code: "not_found", message: "not found" } }, 404);
      }),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <PrefsProvider>
          <AppShell />
        </PrefsProvider>,
      );
    });
    await flush();
  }

  it("uses option 1 on a phone server view and keeps a later choice across remount", async () => {
    await render(1, true);
    const shell = document.querySelector(".shell");
    expect(shell?.className).toContain("is-layout-1");
    expect(shell?.className).not.toContain("is-immersive");
    expect(document.querySelector(".mobile-tabbar")).not.toBeNull();
    expect(document.documentElement.dataset.mobileLayout).toBe("1");
    expect(document.body.textContent).toContain("Zoom in");
    expect(document.body.textContent).toContain("Zoom out");

    act(() => {
      root?.unmount();
    });
    host?.remove();
    await render(2, true);
    expect(document.querySelector(".shell")?.className).toContain("is-layout-2");
    expect(document.querySelector(".mobile-tabbar")).toBeNull();
    expect(document.querySelector("[aria-label='Open menu']")).not.toBeNull();
    expect(document.documentElement.dataset.mobileLayout).toBe("2");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({ mobileLayout: 2 });

    act(() => {
      root?.unmount();
    });
    host?.remove();
    await render(2, true);
    expect(document.querySelector(".shell")?.className).toContain("is-layout-2");
    expect(document.querySelector(".mobile-tabbar")).toBeNull();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({ mobileLayout: 2 });
  });

  it("keeps desktop server chrome immersive without rewriting Mobile layout", async () => {
    await render(3, false);
    expect(document.querySelector(".shell")?.className).toContain("is-immersive");
    expect(document.querySelector(".mobile-tabbar")).toBeNull();
    expect(document.documentElement.dataset.mobileLayout).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({ mobileLayout: 3 });
  });
});
