import { describe, expect, it, vi } from "vitest";
import {
  NEW_WINDOW_FEATURES,
  isEditableKeyTarget,
  openImageInNewWindow,
  overlayKeyAction,
  stepIndex,
  stillToFeedItem,
} from "./feed";

describe("feed sequence", () => {
  it("stops at the ends and does not wrap", () => {
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(1, 3, -1)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBe(2);
    expect(stepIndex(1, 3, 1)).toBe(2);
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });

  it("maps a still into a feed frame in caller order", () => {
    expect(
      stillToFeedItem({
        sourceId: "src",
        relPath: "portraits/a.png",
        name: "a.png",
        thumbUrl: "/api/media/src/thumb?path=portraits%2Fa.png",
        fullUrl: "/api/media/src/full?path=portraits%2Fa.png",
      }),
    ).toEqual({
      id: "src:portraits/a.png",
      name: "a.png",
      thumbUrl: "/api/media/src/thumb?path=portraits%2Fa.png",
      fullUrl: "/api/media/src/full?path=portraits%2Fa.png",
    });
  });
});

describe("overlay keys", () => {
  it("steps and closes only while the overlay is open", () => {
    expect(overlayKeyAction("ArrowLeft", true)).toBe("prev");
    expect(overlayKeyAction("a", true)).toBe("prev");
    expect(overlayKeyAction("ArrowRight", true)).toBe("next");
    expect(overlayKeyAction("d", true)).toBe("next");
    expect(overlayKeyAction("Escape", true)).toBe("close");
    expect(overlayKeyAction("A", true)).toBeNull();
    expect(overlayKeyAction("D", true)).toBeNull();
    expect(overlayKeyAction("ArrowUp", true)).toBeNull();
  });

  it("no-ops when the overlay is hidden", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "a", "d", "Escape"]) {
      expect(overlayKeyAction(key, false)).toBeNull();
    }
  });

  it("treats text fields as editable so keys are not stolen", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const button = document.createElement("button");
    expect(isEditableKeyTarget(input)).toBe(true);
    expect(isEditableKeyTarget(area)).toBe(true);
    expect(isEditableKeyTarget(select)).toBe(true);
    expect(isEditableKeyTarget(editable)).toBe(true);
    expect(isEditableKeyTarget(button)).toBe(false);
    expect(isEditableKeyTarget(null)).toBe(false);
  });
});

describe("open in a new window", () => {
  it("requests a popup window for the image URL", () => {
    const open = vi.fn(() => ({ opener: {} }) as unknown as Window);
    openImageInNewWindow("/api/media/src/full?path=a.png", open as unknown as typeof window.open);
    expect(open).toHaveBeenCalledWith("/api/media/src/full?path=a.png", "_blank", NEW_WINDOW_FEATURES);
  });
});
