import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { Session } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { usePrefs, type MobileLayout, type ThemeName } from "../lib/prefs";
import { useServerPrefs } from "../lib/serverPrefs";
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
  const { saveAppearance } = useServerPrefs();
  const { logout } = useAuth();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [panel, setPanel] = useState<Panel>("home");
  const [signingOut, setSigningOut] = useState(false);
  const [themePending, setThemePending] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const sessionAbort = useRef<AbortController | null>(null);

  const loadSessions = useCallback(async () => {
    sessionAbort.current?.abort();
    const controller = new AbortController();
    sessionAbort.current = controller;
    setSessionsLoading(true);
    try {
      const body = await api.listSessions({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setSessions(body.sessions);
      setSessionsError(null);
    } catch (err: unknown) {
      if (isAbortError(err) || controller.signal.aborted) return;
      setSessionsError(formatApiError(err) || "Could not load sessions.");
    } finally {
      if (!controller.signal.aborted) setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    panelRef.current?.focus();
  }, [panel]);

  useEffect(() => {
    if (panel !== "session") return;
    void loadSessions();
  }, [panel, loadSessions]);

  useEffect(() => () => sessionAbort.current?.abort(), []);

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

  async function chooseTheme(theme: ThemeName) {
    if (themePending || prefs.theme === theme) return;
    const previous = prefs.theme;
    setThemeError(null);
    setThemePending(true);
    update({ theme });
    try {
      await saveAppearance(theme);
    } catch (err: unknown) {
      update({ theme: previous });
      setThemeError(formatApiError(err) || "Could not save appearance.");
    } finally {
      setThemePending(false);
    }
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
                disabled={themePending}
                onClick={() => void chooseTheme("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                aria-pressed={prefs.theme === "light"}
                disabled={themePending}
                onClick={() => void chooseTheme("light")}
              >
                Light
              </button>
            </div>
            {themeError ? (
              <p className="form-error" role="alert">
                {themeError}
              </p>
            ) : null}
          </section>

          <section className="menu-block" aria-labelledby="features-heading">
            <h3 id="features-heading">Features</h3>
            <MobileLayoutPicker value={prefs.mobileLayout} onChange={(mobileLayout) => update({ mobileLayout })} />
            <Switch
              label="Servers auto-hide"
              hint="Hide the top bar and Servers rail after 10 seconds idle."
              checked={prefs.serversAutoHide}
              onChange={(serversAutoHide) => update({ serversAutoHide })}
            />
            <Switch
              label="Show full photo"
              hint="Letterbox album covers and thumbnails. No hard crop. The fullscreen viewer always shows the whole photo."
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
          <ChangePasswordForm
            onChanged={() => {
              void loadSessions();
            }}
          />
        </MenuSubpage>
      ) : null}

      {panel === "session" ? (
        <MenuSubpage title="Session & security" onBack={() => setPanel("home")}>
          <SessionPanel
            sessions={sessions}
            loading={sessionsLoading}
            error={sessionsError}
            signingOut={signingOut}
            onRevoked={() => {
              void loadSessions();
            }}
            onSignOut={() => void signOut()}
          />
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

function ChangePasswordForm({ onChanged }: { onChanged: () => void }) {
  const currentId = useId();
  const nextId = useId();
  const confirmId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSuccess(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password updated. Other sessions were signed out.");
      onChanged();
    } catch (err: unknown) {
      setError(formatApiError(err) || "Could not change the password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <p className="switch-hint">Other browsers are signed out when this succeeds. This browser stays signed in.</p>
      <div className="field">
        <label htmlFor={currentId}>Current password</label>
        <input
          id={currentId}
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={nextId}>New password</label>
        <input
          id={nextId}
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={confirmId}>Confirm new password</label>
        <input
          id={confirmId}
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="form-success" role="status">
          {success}
        </p>
      ) : null}
      <button className="btn primary wide" type="submit" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

function SessionPanel({
  sessions,
  loading,
  error,
  signingOut,
  onRevoked,
  onSignOut,
}: {
  sessions: Session[] | null;
  loading: boolean;
  error: string | null;
  signingOut: boolean;
  onRevoked: () => void;
  onSignOut: () => void;
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function revoke(session: Session) {
    if (session.current || revokingId) return;
    setRevokingId(session.id);
    setActionError(null);
    try {
      await api.revokeSession(session.id);
      onRevoked();
    } catch (err: unknown) {
      setActionError(formatApiError(err) || "Could not revoke that session.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <>
      <p className="switch-hint">Sign out of this browser here. Revoke ends a different session.</p>
      {loading && !sessions ? (
        <p role="status">Loading sessions…</p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {sessions ? (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id} className={session.current ? "session-row is-current" : "session-row"}>
              <p className="session-title">{session.current ? "This browser" : "Other session"}</p>
              <p className="session-meta">{session.userAgent ?? "Unknown client"}</p>
              {session.ip ? <p className="session-meta">{session.ip}</p> : null}
              <p className="session-meta">Signed in {formatWhen(session.createdAt)}</p>
              <p className="session-meta">Last seen {formatWhen(session.lastSeenAt)}</p>
              {session.current ? null : (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => void revoke(session)}
                  disabled={revokingId !== null}
                >
                  {revokingId === session.id ? "Revoking…" : "Revoke"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="btn danger wide" onClick={onSignOut} disabled={signingOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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

const MOBILE_LAYOUTS: { id: MobileLayout; label: string }[] = [
  { id: 1, label: "Option 1 — Bottom bar" },
  { id: 2, label: "Option 2 — Hamburger / overflow" },
  { id: 3, label: "Option 3 — Bottom bar + sticky Save" },
];

function MobileLayoutPicker({ value, onChange }: { value: MobileLayout; onChange: (next: MobileLayout) => void }) {
  return (
    <fieldset className="layout-picker">
      <legend>Mobile layout</legend>
      <p className="switch-hint">Used at 768px and below. Saved on this device only.</p>
      {MOBILE_LAYOUTS.map((option) => (
        <label key={option.id} className={value === option.id ? "layout-option is-selected" : "layout-option"}>
          <input
            type="radio"
            name="mobile-layout"
            checked={value === option.id}
            onChange={() => onChange(option.id)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
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
