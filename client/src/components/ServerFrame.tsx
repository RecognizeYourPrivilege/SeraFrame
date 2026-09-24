import { useEffect, useRef, useState } from "react";
import type { Server } from "../api/types";

type FrameState = "loading" | "ready" | "slow" | "blocked";

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
  onLeave: () => void;
  onConnectionChange: (connected: boolean) => void;
};

/**
 * In-app embed. The toolbar (address, back, refresh, open externally) stays
 * visible while SeraFrame chrome is hidden. The iframe keeps its own origin
 * so a cross-origin ComfyUI can use its own storage. It cannot navigate this window.
 */
export function ServerFrame({ server, onLeave, onConnectionChange }: ServerFrameProps) {
  const [state, setState] = useState<FrameState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [address, setAddress] = useState(server.url);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timers = useRef<number[]>([]);
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  useEffect(() => {
    setState("loading");
    setAddress(server.url);
    const timeout = window.setTimeout(() => {
      setState((current) => (current === "loading" ? "slow" : current));
    }, 8000);
    return () => {
      window.clearTimeout(timeout);
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
  }, [server.url, reloadKey]);

  useEffect(() => {
    if (state === "ready") onConnectionChangeRef.current(true);
    else if (state === "blocked") onConnectionChangeRef.current(false);
  }, [state]);

  function onLoad() {
    const frame = iframeRef.current;
    if (!frame) return;
    try {
      const href = frame.contentWindow?.location.href ?? "";
      if (href && href !== "about:blank") setAddress(href);
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
      setAddress(server.url);
      setState("ready");
    }
  }

  function back() {
    const frame = iframeRef.current?.contentWindow;
    try {
      const href = frame?.location.href ?? "";
      if (frame && href && href !== "about:blank" && !sameAddress(href, server.url) && frame.history.length > 1) {
        frame.history.back();
        return;
      }
    } catch {
      // Cross-origin frames do not expose history. Leave the embed.
    }
    onLeave();
  }

  function refresh() {
    setState("loading");
    setReloadKey((value) => value + 1);
  }

  const external = /^https?:\/\//i.test(address) ? address : server.url;

  return (
    <section className="frame-shell" aria-label={`${server.name} embedded server`}>
      <div className="embed-bar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={back}>
          <BackIcon />
        </button>
        <button type="button" className="icon-btn" aria-label="Refresh" onClick={refresh}>
          <RefreshIcon />
        </button>
        <label className="embed-url">
          <span className="visually-hidden">Server address</span>
          <input readOnly value={address} translate="no" spellCheck={false} />
        </label>
        <a className="icon-btn" href={external} target="_blank" rel="noopener noreferrer" aria-label="Open externally">
          <ExternalIcon />
        </a>
        <p className="embed-status">
          <span className={state === "ready" ? "dot is-on" : "dot"} aria-hidden="true" />
          <span>{server.name}</span>
        </p>
      </div>
      {state === "blocked" ? (
        <div className="frame-fallback" role="status">
          <h2>This page can’t be shown in a frame</h2>
          <p>
            {server.name} refused to be embedded. SeraFrame does not proxy servers. Open externally is also in
            the bar above.
          </p>
          <a className="btn primary" href={external} target="_blank" rel="noopener noreferrer">
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
          {state === "slow" ? (
            <p className="frame-note" role="status">
              Still loading. A slow response is not a blocked frame. If the page stays blank, use Open externally.
            </p>
          ) : null}
          <iframe
            key={`${server.url}:${reloadKey}`}
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

function sameAddress(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12a7 7 0 1 1-2-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 5v4h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 5 10 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
