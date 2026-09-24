import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, clearCsrfToken, prefetchCsrf, setUnauthorizedHandler } from "../api/client";
import { isAbortError } from "../api/errors";

type Status = "loading" | "anonymous" | "authenticated";

type AuthValue = {
  status: Status;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    setUnauthorizedHandler(() => setStatus("anonymous"));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .me({ signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) setStatus("authenticated");
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setStatus("anonymous");
      });
    return () => controller.abort();
  }, []);

  const login = useCallback(async (password: string) => {
    await api.login(password);
    clearCsrfToken();
    try {
      await prefetchCsrf();
    } catch {
      // The next mutation requests a token again.
    }
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Drop the local session even when the server cannot be reached.
    }
    clearCsrfToken();
    setStatus("anonymous");
  }, []);

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
