import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { isAbortError } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { usePrefs } from "../lib/prefs";
import { APP_VERSION } from "../version";
import { BRAND_ICON_LOCKED } from "./ProfileButton";

type Panel = "home" | "password" | "session" | "about";

type ProfileMenuProps = {
  anchor: "bar" | "fab";
  profileRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

export function ProfileMenu({ anchor, profileRef, onClose }: ProfileMenuProps) {
  const { prefs, update } = usePrefs();
  const { logout } = useAuth();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [panel, setPanel] = useState<Panel>("home");
  const [sessionNote, setSessionNote] = useState<"checking" | "active" | "unavailable">("checking");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    panelRef.current?.focus();
  }, [panel]);

  useEffect(() => {
    if (panel !== "session") return;
    const controller = new AbortController();
    setSessionNote("checking");
    api
      .me({ signal: controller.signal })
      .then(() => setSessionNote("active"))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setSessionNote("unavailable");
      });
    return () => controller.abort();
  }, [panel]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (profileRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".corner-triangle")) return;
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") trapTab(event, panelRef.current);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [profileRef]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    await logout();
  }

  return createPortal(
    <div
      ref={panelRef}
      id="profile-menu"
      className={anchor === "fab" ? "profile-menu is-fab" : "profile-menu"}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <h2 id={titleId} className="visually-hidden">
        Settings
      </h2>
      {panel === "home" ? (
        <div className="menu-home">
          <section className="menu-block" aria-labelledby="appearance-heading">
            <h3 id="appearance-heading">Appearance</h3>
            <div className="theme-toggle" role="group" aria-label="Appearance">
              <button
                type="button"
                aria-pressed={prefs.theme === "dark"}
                onClick={() => update({ theme: "dark" })}
              >
                Dark
              </button>
              <button
                type="button"
                aria-pressed={prefs.theme === "light"}
                onClick={() => update({ theme: "light" })}
              >
                Light
              </button>
            </div>
          </section>

          <section className="menu-block" aria-labelledby="features-heading">
            <h3 id="features-heading">Features</h3>
            <Switch
              label="Servers auto-hide"
              hint="Hide the top bar and Servers rail after 10 seconds idle."
              checked={prefs.serversAutoHide}
              onChange={(serversAutoHide) => update({ serversAutoHide })}
            />
            <Switch
              label="Show full photo"
              hint="Letterbox album covers, thumbnails, and the viewer. No hard crop."
              checked={prefs.showFullPhoto}
              onChange={(showFullPhoto) => update({ showFullPhoto })}
            />
            <Switch
              label="Blur sensitive thumbs"
              hint="Blur every thumbnail. Open a photo to see it sharp."
              checked={prefs.blurSensitiveThumbs}
              onChange={(blurSensitiveThumbs) => update({ blurSensitiveThumbs })}
            />
          </section>

          <div className="menu-links">
            <button type="button" className="menu-link" onClick={() => setPanel("password")}>
              <span>Change password</span>
              <Chevron />
            </button>
            <button type="button" className="menu-link" onClick={() => setPanel("session")}>
              <span>Session & security</span>
              <Chevron />
            </button>
            <button type="button" className="menu-link" onClick={() => setPanel("about")}>
              <span>About</span>
              <Chevron />
            </button>
          </div>

          <button type="button" className="menu-signout" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}

      {panel === "password" ? (
        <MenuSubpage title="Change password" onBack={() => setPanel("home")}>
          <p>
            This server does not expose a change-password API. The admin password is set on the host with{" "}
            <code>SERAFRAME_ADMIN_PASSWORD</code> and is not updated from the browser.
          </p>
        </MenuSubpage>
      ) : null}

      {panel === "session" ? (
        <MenuSubpage title="Session & security" onBack={() => setPanel("home")}>
          <p role="status">
            {sessionNote === "checking" ? "Checking this session…" : null}
            {sessionNote === "active" ? "This browser session is active." : null}
            {sessionNote === "unavailable" ? "This session could not be confirmed." : null}
          </p>
          <p>
            v0.1.0 can confirm the current sign-in (<code>GET /api/auth/me</code>) and end it. It cannot list or
            revoke other sessions.
          </p>
          <button type="button" className="btn danger wide" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </MenuSubpage>
      ) : null}

      {panel === "about" ? (
        <MenuSubpage title="About" onBack={() => setPanel("home")}>
          <div className="about-brand">
            <img src={BRAND_ICON_LOCKED} alt="" width={72} height={72} />
            <div>
              <p className="about-name">SeraFrame</p>
              <p className="about-version">v{APP_VERSION}</p>
            </div>
          </div>
          <p>Private stills and ComfyUI servers, on one host.</p>
        </MenuSubpage>
      ) : null}
    </div>,
    document.body,
  );
}

function MenuSubpage({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="menu-sub">
      <button type="button" className="menu-back" onClick={onBack}>
        Back
      </button>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <div>
        <p className="switch-label">{label}</p>
        <p className="switch-hint">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        className={checked ? "switch is-on" : "switch"}
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 4.5 12.5 10 7 15.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function trapTab(event: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const items = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.tabIndex >= 0);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
