import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";
import { PrefsProvider } from "./lib/prefs";

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
  return <AppShell />;
}
