import { useEffect, useState } from "react";
import { formatApiError } from "../api/errors";
import type { Server } from "../api/types";
import { AddServerDialog } from "./AddServerDialog";
import { Dialog } from "./Dialog";

type ServersRailProps = {
  servers: Server[];
  status: "loading" | "ready" | "error";
  error: string | null;
  selectedId: string | null;
  connectedIds: ReadonlySet<string>;
  open: boolean;
  desktop: boolean;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onCreate: (body: { name: string; url: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
};

export function ServersRail({
  servers,
  status,
  error,
  selectedId,
  connectedIds,
  open,
  desktop,
  onRetry,
  onOpen,
  onCreate,
  onDelete,
  onClose,
}: ServersRailProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Server | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (open && !desktop) document.getElementById("servers-rail")?.focus();
  }, [open, desktop]);

  async function confirmRemove() {
    if (!pendingRemove) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await onDelete(pendingRemove.id);
      setPendingRemove(null);
    } catch (err) {
      setRemoveError(formatApiError(err) || "Could not remove the server.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <aside
        id="servers-rail"
        className={open ? "servers-rail is-open" : "servers-rail"}
        aria-label="Servers"
        tabIndex={-1}
      >
        <div className="rail-head">
          <h2>Servers</h2>
          <div className="sidebar-actions">
            {!desktop ? (
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            ) : null}
            <button type="button" className="icon-btn" aria-label="Add server" onClick={() => setAddOpen(true)}>
              +
            </button>
          </div>
        </div>
        <p className="rail-note">Frames stay sandboxed. If a site blocks framing, open it in a new tab.</p>
        {status === "loading" ? (
          <p className="status-line" role="status">
            Loading servers…
          </p>
        ) : null}
        {status === "error" ? (
          <div className="empty" role="alert">
            <p>{error}</p>
            <button type="button" className="btn" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
        {status === "ready" && servers.length === 0 ? <p className="tree-empty">No servers yet.</p> : null}
        <ul className="rail-list">
          {servers.map((server) => {
            const connected = connectedIds.has(server.id);
            return (
              <li key={server.id}>
                <div className="rail-row">
                  <button
                    type="button"
                    className="rail-select"
                    aria-current={server.id === selectedId ? "true" : undefined}
                    onClick={() => onOpen(server.id)}
                  >
                    <span className="rail-name">
                      <span className={connected ? "dot is-on" : "dot"} aria-hidden="true" />
                      {server.name}
                    </span>
                    <span className="rail-url" translate="no">
                      {server.url}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove server ${server.name}`}
                    onClick={() => {
                      setRemoveError(null);
                      setPendingRemove(server);
                    }}
                  >
                    −
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>
      {addOpen ? <AddServerDialog onClose={() => setAddOpen(false)} onCreate={onCreate} /> : null}
      {pendingRemove ? (
        <Dialog
          title={`Remove ${pendingRemove.name}?`}
          description="This only removes the bookmark in SeraFrame. ComfyUI itself keeps running."
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
              {removing ? "Removing…" : "Remove server"}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
