import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useHashView, useMediaQuery } from "../lib/hooks";
import { GalleryView } from "./GalleryView";
import { ServersView } from "./ServersView";

const mocksOn = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS !== "false";

export function AppShell() {
  const { logout } = useAuth();
  const view = useHashView();
  const desktop = useMediaQuery("(min-width: 840px)");
  const [sidebarPref, setSidebarPref] = useState<boolean | null>(null);
  const sourcesBtnRef = useRef<HTMLButtonElement>(null);
  const sidebarOpen = sidebarPref ?? desktop;

  useEffect(() => {
    document.title = view === "servers" ? "Servers — SeraFrame" : "Gallery — SeraFrame";
  }, [view]);

  useEffect(() => {
    if (!sidebarOpen || desktop || view !== "gallery") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSidebarPref(false);
      sourcesBtnRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen, desktop, view]);

  function toggleSidebar() {
    setSidebarPref(!sidebarOpen);
  }

  function closeSidebar() {
    setSidebarPref(false);
    sourcesBtnRef.current?.focus();
  }

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-lead">
          {view === "gallery" ? (
            <button
              ref={sourcesBtnRef}
              id="sources-toggle"
              type="button"
              className="btn"
              aria-expanded={sidebarOpen}
              aria-controls="source-sidebar"
              onClick={toggleSidebar}
            >
              Sources
            </button>
          ) : null}
          <a className="mark" href="#/gallery">
            <span className="mark-frame" aria-hidden="true" />
            SeraFrame
          </a>
          {mocksOn ? <span className="demo-pill">Demo</span> : null}
        </div>
        <nav className="tabs" aria-label="Primary">
          <a href="#/gallery" aria-current={view === "gallery" ? "page" : undefined}>
            Gallery
          </a>
          <a href="#/servers" aria-current={view === "servers" ? "page" : undefined}>
            Servers
          </a>
        </nav>
        <button type="button" className="btn ghost logout" onClick={() => void logout()}>
          Log out
        </button>
      </header>
      {view === "gallery" ? (
        <GalleryView sidebarOpen={sidebarOpen} desktop={desktop} onCloseSidebar={closeSidebar} />
      ) : (
        <ServersView />
      )}
    </>
  );
}
