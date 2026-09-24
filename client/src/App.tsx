import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AppearancePicker } from "./components/AppearancePicker";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";
import { PrefsProvider } from "./lib/prefs";
import { ServerPrefsProvider, useServerPrefs } from "./lib/serverPrefs";

export function App() {
  return (
    <PrefsProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </PrefsProvider>
  );
}

function AuthGate() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <div className="splash" role="status">
        Checking session…
      </div>
    );
  }
  if (status === "anonymous") return <LoginScreen />;
  return (
    <ServerPrefsProvider>
      <SignedIn />
    </ServerPrefsProvider>
  );
}

function SignedIn() {
  const server = useServerPrefs();
  if (server.status === "loading") {
    return (
      <div className="splash" role="status">
        Loading preferences…
      </div>
    );
  }
  if (server.status === "error" || !server.prefs) {
    return (
      <main className="login" id="main">
        <div className="login-card">
          <h1>Preferences</h1>
          <p className="form-error" role="alert">
            {server.error ?? "Could not load preferences."}
          </p>
          <button type="button" className="btn primary wide" onClick={server.reload}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!server.prefs.firstRunAppearanceDone) return <AppearancePicker />;
  return <AppShell />;
}
