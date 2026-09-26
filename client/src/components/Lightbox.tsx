import { useEffect, useId, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import {
  isEditableKeyTarget,
  openImageInNewWindow,
  overlayKeyAction,
  stepIndex,
  type FeedItem,
} from "../lib/feed";
import {
  FITTED_VIEW,
  ZOOM_SWIPE,
  nextPan,
  nextPinchScale,
  swipeStep,
  touchDistance,
  type ZoomView,
} from "../lib/lightboxZoom";

type LightboxProps = {
  items: FeedItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** When false the key handler no-ops. Unmounting the overlay does the same. */
  open?: boolean;
};

export function Lightbox({ items, index, onIndex, onClose, open = true }: LightboxProps) {
  const item = items[index];
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ZoomView>(FITTED_VIEW);
  const viewRef = useRef(view);
  const gesture = useRef<PinchGesture | null>(null);
  viewRef.current = view;
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
    viewRef.current = FITTED_VIEW;
    setView(FITTED_VIEW);
    gesture.current = null;
  }, [item?.id]);

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

  function stageBounds(): { width: number; height: number } {
    const rect = stageRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }

  function applyView(next: ZoomView) {
    const fitted = next.scale <= ZOOM_SWIPE ? FITTED_VIEW : next;
    viewRef.current = fitted;
    setView(fitted);
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length >= 2) {
      const first = event.touches[0];
      const second = event.touches[1];
      if (!first || !second) return;
      gesture.current = {
        pinched: true,
        startX: first.clientX,
        startY: first.clientY,
        startDistance: touchDistance(point(first), point(second)),
        startScale: viewRef.current.scale,
        originX: viewRef.current.x,
        originY: viewRef.current.y,
      };
      return;
    }
    if (gesture.current?.pinched) return;
    const touch = event.touches[0];
    if (!touch) return;
    gesture.current = {
      pinched: false,
      startX: touch.clientX,
      startY: touch.clientY,
      startDistance: 0,
      startScale: viewRef.current.scale,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
    };
  }

  function onTouchMove(event: TouchEvent) {
    const current = gesture.current;
    if (!current) return;
    if (event.touches.length >= 2) {
      const first = event.touches[0];
      const second = event.touches[1];
      if (!first || !second) return;
      current.pinched = true;
      if (!(current.startDistance > 0)) {
        current.startDistance = touchDistance(point(first), point(second));
        current.startScale = viewRef.current.scale;
        return;
      }
      const scale = nextPinchScale(current.startScale, current.startDistance, touchDistance(point(first), point(second)));
      const pan = nextPan({ x: current.originX, y: current.originY }, 0, 0, scale, stageBounds());
      applyView({ scale, x: pan.x, y: pan.y });
      return;
    }
    if (current.pinched || !(viewRef.current.scale > ZOOM_SWIPE)) return;
    const touch = event.touches[0];
    if (!touch) return;
    const pan = nextPan(
      { x: current.originX, y: current.originY },
      touch.clientX - current.startX,
      touch.clientY - current.startY,
      viewRef.current.scale,
      stageBounds(),
    );
    applyView({ scale: viewRef.current.scale, x: pan.x, y: pan.y });
  }

  function onTouchEnd(event: TouchEvent) {
    const current = gesture.current;
    if (!current) return;
    if (event.touches.length > 0) return;
    gesture.current = null;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const delta = swipeStep(touch.clientX - current.startX, touch.clientY - current.startY, viewRef.current.scale, current.pinched);
    if (delta !== 0) step(delta);
  }

  return createPortal(
    <div
      ref={panelRef}
      className="lightbox is-contain"
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
        <div className="lightbox-stage" ref={stageRef}>
          <img
            className="full"
            src={item.fullUrl}
            alt={item.name}
            decoding="async"
            draggable={false}
            style={zoomStyle(view)}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={() => {
              gesture.current = null;
            }}
          />
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

function point(touch: { clientX: number; clientY: number }): { x: number; y: number } {
  return { x: touch.clientX, y: touch.clientY };
}

function zoomStyle(view: ZoomView): { transform: string } | undefined {
  if (view.scale === 1 && view.x === 0 && view.y === 0) return undefined;
  const translate = view.x !== 0 || view.y !== 0 ? `translate(${view.x}px, ${view.y}px) ` : "";
  return { transform: `${translate}scale(${view.scale})` };
}

type PinchGesture = {
  pinched: boolean;
  startX: number;
  startY: number;
  startDistance: number;
  startScale: number;
  originX: number;
  originY: number;
};

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
