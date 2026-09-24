import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { CreateSource, Source, TreeEntry } from "../api/types";
import { AddSourceDialog } from "./AddSourceDialog";
import { Dialog } from "./Dialog";

export type FolderSelection = {
  sourceId: string;
  path: string;
};

type SourceSidebarProps = {
  sources: Source[];
  selected: FolderSelection | null;
  open: boolean;
  desktop: boolean;
  onClose: () => void;
  onSelect: (sourceId: string, path: string) => void;
  onCreate: (body: CreateSource) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function SourceSidebar({
  sources,
  selected,
  open,
  desktop,
  onClose,
  onSelect,
  onCreate,
  onDelete,
}: SourceSidebarProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Source | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (open && !desktop) {
      document.getElementById("source-sidebar")?.focus();
    }
  }, [open, desktop]);

  if (!open) return null;

  async function confirmRemove() {
    if (!pendingRemove) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await onDelete(pendingRemove.id);
      setPendingRemove(null);
    } catch (err) {
      setRemoveError(formatApiError(err) || "Could not remove the source.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      {!desktop ? (
        <button type="button" className="sidebar-backdrop" aria-label="Close sources" onClick={onClose} />
      ) : null}
      <aside id="source-sidebar" className="sidebar" aria-labelledby="sources-heading" tabIndex={-1}>
        <div className="sidebar-head">
          <p id="sources-heading" className="sidebar-title">
            Sources
          </p>
          <div className="sidebar-actions">
            {!desktop ? (
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            ) : null}
            <button type="button" className="icon-btn" aria-label="Add source" onClick={() => setAddOpen(true)}>
              +
            </button>
          </div>
        </div>
        <p className="sidebar-note">Add a local folder or an SFTP directory.</p>
        {sources.length === 0 ? <p className="tree-empty">No sources yet.</p> : null}
        <ul className="tree">
          {sources.map((source) => (
            <SourceBranch
              key={source.id}
              source={source}
              selected={selected}
              onSelect={onSelect}
              onAskRemove={() => {
                setRemoveError(null);
                setPendingRemove(source);
              }}
            />
          ))}
        </ul>
      </aside>
      {addOpen ? <AddSourceDialog onClose={() => setAddOpen(false)} onCreate={onCreate} /> : null}
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
    </>
  );
}

function sourceMeta(source: Source): string {
  if (source.type === "local") return source.rootPath ?? "Local";
  const host = source.host ?? "sftp";
  const user = source.username ? `${source.username}@` : "";
  const port = source.port && source.port !== 22 ? `:${source.port}` : "";
  const path = source.remotePath ?? "";
  return `${user}${host}${port}${path}`;
}

function SourceBranch({
  source,
  selected,
  onSelect,
  onAskRemove,
}: {
  source: Source;
  selected: FolderSelection | null;
  onSelect: (sourceId: string, path: string) => void;
  onAskRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootSelected = selected?.sourceId === source.id && selected.path === "";

  return (
    <li>
      <div className="tree-row">
        <button
          type="button"
          className="icon-btn"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${source.label}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
        <button
          type="button"
          className="tree-select"
          aria-current={rootSelected ? "true" : undefined}
          onClick={() => {
            setOpen(true);
            onSelect(source.id, "");
          }}
        >
          <span className="tree-label">
            {source.label} <span className="kind">{source.type}</span>
          </span>
          <span className="tree-meta" translate="no">
            {sourceMeta(source)}
          </span>
        </button>
        <button type="button" className="icon-btn" aria-label={`Remove source ${source.label}`} onClick={onAskRemove}>
          −
        </button>
      </div>
      {open ? (
        <FolderList sourceId={source.id} path="" depth={1} selected={selected} onSelect={onSelect} />
      ) : null}
    </li>
  );
}

function FolderList({
  sourceId,
  path,
  depth,
  selected,
  onSelect,
}: {
  sourceId: string;
  path: string;
  depth: number;
  selected: FolderSelection | null;
  onSelect: (sourceId: string, path: string) => void;
}) {
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .sourceTree(sourceId, path, { signal: controller.signal })
      .then((res) => setEntries(res.entries))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setError(formatApiError(err) || "Could not load folders.");
      });
    return () => controller.abort();
  }, [sourceId, path]);

  if (error) {
    return (
      <p className="tree-empty" role="alert">
        {error}
      </p>
    );
  }
  if (!entries) {
    return (
      <p className="tree-empty" role="status">
        Loading folders…
      </p>
    );
  }

  const dirs = entries.filter((entry): entry is Extract<TreeEntry, { kind: "dir" }> => entry.kind === "dir");
  if (dirs.length === 0) return <p className="tree-empty">No subfolders</p>;

  return (
    <ul className="tree">
      {dirs.map((dir) => (
        <FolderBranch
          key={dir.relPath}
          sourceId={sourceId}
          dir={dir}
          depth={depth}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function FolderBranch({
  sourceId,
  dir,
  depth,
  selected,
  onSelect,
}: {
  sourceId: string;
  dir: Extract<TreeEntry, { kind: "dir" }>;
  depth: number;
  selected: FolderSelection | null;
  onSelect: (sourceId: string, path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isSelected = selected?.sourceId === sourceId && selected.path === dir.relPath;

  return (
    <li>
      <div className="tree-row" style={{ paddingLeft: `${depth * 0.75}rem` }}>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${dir.name}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
        <button
          type="button"
          className="tree-select"
          aria-current={isSelected ? "true" : undefined}
          onClick={() => {
            setOpen(true);
            onSelect(sourceId, dir.relPath);
          }}
        >
          <span className="tree-label">
            {dir.name}
            {dir.stillCount ? <span className="count-pill">{dir.stillCount}</span> : null}
          </span>
        </button>
      </div>
      {open ? (
        <FolderList sourceId={sourceId} path={dir.relPath} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ) : null}
    </li>
  );
}
