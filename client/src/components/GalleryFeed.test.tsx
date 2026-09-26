import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetClientForTests } from "../api/client";
import type { Still } from "../api/types";
import { PrefsProvider } from "../lib/prefs";
import { GalleryView } from "./GalleryView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stills: Still[] = [
  { sourceId: "src", relPath: "portraits/a.png", name: "a.png", thumbUrl: "/t/a", fullUrl: "/f/a" },
  { sourceId: "src", relPath: "portraits/b.png", name: "b.png", thumbUrl: "/t/b", fullUrl: "/f/b" },
  { sourceId: "src", relPath: "portraits/c.png", name: "c.png", thumbUrl: "/t/c", fullUrl: "/f/c" },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("gallery feed order", () => {
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

  async function render(query = "", showFullPhoto = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/sources") return jsonResponse({ sources: [] });
        if (url.includes("/stills")) return jsonResponse({ path: "portraits", stills });
        if (url.includes("/tree")) return jsonResponse({ path: "", entries: [] });
        return jsonResponse({ error: { code: "not_found", message: "not found" } }, 404);
      }),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <PrefsProvider>
          <GalleryView
            section="albums"
            album={{ sourceId: "src", path: "portraits" }}
            query={query}
            showFullPhoto={showFullPhoto}
            blurThumbs={false}
            chromeHidden={false}
          />
        </PrefsProvider>,
      );
    });
    await flush();
  }

  function feedLabels(): string[] {
    return [...document.querySelectorAll(".image-feed button")].map((button) => button.getAttribute("aria-label") ?? "");
  }

  it("uses the current album order and opens that frame", async () => {
    await render();
    expect(feedLabels()).toEqual(["Open a.png", "Open b.png", "Open c.png"]);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.querySelector("[role='dialog']")).toBeNull();

    const thumb = document.querySelector(".image-feed button[aria-label='Open b.png']");
    if (!(thumb instanceof HTMLButtonElement)) throw new Error("missing b.png");
    await act(async () => {
      thumb.click();
    });
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog?.textContent).toContain("b.png");
    expect(dialog?.textContent).toContain("2 / 3");
    expect(document.querySelector(".image-feed")).not.toBeNull();
    expect((dialog as HTMLElement).style.zIndex).toBe("1001");
  });

  it("follows the active filter", async () => {
    await render("c.png");
    expect(feedLabels()).toEqual(["Open c.png"]);
    const thumb = document.querySelector(".image-feed button");
    if (!(thumb instanceof HTMLButtonElement)) throw new Error("missing filtered thumb");
    await act(async () => {
      thumb.click();
    });
    expect(document.body.textContent).toContain("1 / 1");
    expect(document.querySelector("[aria-label='Previous image']")).toBeNull();
    expect(document.querySelector("[aria-label='Next image']")).toBeNull();
  });

  it("keeps the bottom feed and contain-fits the viewer even when thumbs crop", async () => {
    await render("", false);
    expect(document.querySelector(".image-feed")).not.toBeNull();
    expect(document.querySelector(".stage.gallery.has-image-feed")).not.toBeNull();
    expect(document.querySelector(".thumb.is-contain")).toBeNull();

    const thumb = document.querySelector(".image-feed button");
    if (!(thumb instanceof HTMLButtonElement)) throw new Error("missing feed thumb");
    await act(async () => {
      thumb.click();
    });
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog?.classList.contains("is-contain")).toBe(true);
    expect(dialog?.classList.contains("is-cover")).toBe(false);
    expect(document.querySelector(".image-feed")).not.toBeNull();
  });
});
