import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { Server } from "../api/types";
import { AddServerDialog } from "./AddServerDialog";
import { Dialog } from "./Dialog";
import { ServerFrame } from "./ServerFrame";

export function ServersView() {
  const [servers, setServers] = useState<Server[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Server | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    api
      .listServers({ signal: controller.signal })
      .then((res) => {
        setServers(res.servers);
        setStatus("ready");
        setSelectedId((current) => {
          if (current && res.servers.some((server) => server.id === current)) return current;
          return res.servers[0]?.id ?? null;
        });
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setStatus("error");
        setError(formatApiError(err) || "Could not load servers.");
      });
    return () => controller.abort();
  }, [reloadToken]);

  const selected = servers.find((server) => server.id === selectedId) ?? null;

  async function createServer(body: { name: string; url: string }) {
    const res = await api.createServer(body);
    setServers((current) => [...current, res.server]);
    setSelectedId(res.server.id);
  }

  async function confirmRemove() {
    if (!pendingRemove) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await api.deleteServer(pendingRemove.id);
      const next = servers.filter((server) => server.id !== pendingRemove.id);
      setServers(next);
      if (selectedId === pendingRemove.id) setSelectedId(next[0]?.id ?? null);
      setPendingRemove(null);
    } catch (err) {
      setRemoveError(formatApiError(err) || "Could not remove the server.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <main id="main" className="servers">
      <section className="server-list" aria-labelledby="servers-heading">
        <div className="sidebar-head">
          <h1 id="servers-heading">Servers</h1>
          <button type="button" className="icon-btn" aria-label="Add server" onClick={() => setAddOpen(true)}>
            +
          </button>
        </div>
        <p className="sidebar-note">
          Frames load the URL directly and stay sandboxed. If a site blocks framing, open it in a new tab. Some
          browsers also withhold cookies inside a frame.
        </p>
        {status === "loading" ? (
          <p className="status-line" role="status">
            Loading servers…
          </p>
        ) : null}
        {status === "error" ? (
          <div className="empty" role="alert">
            <p>{error}</p>
            <button type="button" className="btn" onClick={() => setReloadToken((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {status === "ready" && servers.length === 0 ? <p className="tree-empty">No servers yet.</p> : null}
        <ul className="tree">
          {servers.map((server) => (
            <li key={server.id}>
              <div className="tree-row">
                <button
                  type="button"
                  className="tree-select"
                  aria-current={server.id === selectedId ? "true" : undefined}
                  onClick={() => setSelectedId(server.id)}
                >
                  <span className="tree-label">{server.name}</span>
                  <span className="tree-meta" translate="no">
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
          ))}
        </ul>
      </section>
      <section className="server-stage">
        {selected ? (
          <ServerFrame key={selected.id} server={selected} />
        ) : (
          <div className="empty">
            <p>Add a ComfyUI URL to embed it here.</p>
          </div>
        )}
      </section>
      {addOpen ? <AddServerDialog onClose={() => setAddOpen(false)} onCreate={createServer} /> : null}
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
    </main>
  );
}
