import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useChromeVisibility } from "../lib/chrome";
import { useMediaQuery } from "../lib/hooks";
import { useRoute, routeSection, SECTION_LABEL, sectionHash, serverHash, type GallerySection } from "../lib/route";
import { useServers } from "../lib/useServers";
import { GalleryView } from "./GalleryView";
import { ProfileButton } from "./ProfileButton";
import { ProfileMenu } from "./ProfileMenu";
import { ServerFrame } from "./ServerFrame";
import { ServersRail } from "./ServersRail";
import { usePrefs } from "../lib/prefs";

export function AppShell() {
  const route = useRoute();
  const { prefs } = usePrefs();
  const desktop = useMediaQuery("(min-width: 840px)");
  const catalog = useServers();
  const immersive = route.kind === "server";
  const chrome = useChromeVisibility(prefs.serversAutoHide, immersive);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [connectedIds, setConnectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const profileRef = useRef<HTMLButtonElement>(null);

  const section = routeSection(route);
  const showChrome = !chrome.hidden;
  const showFab = chrome.hidden && route.kind !== "server";
  const connected = connectedIds.size > 0;

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === "" || hash === "#" || hash === "#/gallery" || hash === "#/servers") {
      window.history.replaceState(null, "", "#/library");
    }
  }, []);

  useEffect(() => {
    setConnectedIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (catalog.servers.some((server) => server.id === id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [catalog.servers]);

  useEffect(() => {
    if (route.kind === "server") {
      const server = catalog.servers.find((item) => item.id === route.serverId);
      document.title = server ? `${server.name} — SeraFrame` : "Server — SeraFrame";
      return;
    }
    document.title = `${SECTION_LABEL[route.section]} — SeraFrame`;
  }, [route, catalog.servers]);

  useEffect(() => {
    if (!railOpen || desktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setRailOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [railOpen, desktop]);

  const markConnected = useCallback((id: string, isConnected: boolean) => {
    setConnectedIds((current) => {
      const has = current.has(id);
      if (isConnected === has) return current;
      const next = new Set(current);
      if (isConnected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function openServer(id: string) {
    chrome.conceal();
    setRailOpen(false);
    window.location.hash = serverHash(id);
  }

  function leaveServer() {
    window.location.hash = "#/library";
  }

  async function deleteServer(id: string) {
    await catalog.remove(id);
    if (route.kind === "server" && route.serverId === id) leaveServer();
  }

  const selectedServer = route.kind === "server" ? catalog.servers.find((server) => server.id === route.serverId) ?? null : null;

  return (
    <>
      <div className={showChrome ? "shell" : "shell is-immersive"}>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {showChrome ? (
          <TopBar
            section={section}
            query={query}
            desktop={desktop}
            railOpen={railOpen}
            menuOpen={menuOpen}
            connected={connected}
            profileRef={profileRef}
            onQuery={setQuery}
            onToggleRail={() => setRailOpen((open) => !open)}
            onProfile={() => setMenuOpen((open) => !open)}
          />
        ) : null}
        <div className="shell-body">
        {showChrome ? (
          <ServersRail
            servers={catalog.servers}
            status={catalog.status}
            error={catalog.error}
            selectedId={route.kind === "server" ? route.serverId : null}
            connectedIds={connectedIds}
            open={railOpen || desktop}
            desktop={desktop}
            onRetry={catalog.reload}
            onOpen={openServer}
            onCreate={catalog.create}
            onDelete={deleteServer}
            onClose={() => setRailOpen(false)}
          />
        ) : null}
        {route.kind === "server" ? (
          <main id="main" className="stage server-embed">
            {selectedServer ? (
              <>
                <h1 className="visually-hidden">{selectedServer.name}</h1>
                <ServerFrame
                  key={selectedServer.id}
                  server={selectedServer}
                  onLeave={leaveServer}
                  onConnectionChange={(isConnected) => markConnected(selectedServer.id, isConnected)}
                />
              </>
            ) : (
              <div className="empty embed-missing">
                {catalog.status === "loading" ? (
                  <p role="status">Loading servers…</p>
                ) : (
                  <>
                    <p>That server is not in the list.</p>
                    <a className="btn" href="#/library">
                      Back to Library
                    </a>
                  </>
                )}
              </div>
            )}
          </main>
        ) : (
          <GalleryView
            section={route.section}
            album={route.kind === "album" ? { sourceId: route.sourceId, path: route.path } : null}
            query={query}
            showFullPhoto={prefs.showFullPhoto}
            blurThumbs={prefs.blurSensitiveThumbs}
            chromeHidden={chrome.hidden}
          />
        )}
        </div>
      </div>
      {showChrome && railOpen && !desktop ? (
        <button type="button" className="sidebar-backdrop" aria-label="Close servers" onClick={() => setRailOpen(false)} />
      ) : null}
      {showFab ? (
        <ProfileButton
          floating
          connected={connected}
          pressed={menuOpen}
          buttonRef={profileRef}
          onClick={() => setMenuOpen((open) => !open)}
        />
      ) : null}
      {chrome.hidden ? (
        <button type="button" className="corner-triangle" aria-label="Show toolbar and servers" onClick={() => chrome.restore()}>
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d="M64 0 L64 64 L0 0 Z" fill="currentColor" />
          </svg>
        </button>
      ) : null}
      {menuOpen ? (
        <ProfileMenu
          anchor={showFab ? "fab" : "bar"}
          profileRef={profileRef}
          onClose={() => {
            setMenuOpen(false);
            profileRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function TopBar({
  section,
  query,
  desktop,
  railOpen,
  menuOpen,
  connected,
  profileRef,
  onQuery,
  onToggleRail,
  onProfile,
}: {
  section: GallerySection | null;
  query: string;
  desktop: boolean;
  railOpen: boolean;
  menuOpen: boolean;
  connected: boolean;
  profileRef: RefObject<HTMLButtonElement | null>;
  onQuery: (value: string) => void;
  onToggleRail: () => void;
  onProfile: () => void;
}) {
  return (
    <header className="topbar">
      {!desktop ? (
        <button
          type="button"
          className="btn"
          aria-expanded={railOpen}
          aria-controls="servers-rail"
          onClick={onToggleRail}
        >
          Servers
        </button>
      ) : null}
      <nav className="segments" aria-label="Gallery">
        {(["library", "foryou", "albums"] as const).map((item) => (
          <a key={item} href={sectionHash(item)} aria-current={section === item ? "page" : undefined}>
            {SECTION_LABEL[item]}
          </a>
        ))}
      </nav>
      <label className="search">
        <span className="visually-hidden">Search</span>
        <SearchIcon />
        <input
          type="search"
          placeholder="Search"
          value={query}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              onQuery("");
            }
          }}
        />
        {query ? (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onQuery("")}>
            ×
          </button>
        ) : null}
      </label>
      <ProfileButton connected={connected} pressed={menuOpen} buttonRef={profileRef} onClick={onProfile} />
    </header>
  );
}

function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
