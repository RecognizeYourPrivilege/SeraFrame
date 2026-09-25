import type { Still } from "../api/types";

/** One frame in the shared gallery / server image feed. */
export type FeedItem = {
  id: string;
  name: string;
  thumbUrl: string;
  fullUrl: string;
};

export type OverlayKeyAction = "prev" | "next" | "close";

/** Features string that asks the browser for a separate window (not only a tab). */
export const NEW_WINDOW_FEATURES = "popup=yes,width=1280,height=900";

export function stillToFeedItem(still: Still): FeedItem {
  return {
    id: `${still.sourceId}:${still.relPath}`,
    name: still.name,
    thumbUrl: still.thumbUrl,
    fullUrl: still.fullUrl,
  };
}

/** Step within a sequence. Stops at the first and last image (no wrap). */
export function stepIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  if (delta < 0) return index <= 0 ? index : index - 1;
  if (delta > 0) return index >= length - 1 ? index : index + 1;
  return index;
}

/**
 * Keys that move or close the fullscreen overlay.
 * Returns null when the overlay is hidden so the caller no-ops
 * (there is no bottom-feed keyboard navigation).
 * Lowercase `a` / `d` only, matching pysssss Image Feed.
 */
export function overlayKeyAction(key: string, overlayOpen: boolean): OverlayKeyAction | null {
  if (!overlayOpen) return null;
  if (key === "ArrowLeft" || key === "a") return "prev";
  if (key === "ArrowRight" || key === "d") return "next";
  if (key === "Escape") return "close";
  return null;
}

/** Text fields keep Left/Right, a/d, and Escape (NFR-01). */
export function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") != null;
}

export function openImageInNewWindow(url: string, openImpl: typeof window.open = window.open.bind(window)): void {
  const child = openImpl(url, "_blank", NEW_WINDOW_FEATURES);
  if (child) child.opener = null;
}
