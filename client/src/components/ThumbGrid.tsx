import { useState } from "react";
import type { Still } from "../api/types";

type ThumbGridProps = {
  stills: Still[];
  onOpen: (index: number) => void;
  fit?: "cover" | "contain";
  blur?: boolean;
};

/**
 * Gallery grid. Activate a still to open the overlay.
 * Arrow keys do not move the sequence: that navigation is overlay-only.
 */
export function ThumbGrid({ stills, onOpen, fit = "cover", blur = false }: ThumbGridProps) {
  return (
    <div className="thumb-grid" role="list" aria-label="Stills">
      {stills.map((still, index) => (
        <div role="listitem" key={`${still.sourceId}:${still.relPath}`}>
          <ThumbButton still={still} fit={fit} blur={blur} onOpen={() => onOpen(index)} />
        </div>
      ))}
    </div>
  );
}

function ThumbButton({
  still,
  fit,
  blur,
  onOpen,
}: {
  still: Still;
  fit: "cover" | "contain";
  blur: boolean;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      className={fit === "contain" ? "thumb is-contain" : "thumb"}
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
