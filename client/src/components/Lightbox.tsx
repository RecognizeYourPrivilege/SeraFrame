import { useEffect, useId, useRef, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import {
  isEditableKeyTarget,
  openImageInNewWindow,
  overlayKeyAction,
  stepIndex,
  type FeedItem,
} from "../lib/feed";

type LightboxProps = {
  items: FeedItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** When false the key handler no-ops. Unmounting the overlay does the same. */
  open?: boolean;
  fit?: "cover" | "contain";
};

export function Lightbox({ items, index, onIndex, onClose, open = true, fit = "contain" }: LightboxProps) {
  const item = items[index];
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const openRef = useRef(open);
  const indexRef = useRef(index);
  const lengthRef = useRef(items.length);
  const onIndexRef = useRef(onIndex);
  const onCloseRef = useRef(onClose);
  openRef.current = open;
  indexRef.current = index;
  lengthRef.current = items.length;
  onIndexRef.current = onIndex;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    if (root) root.inert = true;
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (root) root.inert = false;
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!openRef.current) return;
      if (isEditableKeyTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const action = overlayKeyAction(event.key, true);
      if (!action) return;
      event.preventDefault();
      if (action === "close") {
        onCloseRef.current();
        return;
      }
      const delta = action === "prev" ? -1 : 1;
      const next = stepIndex(indexRef.current, lengthRef.current, delta);
      if (next !== indexRef.current) onIndexRef.current(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!open || !item) return null;

  const atStart = index <= 0;
  const atEnd = index >= items.length - 1;

  function step(delta: number) {
    const next = stepIndex(index, items.length, delta);
    if (next !== index) onIndex(next);
  }

  function onTouchStart(event: TouchEvent) {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    step(dx < 0 ? 1 : -1);
  }

  return createPortal(
    <div
      ref={panelRef}
      className={fit === "contain" ? "lightbox is-contain" : "lightbox is-cover"}
      style={{ zIndex: 1001 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Tab") trapTab(event.nativeEvent, panelRef.current);
      }}
    >
      <button type="button" className="lightbox-scrim" aria-label="Close preview" tabIndex={-1} onClick={onClose} />
      <div className="lightbox-ui">
        <button type="button" className="btn lightbox-close" onClick={onClose}>
          Close
        </button>
        {atStart ? null : (
          <button type="button" className="icon-btn lightbox-chevron is-prev" aria-label="Previous image" onClick={() => step(-1)}>
            <ChevronIcon direction="prev" />
          </button>
        )}
        {atEnd ? null : (
          <button type="button" className="icon-btn lightbox-chevron is-next" aria-label="Next image" onClick={() => step(1)}>
            <ChevronIcon direction="next" />
          </button>
        )}
        <div className="lightbox-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <img className="full" src={item.fullUrl} alt={item.name} decoding="async" draggable={false} />
        </div>
        <div className="lightbox-bar">
          <h2 id={titleId} className="lightbox-title">
            {item.name}
          </h2>
          <p className="pos">
            {index + 1} / {items.length}
          </p>
          <a className="btn" href={item.fullUrl} target="_blank" rel="noopener noreferrer">
            Open in new tab
          </a>
          <button type="button" className="btn" onClick={() => openImageInNewWindow(item.fullUrl)}>
            Open in new window
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChevronIcon({ direction }: { direction: "prev" | "next" }) {
  const d = direction === "prev" ? "M14.5 5.5 8 12l6.5 6.5" : "M9.5 5.5 16 12l-6.5 6.5";
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function trapTab(event: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const items = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.tabIndex >= 0 && el.getAttribute("aria-label") !== "Close preview");
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
