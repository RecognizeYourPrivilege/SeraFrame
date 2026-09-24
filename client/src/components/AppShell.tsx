import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { requestAddSource } from "../lib/addSourceRequest";
import { useChromeVisibility } from "../lib/chrome";
import { PHONE_QUERY, useMediaQuery } from "../lib/hooks";
import { usePrefs, type MobileLayout } from "../lib/prefs";
import { useRoute, routeSection, SECTION_LABEL, sectionHash, serverHash, type GallerySection } from "../lib/route";
import { useServers } from "../lib/useServers";
import { GalleryView } from "./GalleryView";
import { HamburgerIcon, MobileTabBar, OverflowMenu } from "./MobileChrome";
import { ProfileButton } from "./ProfileButton";
import { ProfileMenu } from "./ProfileMenu";
import { ServerFrame } from "./ServerFrame";
import { ServersRail } from "./ServersRail";

export function AppShell() {
  const route = useRoute();
  const { prefs } = usePrefs();
  const desktop = useMediaQuery("(min-width: 840px)");
  const mobile = useMediaQuery(PHONE_QUERY);
  const catalog = useServers();
  const immersive = route.kind === "server";
  const chrome = useChromeVisibility(prefs.serversAutoHide, immersive);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [connectedIds, setConnectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const profileRef = useRef<HTMLButtonElement>(null);
  const overflowToggleRef = useRef<HTMLButtonElement>(null);
  const layout: MobileLayout = mobile ? prefs.mobileLayout : 1;
  const phoneTabs = mobile && layout !== 2;

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
    const root = document.documentElement;
    if (!mobile) {
      delete root.dataset.mobileLayout;
      return;
    }
    root.dataset.mobileLayout = String(prefs.mobileLayout);
    return () => {
      delete root.dataset.mobileLayout;
    };
  }, [mobile, prefs.mobileLayout]);

  useEffect(() => {
    setOverflowOpen(false);
  }, [route]);

  useEffect(() => {
    if (!mobile || prefs.mobileLayout !== 2) setOverflowOpen(false);
  }, [mobile, prefs.mobileLayout]);

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

  const shellClass = [
    showChrome ? "shell" : "shell is-immersive",
    mobile ? "is-phone" : "",
    mobile ? `is-layout-${layout}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  function openOverflowServers() {
    setOverflowOpen(false);
    setRailOpen(true);
  }

  function openAddSource() {
    setOverflowOpen(false);
    if (route.kind === "server") window.location.hash = "#/library";
    requestAddSource();
  }

  return (
    <>
      <div className={shellClass}>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {showChrome ? (
          <TopBar
            section={section}
            title={route.kind === "server" ? selectedServer?.name || "Server" : SECTION_LABEL[route.section]}
            query={query}
            desktop={desktop}
            mobile={mobile}
            layout={layout}
            railOpen={railOpen}
            menuOpen={menuOpen}
            overflowOpen={overflowOpen}
            connected={connected}
            profileRef={profileRef}
            overflowToggleRef={overflowToggleRef}
            onQuery={setQuery}
            onToggleRail={() => setRailOpen((open) => !open)}
            onProfile={() => {
              setOverflowOpen(false);
              setMenuOpen((open) => !open);
            }}
            onToggleOverflow={() => {
              setMenuOpen(false);
              setOverflowOpen((open) => !open);
            }}
            onCloseOverflow={() => setOverflowOpen(false)}
            onOverflowServers={openOverflowServers}
            onAddSource={openAddSource}
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
        {showChrome && phoneTabs ? (
          <MobileTabBar section={section} railOpen={railOpen} onToggleRail={() => setRailOpen((open) => !open)} />
        ) : null}
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
  title,
  query,
  desktop,
  mobile,
  layout,
  railOpen,
  menuOpen,
  overflowOpen,
  connected,
  profileRef,
  overflowToggleRef,
  onQuery,
  onToggleRail,
  onProfile,
  onToggleOverflow,
  onCloseOverflow,
  onOverflowServers,
  onAddSource,
}: {
  section: GallerySection | null;
  title: string;
  query: string;
  desktop: boolean;
  mobile: boolean;
  layout: MobileLayout;
  railOpen: boolean;
  menuOpen: boolean;
  overflowOpen: boolean;
  connected: boolean;
  profileRef: RefObject<HTMLButtonElement | null>;
  overflowToggleRef: RefObject<HTMLButtonElement | null>;
  onQuery: (value: string) => void;
  onToggleRail: () => void;
  onProfile: () => void;
  onToggleOverflow: () => void;
  onCloseOverflow: () => void;
  onOverflowServers: () => void;
  onAddSource: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearchField = !mobile || searchOpen || query.length > 0;
  const showHamburger = mobile && layout === 2;

  useEffect(() => {
    if (showSearchField && mobile) searchRef.current?.focus();
  }, [showSearchField, mobile]);

  return (
    <header className="topbar">
      {showHamburger ? (
        <button
          ref={overflowToggleRef}
          type="button"
          className="icon-btn nav-toggle"
          aria-expanded={overflowOpen}
          aria-controls="mobile-overflow"
          aria-label={overflowOpen ? "Close menu" : "Open menu"}
          onClick={onToggleOverflow}
        >
          <HamburgerIcon />
        </button>
      ) : null}
      {!mobile && !desktop ? (
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
      {!mobile ? (
        <nav className="segments" aria-label="Gallery">
          {(["library", "foryou", "albums"] as const).map((item) => (
            <a key={item} href={sectionHash(item)} aria-current={section === item ? "page" : undefined}>
              {SECTION_LABEL[item]}
            </a>
          ))}
        </nav>
      ) : null}
      {showHamburger && !showSearchField ? <p className="topbar-title">{title}</p> : null}
      <div className={mobile ? "topbar-end" : "topbar-end is-desktop"}>
        {showSearchField ? (
          <label className="search">
            <span className="visually-hidden">Search</span>
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search"
              value={query}
              autoComplete="off"
              enterKeyHint="search"
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (query) onQuery("");
                  if (mobile) setSearchOpen(false);
                }
              }}
              onBlur={() => {
                if (mobile && !query) setSearchOpen(false);
              }}
            />
            {query ? (
              <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onQuery("")}>
                ×
              </button>
            ) : null}
          </label>
        ) : (
          <button type="button" className="icon-btn search-toggle" aria-label="Search" onClick={() => setSearchOpen(true)}>
            <SearchIcon />
          </button>
        )}
        <ProfileButton connected={connected} pressed={menuOpen} buttonRef={profileRef} onClick={onProfile} />
      </div>
      {overflowOpen && showHamburger ? (
        <OverflowMenu
          section={section}
          toggleRef={overflowToggleRef}
          onClose={onCloseOverflow}
          onServers={onOverflowServers}
          onAddSource={onAddSource}
        />
      ) : null}
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
