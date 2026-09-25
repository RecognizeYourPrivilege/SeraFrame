import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "../api/types";
import { DEFAULT_PREFS, PREFS_KEY, writePrefs } from "../lib/prefs";
import { ServerFrame } from "./ServerFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const server: Server = { id: "srv-1", name: "Comfy", url: "about:blank" };

function zoomNode(): HTMLElement {
  const node = document.querySelector(".frame-zoom");
  if (!(node instanceof HTMLElement)) throw new Error("missing embed zoom");
  return node;
}

describe("embed zoom", () => {
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
  });

  async function render(id = "a") {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <ServerFrame key={id} server={{ ...server, id }} onLeave={() => undefined} onConnectionChange={() => undefined} />,
      );
    });
  }

  it("scales the iframe viewport and leaves the embed bar unscaled", async () => {
    await render();
    expect(zoomNode().style.transform).toBe("scale(1)");
    expect(zoomNode().dataset.embedZoom).toBe("100");
    expect(document.querySelector(".embed-bar")?.getAttribute("style")).toBeNull();

    const zoomIn = [...document.querySelectorAll("button")].find((button) => button.textContent === "Zoom in");
    const zoomOut = [...document.querySelectorAll("button")].find((button) => button.textContent === "Zoom out");
    if (!zoomIn || !zoomOut) throw new Error("missing zoom controls");

    await act(async () => {
      zoomIn.click();
    });
    expect(zoomNode().style.transform).toBe("scale(1.25)");
    expect(zoomNode().style.width).toBe("80%");
    expect(zoomNode().style.height).toBe("80%");
    expect(document.querySelector(".embed-bar")?.getAttribute("style")).toBeNull();
    expect(document.body.textContent).toContain("125%");

    await act(async () => {
      zoomOut.click();
      zoomOut.click();
    });
    expect(zoomNode().style.transform).toBe("scale(0.75)");
  });

  it("resets zoom on remount and does not change Mobile layout", async () => {
    writePrefs({ ...DEFAULT_PREFS, mobileLayout: 3 }, localStorage);
    await render("srv-1");
    const zoomIn = [...document.querySelectorAll("button")].find((button) => button.textContent === "Zoom in");
    if (!zoomIn) throw new Error("missing zoom in");
    await act(async () => {
      zoomIn.click();
    });
    expect(zoomNode().dataset.embedZoom).toBe("125");

    await act(async () => {
      root?.render(
        <ServerFrame key="srv-2" server={{ ...server, id: "srv-2" }} onLeave={() => undefined} onConnectionChange={() => undefined} />,
      );
    });
    expect(zoomNode().dataset.embedZoom).toBe("100");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({ mobileLayout: 3 });
    vi.unstubAllGlobals();
  });
});
