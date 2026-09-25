import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { CreateSource, Source, Still } from "../api/types";
import { addSourceRequested, clearAddSourceRequest, subscribeAddSource } from "../lib/addSourceRequest";
import { collectAlbums, photoLabel, sourceConnectionText, type Album, type FolderFailure, type FolderPhase } from "../lib/albums";
import { stillToFeedItem } from "../lib/feed";
import type { GallerySection } from "../lib/route";
import { sectionHash, SECTION_LABEL } from "../lib/route";
import { AddSourceDialog } from "./AddSourceDialog";
import { AlbumCard } from "./AlbumCard";
import { Dialog } from "./Dialog";
import { ImageFeed } from "./ImageFeed";
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
  const [failures, setFailures] = useState<FolderFailure[]>([]);
  const [folderStatus, setFolderStatus] = useState<FolderPhase>("loading");
  const [libraryStatus, setLibraryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [stills, setStills] = useState<Still[]>([]);
  const [stillsStatus, setStillsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [stillsError, setStillsError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const openIfRequested = () => {
      if (addSourceRequested()) setAddOpen(true);
    };
    openIfRequested();
    return subscribeAddSource(openIfRequested);
  }, []);

  useEffect(() => {
    if (!addOpen) return;
    const id = window.setTimeout(() => clearAddSourceRequest(), 0);
    return () => window.clearTimeout(id);
  }, [addOpen]);
  const [pendingRemove, setPendingRemove] = useState<Source | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const fit = showFullPhoto ? "contain" : "cover";
  const needle = query.trim().toLowerCase();

  useEffect(() => {
    const controller = new AbortController();
    setFolderStatus("loading");
    setAlbums([]);
    setFailures([]);
    api
      .listSources({ signal: controller.signal })
      .then(async (res) => {
        if (controller.signal.aborted) return;
        setSources(res.sources);
        setLibraryStatus("ready");
        setLibraryError(null);
        const nextAlbums: Album[] = [];
        const nextFailures: FolderFailure[] = [];
        for (const source of res.sources) {
          const collected = await collectAlbums([source], controller.signal);
          if (controller.signal.aborted) return;
          nextAlbums.push(...collected.albums);
          nextFailures.push(...collected.failures);
          setAlbums(nextAlbums.slice());
          setFailures(nextFailures.slice());
        }
        if (controller.signal.aborted) return;
        setFolderStatus("ready");
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setLibraryStatus("error");
        setLibraryError(formatApiError(err) || "Could not load the library.");
        setFolderStatus("ready");
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
  const feedItems = useMemo(() => visibleStills.map(stillToFeedItem), [visibleStills]);
  const feedActive = (album != null || section === "foryou") && stillsStatus === "ready" && feedItems.length > 0;

  async function createSource(body: CreateSource) {
    const created = await api.createSource(body);
    setSources((current) =>
      current.some((source) => source.id === created.source.id) ? current : [...current, created.source],
    );
    setLibraryStatus("ready");
    setLibraryError(null);
    setFolderStatus("loading");
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

  const mainClass = ["stage", "gallery", chromeHidden ? "has-fab" : "", feedActive ? "has-image-feed" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <main id="main" className={mainClass}>
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
          onRetry={() => {
            setLibraryStatus("loading");
            setReloadToken((value) => value + 1);
          }}
          onOpen={setLightboxIndex}
        />
      ) : section === "albums" ? (
        <Albums
          sources={sources}
          albums={visibleAlbums}
          status={libraryStatus}
          folderStatus={folderStatus}
          error={libraryError}
          failures={failures}
          searching={needle.length > 0}
          fit={fit}
          blur={blurThumbs}
          onRetry={() => {
            setLibraryStatus("loading");
            setReloadToken((value) => value + 1);
          }}
          onAdd={() => setAddOpen(true)}
          onRemove={(source) => {
            setRemoveError(null);
            setPendingRemove(source);
          }}
        />
      ) : (
        <Library
          sources={sources}
          albums={visibleAlbums}
          itemCount={itemCount}
          status={libraryStatus}
          folderStatus={folderStatus}
          error={libraryError}
          failures={failures}
          searching={needle.length > 0}
          fit={fit}
          blur={blurThumbs}
          onRetry={() => {
            setLibraryStatus("loading");
            setReloadToken((value) => value + 1);
          }}
          onAdd={() => setAddOpen(true)}
        />
      )}

      {feedActive ? <ImageFeed items={feedItems} fit={fit} blur={blurThumbs} onOpen={setLightboxIndex} /> : null}

      {lightboxIndex != null && feedItems[lightboxIndex] ? (
        <Lightbox
          items={feedItems}
          index={lightboxIndex}
          fit={fit}
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
  sources,
  albums,
  itemCount,
  status,
  folderStatus,
  error,
  failures,
  searching,
  fit,
  blur,
  onRetry,
  onAdd,
}: {
  sources: Source[];
  albums: Album[];
  itemCount: number;
  status: "loading" | "ready" | "error";
  folderStatus: FolderPhase;
  error: string | null;
  failures: FolderFailure[];
  searching: boolean;
  fit: "cover" | "contain";
  blur: boolean;
  onRetry: () => void;
  onAdd: () => void;
}) {
  const visibleSources = sources.filter((source) =>
    searching ? albums.some((item) => item.sourceId === source.id) : true,
  );
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
      {status === "ready"
        ? visibleSources.map((source) => (
            <SourceBlock
              key={source.id}
              source={source}
              albums={albums}
              folderStatus={folderStatus}
              failures={failures}
              from="library"
              fit={fit}
              blur={blur}
            />
          ))
        : null}
      {status === "ready" && sources.length === 0 && !searching ? (
        <div className="empty">
          <p>No photos yet. Add a local folder or an SFTP directory.</p>
          <button type="button" className="btn primary" onClick={onAdd}>
            Add source
          </button>
        </div>
      ) : null}
      {status === "ready" && searching && visibleSources.length === 0 ? <p className="empty">No albums match that search.</p> : null}
    </>
  );
}

function Albums({
  sources,
  albums,
  status,
  folderStatus,
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
  folderStatus: FolderPhase;
  error: string | null;
  failures: FolderFailure[];
  searching: boolean;
  fit: "cover" | "contain";
  blur: boolean;
  onRetry: () => void;
  onAdd: () => void;
  onRemove: (source: Source) => void;
}) {
  const visibleSources = sources.filter((source) =>
    searching ? albums.some((item) => item.sourceId === source.id) : true,
  );

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
      {status === "ready" && searching && visibleSources.length === 0 ? <p className="empty">No albums match that search.</p> : null}
      {status === "ready"
        ? visibleSources.map((source) => (
            <SourceBlock
              key={source.id}
              source={source}
              albums={albums}
              folderStatus={folderStatus}
              failures={failures}
              from="albums"
              fit={fit}
              blur={blur}
              onRemove={() => onRemove(source)}
            />
          ))
        : null}
    </>
  );
}

function SourceBlock({
  source,
  albums,
  folderStatus,
  failures,
  from,
  fit,
  blur,
  onRemove,
}: {
  source: Source;
  albums: Album[];
  folderStatus: FolderPhase;
  failures: FolderFailure[];
  from: GallerySection;
  fit: "cover" | "contain";
  blur: boolean;
  onRemove?: () => void;
}) {
  const ownAlbums = albums.filter((item) => item.sourceId === source.id);
  const connection = sourceConnectionText(source.id, folderStatus, failures, ownAlbums.length);
  return (
    <section className="source-group" aria-labelledby={`source-${from}-${source.id}`}>
      <div className="source-group-head">
        <div>
          <h2 id={`source-${from}-${source.id}`}>{source.label}</h2>
          <p className="page-count" translate="no">
            {sourceMeta(source)}
          </p>
        </div>
        {onRemove ? (
          <button type="button" className="btn" aria-label={`Remove source ${source.label}`} onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
      <p className="status-line" role={connection.role}>
        {connection.text}
      </p>
      {ownAlbums.length > 0 ? (
        <ul className="album-grid">
          {ownAlbums.map((item) => (
            <AlbumCard key={`${item.sourceId}:${item.path}`} album={item} from={from} fit={fit} blur={blur} />
          ))}
        </ul>
      ) : null}
    </section>
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

function FailureNote({ failures }: { failures: FolderFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <p className="status-line" role="alert">
      Some folders could not be loaded: {failures.map((failure) => failure.message).join(", ")}.
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
