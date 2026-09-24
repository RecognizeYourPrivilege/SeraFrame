import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./components/LoginScreen";

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
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
