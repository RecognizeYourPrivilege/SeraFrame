import { useEffect, useId, useRef, useState, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import type { Still } from "../api/types";

type LightboxProps = {
  stills: Still[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  fit?: "cover" | "contain";
  blurThumbs?: boolean;
};

export function Lightbox({ stills, index, onIndex, onClose, fit = "contain", blurThumbs = false }: LightboxProps) {
  const still = stills[index];
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLUListElement>(null);
  const [stripOpen, setStripOpen] = useState(false);
  const stripOpenRef = useRef(false);
  stripOpenRef.current = stripOpen;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [still?.sourceId, still?.relPath]);

  useEffect(() => {
    if (!stripOpen) return;
    const current = stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [stripOpen, index]);

  const indexRef = useRef(index);
  const lengthRef = useRef(stills.length);
  const onIndexRef = useRef(onIndex);
  indexRef.current = index;
  lengthRef.current = stills.length;
  onIndexRef.current = onIndex;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    if (root) root.inert = true;
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      const current = indexRef.current;
      const length = lengthRef.current;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexRef.current(Math.max(0, current - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndexRef.current(Math.min(length - 1, current + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setStripOpen(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (stripOpenRef.current) {
          setStripOpen(false);
          return;
        }
        onCloseRef.current();
      } else if (event.key === "Tab") {
        trapTab(event, panelRef.current);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (root) root.inert = false;
      previouslyFocused?.focus();
    };
  }, []);

  if (!still) return null;

  function step(delta: number) {
    onIndex(Math.max(0, Math.min(stills.length - 1, index + delta)));
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
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="lightbox-top">
        <h2 id={titleId}>{still.name}</h2>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="lightbox-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {!loaded && !failed ? (
          <img className={blurThumbs ? "placeholder is-blurred" : "placeholder"} src={still.thumbUrl} alt="" />
        ) : null}
        {failed ? (
          <p className="frame-fallback" role="alert">
            Full image failed to load.
          </p>
        ) : (
          <img
            className="full"
            src={still.fullUrl}
            alt={still.name}
            decoding="async"
            fetchPriority="high"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {stripOpen ? (
        <ul id="filmstrip" ref={stripRef} className="filmstrip" aria-label="Stills in this folder">
          <li>
            <button type="button" className="btn" onClick={() => setStripOpen(false)}>
              Close filmstrip
            </button>
          </li>
          {stills.map((item, itemIndex) => (
            <li key={`${item.sourceId}:${item.relPath}`}>
              <button
                type="button"
                className="strip-thumb"
                aria-current={itemIndex === index ? "true" : undefined}
                aria-label={`Show ${item.name}`}
                onClick={() => onIndex(itemIndex)}
              >
                <img
                  className={blurThumbs ? "is-blurred" : undefined}
                  src={item.thumbUrl}
                  alt=""
                  width={72}
                  height={72}
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="lightbox-bar">
        <button type="button" className="btn" onClick={() => step(-1)} disabled={index === 0}>
          Previous
        </button>
        <p className="pos">
          {index + 1} of {stills.length}
        </p>
        <button type="button" className="btn" onClick={() => step(1)} disabled={index >= stills.length - 1}>
          Next
        </button>
        <button
          type="button"
          className="btn primary"
          aria-expanded={stripOpen}
          aria-controls="filmstrip"
          aria-keyshortcuts="ArrowUp"
          onClick={() => setStripOpen((open) => !open)}
        >
          Filmstrip
        </button>
      </div>
      <p className="lightbox-hint">Left and right move between stills. Up opens the filmstrip.</p>
    </div>,
    document.body,
  );
}

function trapTab(event: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const items = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.tabIndex >= 0);
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
