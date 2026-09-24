import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { resetClientForTests } from "../api/client";
import type { Source } from "../api/types";
import { PrefsProvider } from "../lib/prefs";
import { GalleryView } from "./GalleryView";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setControl(id: string, value: string) {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
    throw new Error(`missing control ${id}`);
  }
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("GalleryView SFTP source create", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    resetClientForTests();
    vi.unstubAllGlobals();
  });

  async function renderAndAdd(tree: (init: RequestInit | undefined) => Promise<Response>) {
    const sources: Source[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/sources/suggestions") return jsonResponse({ paths: [] });
      if (url === "/api/auth/csrf") return jsonResponse({ csrfToken: "token-1" });
      if (url === "/api/sources" && method === "GET") return jsonResponse({ sources });
      if (url === "/api/sources" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          host?: string;
          port?: number;
          username?: string;
          remotePath?: string;
          label?: string;
          password?: string;
        };
        const source: Source = {
          id: "src-new",
          type: "sftp",
          label: body.label || "nas.local",
          host: body.host,
          port: body.port ?? 22,
          username: body.username,
          remotePath: body.remotePath,
          hasPassword: Boolean(body.password),
          hasPrivateKey: false,
        };
        sources.push(source);
        return jsonResponse({ source }, 201);
      }
      if (url.includes("/tree")) return tree(init);
      return jsonResponse({ error: { code: "not_found", message: "not found" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <PrefsProvider>
          <GalleryView section="library" album={null} query="" showFullPhoto blurThumbs={false} chromeHidden={false} />
        </PrefsProvider>,
      );
    });
    await flush();

    const add = [...document.querySelectorAll("button")].find((button) => button.textContent === "Add source");
    if (!add) throw new Error("Add source was not shown");
    await act(async () => {
      add.click();
    });

    const sftp = [...document.querySelectorAll("label")].find((label) => label.textContent?.includes("SFTP"));
    if (!sftp) throw new Error("SFTP choice was not shown");
    await act(async () => {
      sftp.click();
    });
    await act(async () => {
      setControl("sftp-host", "nas.local");
      setControl("sftp-user", "sera");
      setControl("sftp-path", "/srv/stills");
      setControl("sftp-password", "pw");
      setControl("source-label", "studio-nas");
      document.querySelector("form")?.requestSubmit();
    });
    await flush();
    await flush();
  }

  it("lists the SFTP source as connected while the folder walk is still pending", async () => {
    await renderAndAdd(
      (init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const text = document.body.textContent ?? "";
    expect(text).toContain("studio-nas");
    expect(text).toContain("sera@nas.local/srv/stills");
    expect(text).toContain("Connected. Checking folders…");
    expect(text).not.toContain("Loading library");
  });

  it("shows a per-source error after create when the SFTP folder listing fails", async () => {
    await renderAndAdd(async () => jsonResponse({ error: { code: "io_error", message: "sftp request failed" } }, 502));

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("studio-nas: sftp request failed");
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("sera@nas.local/srv/stills");
    expect(text).not.toContain("Loading library");
  });

  it("says the source is connected when the SFTP folder is empty", async () => {
    await renderAndAdd(async () => jsonResponse({ path: "", entries: [] }));

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Connected. No photos in this source yet.");
    });
    expect(document.body.textContent).not.toContain("Loading library");
  });
});
