import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { Still } from "../api/types";

type ThumbGridProps = {
  stills: Still[];
  onOpen: (index: number) => void;
  fit?: "cover" | "contain";
  blur?: boolean;
};

export function ThumbGrid({ stills, onOpen, fit = "cover", blur = false }: ThumbGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);
  const columns = useGridColumns(gridRef);

  useEffect(() => {
    setActive(0);
  }, [stills]);

  function move(next: number) {
    const clamped = Math.max(0, Math.min(stills.length - 1, next));
    setActive(clamped);
    const button = buttons.current[clamped];
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (stills.length === 0) return;
    const cols = columns;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = active + 1;
    else if (event.key === "ArrowLeft") next = active - 1;
    else if (event.key === "ArrowDown") next = active + cols;
    else if (event.key === "ArrowUp") next = active - cols;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = stills.length - 1;
    if (next == null) return;
    event.preventDefault();
    move(next);
  }

  return (
    <div
      ref={gridRef}
      className="thumb-grid"
      role="list"
      aria-label="Stills"
      onKeyDown={onKeyDown}
    >
      {stills.map((still, index) => (
        <div role="listitem" key={`${still.sourceId}:${still.relPath}`}>
          <ThumbButton
            still={still}
            fit={fit}
            blur={blur}
            tabIndex={index === active ? 0 : -1}
            buttonRef={(node) => {
              buttons.current[index] = node;
            }}
            onOpen={() => onOpen(index)}
          />
        </div>
      ))}
    </div>
  );
}

function ThumbButton({
  still,
  fit,
  blur,
  tabIndex,
  buttonRef,
  onOpen,
}: {
  still: Still;
  fit: "cover" | "contain";
  blur: boolean;
  tabIndex: number;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      className={fit === "contain" ? "thumb is-contain" : "thumb"}
      tabIndex={tabIndex}
      ref={buttonRef}
      aria-label={`Open ${still.name}`}
      onClick={onOpen}
    >
      {failed ? (
        <span className="thumb-fallback">{still.name}</span>
      ) : (
        <img
          className={blur ? "is-blurred" : undefined}
          src={still.thumbUrl}
          alt=""
          width={256}
          height={256}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </button>
  );
}

function useGridColumns(ref: RefObject<HTMLDivElement | null>): number {
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const count = getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length;
      setColumns(Math.max(1, count));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return columns;
}
