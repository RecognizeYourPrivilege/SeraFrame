import type { FeedItem } from "../lib/feed";

type ImageFeedProps = {
  items: FeedItem[];
  onOpen: (index: number) => void;
  fit?: "cover" | "contain";
  blur?: boolean;
};

/**
 * Bottom image feed shared by the gallery (S-1) and, later, a connected-server
 * preview (S-2). Left-click or keyboard activate opens the fullscreen overlay.
 * Arrow keys are not handled here: stepping is overlay-only.
 *
 * S-2 live Comfy population (`executed` → `output.images` → `/view`) is not
 * wired. The API has no session feed or websocket for that stream.
 */
export function ImageFeed({ items, onOpen, fit = "cover", blur = false }: ImageFeedProps) {
  if (items.length === 0) return null;

  return (
    <nav className="image-feed" aria-label="Image feed" style={{ zIndex: 99 }}>
      <ul className="image-feed-list">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className={fit === "contain" ? "feed-thumb is-contain" : "feed-thumb"}
              aria-label={`Open ${item.name}`}
              onClick={() => onOpen(index)}
            >
              <img
                className={blur ? "is-blurred" : undefined}
                src={item.thumbUrl}
                alt=""
                width={72}
                height={72}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
