import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AppearancePicker } from "./components/AppearancePicker";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";
import { PrefsProvider, usePrefs } from "./lib/prefs";

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
  const { prefs } = usePrefs();
  if (status === "loading") {
    return (
      <div className="splash" role="status">
        Checking session…
      </div>
    );
  }
  if (status === "anonymous") return <LoginScreen />;
  if (!prefs.firstRunAppearanceDone) return <AppearancePicker />;
  return <AppShell />;
}
