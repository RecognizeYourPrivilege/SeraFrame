import { useEffect, useRef, useState } from "react";
import type { Server } from "../api/types";

type FrameState = "loading" | "ready" | "blocked";

const SANDBOX = [
  "allow-scripts",
  "allow-forms",
  "allow-same-origin",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-downloads",
  "allow-modals",
].join(" ");

type ServerFrameProps = {
  server: Server;
};

/**
 * The iframe keeps its own origin (`allow-same-origin`) so a cross-origin
 * ComfyUI can use its own storage. It cannot navigate this window.
 * Framing failures are not reliable to detect; Open externally stays visible.
 */
export function ServerFrame({ server }: ServerFrameProps) {
  const [state, setState] = useState<FrameState>("loading");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setState("loading");
    const timeout = window.setTimeout(() => {
      setState((current) => (current === "loading" ? "blocked" : current));
    }, 8000);
    return () => {
      window.clearTimeout(timeout);
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
  }, [server.url]);

  function onLoad() {
    const frame = iframeRef.current;
    if (!frame) return;
    try {
      const href = frame.contentWindow?.location.href ?? "";
      if (!frame.contentWindow || href === "about:blank") {
        const id = window.setTimeout(() => {
          setState((current) => (current === "loading" ? "blocked" : current));
        }, 1200);
        timers.current.push(id);
        return;
      }
      if (href.startsWith("chrome-error:") || href.startsWith("about:neterror")) {
        setState("blocked");
        return;
      }
      setState("ready");
    } catch {
      setState("ready");
    }
  }

  return (
    <section className="frame-shell" aria-label={`${server.name} embedded server`}>
      <div className="frame-bar">
        <h2>{server.name}</h2>
        <a className="btn" href={server.url} target="_blank" rel="noopener noreferrer">
          Open externally
        </a>
      </div>
      {state === "blocked" ? (
        <div className="frame-fallback" role="status">
          <h3>This page can’t be shown in a frame</h3>
          <p>
            {server.name} blocked embedding, or the frame never finished loading. SeraFrame does not proxy
            servers.
          </p>
          <a className="btn primary" href={server.url} target="_blank" rel="noopener noreferrer">
            Open externally
          </a>
        </div>
      ) : (
        <div className="frame-stage">
          {state === "loading" ? (
            <p className="frame-loading" role="status">
              Loading frame…
            </p>
          ) : null}
          <iframe
            key={server.url}
            ref={iframeRef}
            title={`${server.name} (sandboxed)`}
            src={server.url}
            sandbox={SANDBOX}
            referrerPolicy="no-referrer"
            onLoad={onLoad}
            onError={() => setState("blocked")}
          />
        </div>
      )}
    </section>
  );
}
