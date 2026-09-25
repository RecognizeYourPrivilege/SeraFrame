import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { NEW_WINDOW_FEATURES, type FeedItem } from "../lib/feed";
import { ImageFeed } from "./ImageFeed";
import { Lightbox } from "./Lightbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items: FeedItem[] = [
  { id: "1", name: "one.png", thumbUrl: "/t/1", fullUrl: "/full/1" },
  { id: "2", name: "two.png", thumbUrl: "/t/2", fullUrl: "/full/2" },
  { id: "3", name: "three.png", thumbUrl: "/t/3", fullUrl: "/full/3" },
];

function press(key: string, target?: Element) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (target ?? document).dispatchEvent(event);
  return event;
}

function Harness({ initial = null as number | null }: { initial?: number | null }) {
  const [index, setIndex] = useState<number | null>(initial);
  return (
    <>
      <input aria-label="Notes" />
      {index == null ? <ImageFeed items={items} onOpen={setIndex} /> : null}
      {index != null ? (
        <Lightbox items={items} index={index} onIndex={setIndex} onClose={() => setIndex(null)} />
      ) : null}
    </>
  );
}

describe("image feed and lightbox", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  async function render(initial?: number | null) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Harness initial={initial} />);
    });
  }

  it("opens the overlay from a feed thumb and stacks it above the feed", async () => {
    await render(null);
    const feed = document.querySelector(".image-feed");
    expect(feed).not.toBeNull();
    expect((feed as HTMLElement).style.zIndex).toBe("99");
    expect(document.querySelector("[role='dialog']")).toBeNull();

    press("ArrowRight");
    press("d");
    expect(document.querySelector("[role='dialog']")).toBeNull();

    const second = document.querySelector(".image-feed button[aria-label='Open two.png']");
    if (!(second instanceof HTMLButtonElement)) throw new Error("missing feed thumb");
    await act(async () => {
      second.click();
    });

    const dialog = document.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect((dialog as HTMLElement).style.zIndex).toBe("1001");
    expect(dialog?.textContent).toContain("two.png");
    expect(dialog?.textContent).toContain("2 / 3");
    expect(document.querySelector("[aria-label='Previous image']")).not.toBeNull();
    expect(document.querySelector("[aria-label='Next image']")).not.toBeNull();
  });

  it("steps with arrows and a/d only while open, and stops at the ends", async () => {
    await render(0);
    expect(document.querySelector("[aria-label='Previous image']")).toBeNull();
    expect(document.body.textContent).toContain("1 / 3");

    await act(async () => {
      press("ArrowLeft");
      press("a");
    });
    expect(document.body.textContent).toContain("1 / 3");
    expect(document.querySelector("[aria-label='Previous image']")).toBeNull();

    await act(async () => {
      press("ArrowRight");
    });
    expect(document.body.textContent).toContain("2 / 3");

    await act(async () => {
      press("d");
    });
    expect(document.body.textContent).toContain("3 / 3");
    expect(document.querySelector("[aria-label='Next image']")).toBeNull();

    await act(async () => {
      press("ArrowRight");
      press("d");
      press("A");
      press("D");
    });
    expect(document.body.textContent).toContain("3 / 3");
    expect(document.querySelector("[role='dialog']")).not.toBeNull();

    const prev = document.querySelector("[aria-label='Previous image']");
    if (!(prev instanceof HTMLButtonElement)) throw new Error("missing previous");
    await act(async () => {
      prev.click();
    });
    expect(document.body.textContent).toContain("2 / 3");
  });

  it("closes on Escape and ignores overlay keys when hidden or typing", async () => {
    await render(1);
    const notes = document.querySelector("input[aria-label='Notes']");
    if (!(notes instanceof HTMLInputElement)) throw new Error("missing notes");
    notes.focus();
    await act(async () => {
      press("ArrowRight", notes);
      press("a", notes);
      press("Escape", notes);
    });
    expect(document.body.textContent).toContain("2 / 3");
    expect(document.querySelector("[role='dialog']")).not.toBeNull();

    await act(async () => {
      notes.blur();
      press("Escape");
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();

    await act(async () => {
      press("ArrowRight");
      press("d");
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector(".image-feed")).not.toBeNull();
  });

  it("offers a new tab and a new window for the current image", async () => {
    const open = vi.fn(() => ({ opener: {} }) as unknown as Window);
    vi.spyOn(window, "open").mockImplementation(open as typeof window.open);
    await render(1);

    const tab = document.querySelector("a[href='/full/2']");
    if (!(tab instanceof HTMLAnchorElement)) throw new Error("missing new tab link");
    expect(tab.target).toBe("_blank");
    expect(tab.rel).toContain("noopener");
    expect(tab.textContent).toContain("Open in new tab");

    const windowButton = [...document.querySelectorAll("button")].find((button) => button.textContent === "Open in new window");
    if (!windowButton) throw new Error("missing new window button");
    await act(async () => {
      windowButton.click();
    });
    expect(open).toHaveBeenCalledWith("/full/2", "_blank", NEW_WINDOW_FEATURES);
  });

  it("pinch-zooms the image, and still swipes and closes from the scrim at fitted size", async () => {
    await render(0);
    const image = document.querySelector(".lightbox-stage img");
    const stage = document.querySelector(".lightbox-stage");
    if (!(image instanceof HTMLImageElement) || !(stage instanceof HTMLElement)) throw new Error("missing image");

    await act(async () => {
      touch(image, "touchstart", [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 100, y: 0 },
      ]);
      touch(image, "touchmove", [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 200, y: 0 },
      ]);
      touch(image, "touchend", [], [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 200, y: 0 },
      ]);
    });
    expect(image.style.transform).toBe("scale(2)");
    expect(document.body.textContent).toContain("1 / 3");

    await act(async () => {
      touch(image, "touchstart", [{ id: 1, x: 200, y: 40 }]);
      touch(image, "touchmove", [{ id: 1, x: 80, y: 40 }]);
      touch(image, "touchend", [], [{ id: 1, x: 80, y: 40 }]);
    });
    expect(document.body.textContent).toContain("1 / 3");
    expect(image.style.transform).toContain("scale(2)");

    await act(async () => {
      touch(image, "touchstart", [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 200, y: 0 },
      ]);
      touch(image, "touchmove", [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 100, y: 0 },
      ]);
      touch(image, "touchend", [], [{ id: 2, x: 100, y: 0 }]);
    });
    expect(image.style.transform).toBe("");
    expect(document.body.textContent).toContain("1 / 3");

    await act(async () => {
      touch(image, "touchstart", [{ id: 1, x: 180, y: 80 }]);
      touch(image, "touchend", [], [{ id: 1, x: 40, y: 90 }]);
    });
    expect(document.body.textContent).toContain("2 / 3");
    expect(document.querySelector(".lightbox-stage img")?.getAttribute("style")).toBeNull();

    const scrim = document.querySelector(".lightbox-scrim");
    if (!(scrim instanceof HTMLButtonElement)) throw new Error("missing scrim");
    await act(async () => {
      scrim.click();
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector(".image-feed")).not.toBeNull();
  });
});

function touch(
  target: Element,
  type: "touchstart" | "touchmove" | "touchend",
  points: { id: number; x: number; y: number }[],
  changed = points,
) {
  const toTouch = (point: { id: number; x: number; y: number }) =>
    new Touch({ identifier: point.id, target, clientX: point.x, clientY: point.y });
  target.dispatchEvent(
    new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: points.map(toTouch),
      changedTouches: changed.map(toTouch),
    }),
  );
}
