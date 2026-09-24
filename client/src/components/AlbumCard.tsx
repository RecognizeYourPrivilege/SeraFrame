import { useState } from "react";
import type { Album } from "../lib/albums";
import { photoLabel } from "../lib/albums";
import type { GallerySection } from "../lib/route";
import { albumHash } from "../lib/route";

type AlbumCardProps = {
  album: Album;
  from: GallerySection;
  fit: "cover" | "contain";
  blur: boolean;
};

function coverHue(title: string): number {
  let hash = 0;
  for (const char of title) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function AlbumCard({ album, from, fit, blur }: AlbumCardProps) {
  const [failed, setFailed] = useState(false);
  const hue = coverHue(`${album.sourceId}:${album.path}:${album.title}`);
  const showImage = Boolean(album.coverUrl) && !failed;

  return (
    <li>
      <a className="album-card" href={albumHash(album.sourceId, album.path, from)}>
        <div
          className={fit === "contain" ? "album-cover is-contain" : "album-cover"}
          style={{ background: `linear-gradient(145deg, hsl(${hue} 70% 52%), hsl(${(hue + 46) % 360} 64% 38%))` }}
        >
          {showImage ? (
            <img
              src={album.coverUrl ?? undefined}
              alt=""
              className={blur ? "is-blurred" : undefined}
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailed(true)}
            />
          ) : null}
        </div>
        <div className="album-body">
          <h2>{album.title}</h2>
          <p>{photoLabel(album.stillCount)}</p>
        </div>
      </a>
    </li>
  );
}
