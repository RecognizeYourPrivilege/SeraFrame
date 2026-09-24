import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { CreateSource, Source, Still } from "../api/types";
import { Lightbox } from "./Lightbox";
import { SourceSidebar, type FolderSelection } from "./SourceSidebar";
import { ThumbGrid } from "./ThumbGrid";

type GalleryViewProps = {
  sidebarOpen: boolean;
  desktop: boolean;
  onCloseSidebar: () => void;
};

export function GalleryView({ sidebarOpen, desktop, onCloseSidebar }: GalleryViewProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesStatus, setSourcesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<FolderSelection | null>(null);
  const [stills, setStills] = useState<Still[]>([]);
  const [stillsStatus, setStillsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [stillsError, setStillsError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSourcesStatus("loading");
    api
      .listSources({ signal: controller.signal })
      .then((res) => {
        setSources(res.sources);
        setSourcesStatus("ready");
        setSelected((current) => {
          if (current && res.sources.some((source) => source.id === current.sourceId)) return current;
          const first = res.sources[0];
          return first ? { sourceId: first.id, path: "" } : null;
        });
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setSourcesStatus("error");
        setSourcesError(formatApiError(err) || "Could not load sources.");
      });
    return () => controller.abort();
  }, [reloadToken]);

  const selectedKey = selected ? `${selected.sourceId}\n${selected.path}` : "";

  useEffect(() => {
    if (!selected) {
      setStills([]);
      setStillsStatus("idle");
      setLightboxIndex(null);
      return;
    }
    const controller = new AbortController();
    setStillsStatus("loading");
    setLightboxIndex(null);
    api
      .sourceStills(selected.sourceId, selected.path, { signal: controller.signal })
      .then((res) => {
        setStills(res.stills);
        setStillsStatus("ready");
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setStills([]);
        setStillsStatus("error");
        setStillsError(formatApiError(err) || "Could not load stills.");
      });
    return () => controller.abort();
  }, [selectedKey, selected]);

  const source = sources.find((item) => item.id === selected?.sourceId) ?? null;

  function choose(sourceId: string, path: string) {
    setSelected({ sourceId, path });
    if (!desktop) onCloseSidebar();
  }

  async function createSource(body: CreateSource) {
    const res = await api.createSource(body);
    setSources((current) => [...current, res.source]);
    setSelected({ sourceId: res.source.id, path: "" });
    if (!desktop) onCloseSidebar();
  }

  async function deleteSource(id: string) {
    await api.deleteSource(id);
    const next = sources.filter((item) => item.id !== id);
    setSources(next);
    if (selected?.sourceId === id) {
      const fallback = next[0];
      setSelected(fallback ? { sourceId: fallback.id, path: "" } : null);
    }
  }

  return (
    <div className={sidebarOpen ? "workspace" : "workspace is-collapsed"}>
      <main id="main" className="main" inert={sidebarOpen && !desktop ? true : undefined}>
        <header className="grid-head">
          <div>
            <h1>{source?.label ?? "Gallery"}</h1>
            <p className="path" translate="no">
              {selected ? selected.path || "Root" : "Choose a source"}
            </p>
          </div>
          {stillsStatus === "ready" ? (
            <p className="count">
              {stills.length} {stills.length === 1 ? "still" : "stills"}
            </p>
          ) : null}
        </header>

        {sourcesStatus === "loading" ? (
          <p className="status-line" role="status">
            Loading sources…
          </p>
        ) : null}
        {sourcesStatus === "error" ? (
          <div className="empty" role="alert">
            <p>{sourcesError}</p>
            <button type="button" className="btn" onClick={() => setReloadToken((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {sourcesStatus === "ready" && sources.length === 0 ? (
          <div className="empty">
            <p>No sources yet. Add a local folder or an SFTP directory.</p>
            {!sidebarOpen ? (
              <button type="button" className="btn primary" onClick={() => document.getElementById("sources-toggle")?.click()}>
                Open sources
              </button>
            ) : null}
          </div>
        ) : null}
        {selected && stillsStatus === "loading" ? (
          <p className="status-line" role="status">
            Loading stills…
          </p>
        ) : null}
        {selected && stillsStatus === "error" ? (
          <div className="empty" role="alert">
            <p>{stillsError}</p>
          </div>
        ) : null}
        {selected && stillsStatus === "ready" && stills.length === 0 ? (
          <p className="empty">No stills in this folder.</p>
        ) : null}
        {selected && stillsStatus === "ready" && stills.length > 0 ? (
          <ThumbGrid stills={stills} onOpen={setLightboxIndex} />
        ) : null}
      </main>

      <SourceSidebar
        sources={sources}
        selected={selected}
        open={sidebarOpen}
        desktop={desktop}
        onClose={onCloseSidebar}
        onSelect={choose}
        onCreate={createSource}
        onDelete={deleteSource}
      />

      {lightboxIndex != null && stills[lightboxIndex] ? (
        <Lightbox
          stills={stills}
          index={lightboxIndex}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  );
}
