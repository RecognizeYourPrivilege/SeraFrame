import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useVisualViewport } from "../lib/hooks";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0,
  );
}

type DialogProps = {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * Phone Add source actions.
   * `scroll` keeps Save in the form so it can be scrolled into view.
   * `sticky` pins Save above the keyboard.
   */
  phoneActions?: "scroll" | "sticky";
};

export function Dialog({ title, description, onClose, children, phoneActions }: DialogProps) {
  useVisualViewport();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const panel = panelRef.current;
    if (root) root.inert = true;
    panel?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = focusable(panel);
      if (items.length === 0) return;
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
    };

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (root) root.inert = false;
      previouslyFocused?.focus();
    };
  }, []);

  const sheet = phoneActions === "scroll" || phoneActions === "sticky";
  const dialogClass = sheet
    ? phoneActions === "sticky"
      ? "dialog is-sheet is-sticky-save"
      : "dialog is-sheet is-scroll-save"
    : "dialog";

  return createPortal(
    <div className={sheet ? "backdrop is-sheet-backdrop" : "backdrop"} onMouseDown={() => onCloseRef.current()}>
      <div
        ref={panelRef}
        className={dialogClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-save-mode={phoneActions}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        {description ? <p id={descriptionId}>{description}</p> : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
