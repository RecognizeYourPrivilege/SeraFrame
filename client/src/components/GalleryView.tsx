import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { CreateSource, Source, Still } from "../api/types";
import { collectAlbums, photoLabel, type Album } from "../lib/albums";
import type { GallerySection } from "../lib/route";
import { sectionHash, SECTION_LABEL } from "../lib/route";
import { AddSourceDialog } from "./AddSourceDialog";
import { AlbumCard } from "./AlbumCard";
import { Dialog } from "./Dialog";
import { Lightbox } from "./Lightbox";
import { ThumbGrid } from "./ThumbGrid";

type GalleryViewProps = {
  section: GallerySection;
  album: { sourceId: string; path: string } | null;
  query: string;
  showFullPhoto: boolean;
  blurThumbs: boolean;
  chromeHidden: boolean;
};

export function GalleryView({ section, album, query, showFullPhoto, blurThumbs, chromeHidden }: GalleryViewProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [stills, setStills] = useState<Still[]>([]);
  const [stillsStatus, setStillsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [stillsError, setStillsError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Source | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const fit = showFullPhoto ? "contain" : "cover";
  const needle = query.trim().toLowerCase();

  useEffect(() => {
    const controller = new AbortController();
    setLibraryStatus("loading");
    api
      .listSources({ signal: controller.signal })
      .then(async (res) => {
        const collected = await collectAlbums(res.sources, controller.signal);
        if (controller.signal.aborted) return;
        setSources(res.sources);
        setAlbums(collected.albums);
        setFailures(collected.failures);
        setLibraryStatus("ready");
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setLibraryStatus("error");
        setLibraryError(formatApiError(err) || "Could not load the library.");
      });
    return () => controller.abort();
  }, [reloadToken]);

  const albumSourceId = album?.sourceId ?? "";
  const albumPath = album?.path ?? "";

  useEffect(() => {
    if (albumSourceId) {
      const controller = new AbortController();
      setStillsStatus("loading");
      setLightboxIndex(null);
      api
        .sourceStills(albumSourceId, albumPath, { signal: controller.signal })
        .then((res) => {
          setStills(res.stills);
          setStillsStatus("ready");
        })
        .catch((err: unknown) => {
          if (isAbortError(err)) return;
          setStills([]);
          setStillsStatus("error");
          setStillsError(formatApiError(err) || "Could not load photos.");
        });
      return () => controller.abort();
    }

    if (section !== "foryou" || libraryStatus !== "ready") {
      setStills([]);
      setStillsStatus("idle");
      setLightboxIndex(null);
      return;
    }

    const controller = new AbortController();
    const targets = albums.filter((item) => item.stillCount > 0).slice(0, 8);
    setStillsStatus("loading");
    setLightboxIndex(null);
    Promise.all(targets.map((item) => api.sourceStills(item.sourceId, item.path, { signal: controller.signal })))
      .then((pages) => {
        const merged = pages.flatMap((page) => page.stills).slice(0, 80);
        setStills(merged);
        setStillsStatus("ready");
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setStills([]);
        setStillsStatus("error");
        setStillsError(formatApiError(err) || "Could not load photos.");
      });
    return () => controller.abort();
  }, [albumSourceId, albumPath, section, libraryStatus, albums]);

  const visibleAlbums = useMemo(() => {
    if (!needle) return albums;
    return albums.filter((item) => `${item.title} ${item.sourceLabel} ${item.path}`.toLowerCase().includes(needle));
  }, [albums, needle]);

  const visibleStills = useMemo(() => {
    if (!needle) return stills;
    return stills.filter((still) => still.name.toLowerCase().includes(needle) || still.relPath.toLowerCase().includes(needle));
  }, [stills, needle]);

  const itemCount = albums.reduce((sum, item) => sum + item.stillCount, 0);
  const openAlbum = album ? albums.find((item) => item.sourceId === album.sourceId && item.path === album.path) : null;
  const albumTitle = openAlbum?.title || album?.path.split("/").filter(Boolean).pop() || "Album";

  async function createSource(body: CreateSource) {
    await api.createSource(body);
    setReloadToken((value) => value + 1);
  }

  async function confirmRemove() {
    if (!pendingRemove) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await api.deleteSource(pendingRemove.id);
      if (album?.sourceId === pendingRemove.id) window.location.hash = "#/albums";
      setPendingRemove(null);
      setReloadToken((value) => value + 1);
    } catch (err) {
      setRemoveError(formatApiError(err) || "Could not remove the source.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <main id="main" className={chromeHidden ? "stage gallery has-fab" : "stage gallery"}>
      {album ? (
        <AlbumPhotos
          section={section}
          title={albumTitle}
          status={stillsStatus}
          error={stillsError}
          stills={visibleStills}
          fit={fit}
          blur={blurThumbs}
          onOpen={setLightboxIndex}
        />
      ) : section === "foryou" ? (
        <ForYou
          status={libraryStatus === "loading" || stillsStatus === "loading" ? "loading" : stillsStatus}
          error={libraryError || stillsError}
          libraryStatus={libraryStatus}
          stills={visibleStills}
          fit={fit}
          blur={blurThumbs}
          onRetry={() => setReloadToken((value) => value + 1)}
          onOpen={setLightboxIndex}
        />
      ) : section === "albums" ? (
        <Albums
          sources={sources}
          albums={visibleAlbums}
          status={libraryStatus}
          error={libraryError}
          failures={failures}
          searching={needle.length > 0}
          fit={fit}
          blur={blurThumbs}
          onRetry={() => setReloadToken((value) => value + 1)}
          onAdd={() => setAddOpen(true)}
          onRemove={(source) => {
            setRemoveError(null);
            setPendingRemove(source);
          }}
        />
      ) : (
        <Library
          albums={visibleAlbums}
          itemCount={itemCount}
          status={libraryStatus}
          error={libraryError}
          failures={failures}
          searching={needle.length > 0}
          fit={fit}
          blur={blurThumbs}
          onRetry={() => setReloadToken((value) => value + 1)}
          onAdd={() => setAddOpen(true)}
        />
      )}

      {lightboxIndex != null && visibleStills[lightboxIndex] ? (
        <Lightbox
          stills={visibleStills}
          index={lightboxIndex}
          fit={fit}
          blurThumbs={blurThumbs}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}

      {addOpen ? <AddSourceDialog onClose={() => setAddOpen(false)} onCreate={createSource} /> : null}
      {pendingRemove ? (
        <Dialog
          title={`Remove ${pendingRemove.label}?`}
          description="Thumbnail cache for this source is deleted on the server. Files on disk stay where they are."
          onClose={() => {
            if (!removing) setPendingRemove(null);
          }}
        >
          {removeError ? (
            <p className="form-error" role="alert">
              {removeError}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setPendingRemove(null)} disabled={removing}>
              Cancel
            </button>
            <button type="button" className="btn danger" onClick={() => void confirmRemove()} disabled={removing}>
              {removing ? "Removing…" : "Remove source"}
            </button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}

function Library({
  albums,
  itemCount,
  status,
  error,
  failures,
  searching,
  fit,
  blur,
  onRetry,
  onAdd,
}: {
  albums: Album[];
  itemCount: number;
  status: "loading" | "ready" | "error";
  error: string | null;
  failures: string[];
  searching: boolean;
  fit: "cover" | "contain";
  blur: boolean;
  onRetry: () => void;
  onAdd: () => void;
}) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Library</h1>
          <p className="page-count">{searching ? `${albums.length} matching` : `${itemCount} items`}</p>
        </div>
      </header>
      <Status status={status} error={error} onRetry={onRetry} />
      <FailureNote failures={failures} />
      {status === "ready" && albums.length === 0 ? (
        <div className="empty">
          <p>{searching ? "No albums match that search." : "No photos yet. Add a local folder or an SFTP directory."}</p>
          {searching ? null : (
            <button type="button" className="btn primary" onClick={onAdd}>
              Add source
            </button>
          )}
        </div>
      ) : null}
      {status === "ready" && albums.length > 0 ? (
        <ul className="album-grid">
          {albums.map((item) => (
            <AlbumCard
              key={`${item.sourceId}:${item.path}`}
              album={item}
              from="library"
              fit={fit}
              blur={blur}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Albums({
  sources,
  albums,
  status,
  error,
  failures,
  searching,
  fit,
  blur,
  onRetry,
  onAdd,
  onRemove,
}: {
  sources: Source[];
  albums: Album[];
  status: "loading" | "ready" | "error";
  error: string | null;
  failures: string[];
  searching: boolean;
  fit: "cover" | "contain";
  blur: boolean;
  onRetry: () => void;
  onAdd: () => void;
  onRemove: (source: Source) => void;
}) {
  const groups = sources
    .map((source) => ({ source, albums: albums.filter((item) => item.sourceId === source.id) }))
    .filter((group) => (searching ? group.albums.length > 0 : true));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Albums</h1>
          <p className="page-count">{searching ? `${albums.length} matching` : `${albums.length} albums`}</p>
        </div>
        <button type="button" className="btn primary" onClick={onAdd}>
          Add source
        </button>
      </header>
      <Status status={status} error={error} onRetry={onRetry} />
      <FailureNote failures={failures} />
      {status === "ready" && sources.length === 0 ? (
        <div className="empty">
          <p>No sources yet. Add a local folder or an SFTP directory.</p>
        </div>
      ) : null}
      {status === "ready" && searching && groups.length === 0 ? <p className="empty">No albums match that search.</p> : null}
      {status === "ready"
        ? groups.map((group) => (
            <section key={group.source.id} className="source-group" aria-labelledby={`source-${group.source.id}`}>
              <div className="source-group-head">
                <div>
                  <h2 id={`source-${group.source.id}`}>{group.source.label}</h2>
                  <p className="page-count" translate="no">
                    {sourceMeta(group.source)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Remove source ${group.source.label}`}
                  onClick={() => onRemove(group.source)}
                >
                  Remove
                </button>
              </div>
              {group.albums.length === 0 ? <p className="empty">No photos in this source yet.</p> : null}
              {group.albums.length > 0 ? (
                <ul className="album-grid">
                  {group.albums.map((item) => (
                    <AlbumCard
                      key={`${item.sourceId}:${item.path}`}
                      album={item}
                      from="albums"
                      fit={fit}
                      blur={blur}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          ))
        : null}
    </>
  );
}

function ForYou({
  status,
  error,
  libraryStatus,
  stills,
  fit,
  blur,
  onRetry,
  onOpen,
}: {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  libraryStatus: "loading" | "ready" | "error";
  stills: Still[];
  fit: "cover" | "contain";
  blur: boolean;
  onRetry: () => void;
  onOpen: (index: number) => void;
}) {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>For You</h1>
          <p className="page-count">{status === "ready" ? photoLabel(stills.length) : "Across your library"}</p>
        </div>
      </header>
      {libraryStatus === "error" ? (
        <div className="empty" role="alert">
          <p>{error}</p>
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {status === "loading" ? (
        <p className="status-line" role="status">
          Loading photos…
        </p>
      ) : null}
      {status === "error" && libraryStatus !== "error" ? (
        <div className="empty" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
      {status === "ready" && stills.length === 0 ? <p className="empty">No photos to show yet.</p> : null}
      {status === "ready" && stills.length > 0 ? (
        <ThumbGrid stills={stills} fit={fit} blur={blur} onOpen={onOpen} />
      ) : null}
    </>
  );
}

function AlbumPhotos({
  section,
  title,
  status,
  error,
  stills,
  fit,
  blur,
  onOpen,
}: {
  section: GallerySection;
  title: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  stills: Still[];
  fit: "cover" | "contain";
  blur: boolean;
  onOpen: (index: number) => void;
}) {
  return (
    <>
      <header className="page-head">
        <div>
          <a className="crumb" href={sectionHash(section)}>
            {SECTION_LABEL[section]}
          </a>
          <h1>{title}</h1>
          <p className="page-count">{status === "ready" ? photoLabel(stills.length) : "Photos"}</p>
        </div>
      </header>
      {status === "loading" || status === "idle" ? (
        <p className="status-line" role="status">
          Loading photos…
        </p>
      ) : null}
      {status === "error" ? (
        <div className="empty" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
      {status === "ready" && stills.length === 0 ? <p className="empty">No photos in this album.</p> : null}
      {status === "ready" && stills.length > 0 ? (
        <ThumbGrid stills={stills} fit={fit} blur={blur} onOpen={onOpen} />
      ) : null}
    </>
  );
}

function Status({
  status,
  error,
  onRetry,
}: {
  status: "loading" | "ready" | "error";
  error: string | null;
  onRetry: () => void;
}) {
  if (status === "loading") {
    return (
      <p className="status-line" role="status">
        Loading library…
      </p>
    );
  }
  if (status === "error") {
    return (
      <div className="empty" role="alert">
        <p>{error}</p>
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return null;
}

function FailureNote({ failures }: { failures: string[] }) {
  if (failures.length === 0) return null;
  return (
    <p className="status-line" role="status">
      Some folders could not be loaded: {failures.join(", ")}.
    </p>
  );
}

function sourceMeta(source: Source): string {
  if (source.type === "local") return source.rootPath ?? "Local folder";
  const host = source.host ?? "sftp";
  const user = source.username ? `${source.username}@` : "";
  const port = source.port && source.port !== 22 ? `:${source.port}` : "";
  return `${user}${host}${port}${source.remotePath ?? ""}`;
}
