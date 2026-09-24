import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { Appearance, ServerPrefs } from "../api/types";
import { usePrefs, type ThemeName } from "./prefs";

type LoadStatus = "loading" | "ready" | "error";

type ServerPrefsValue = {
  prefs: ServerPrefs | null;
  status: LoadStatus;
  error: string | null;
  reload: () => void;
  saveAppearance: (appearance: ThemeName) => Promise<void>;
  finishFirstRun: (appearance: ThemeName) => Promise<void>;
};

const ServerPrefsContext = createContext<ServerPrefsValue | null>(null);

function normalizePrefs(body: ServerPrefs): ServerPrefs {
  const appearance = body.appearance === "light" || body.appearance === "dark" ? body.appearance : null;
  return {
    appearance,
    firstRunAppearanceDone: body.firstRunAppearanceDone === true,
  };
}

function applyAppearance(appearance: Appearance | null, update: (patch: { theme: ThemeName }) => void) {
  if (appearance !== "light" && appearance !== "dark") return;
  document.documentElement.dataset.theme = appearance;
  update({ theme: appearance });
}

export function ServerPrefsProvider({ children }: { children: ReactNode }) {
  const { update } = usePrefs();
  const [prefs, setPrefs] = useState<ServerPrefs | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    api
      .getPrefs({ signal: controller.signal })
      .then((body) => {
        if (controller.signal.aborted) return;
        const stored = normalizePrefs(body);
        setPrefs(stored);
        applyAppearance(stored.appearance, update);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setError(formatApiError(err) || "Could not load preferences.");
        setStatus("error");
      });
    return () => controller.abort();
  }, [reloadKey, update]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const saveAppearance = useCallback(
    async (appearance: ThemeName) => {
      const stored = normalizePrefs(await api.putPrefs({ appearance }));
      setPrefs(stored);
      applyAppearance(stored.appearance, update);
    },
    [update],
  );

  const finishFirstRun = useCallback(
    async (appearance: ThemeName) => {
      const stored = normalizePrefs(
        await api.putPrefs({ appearance, firstRunAppearanceDone: true }),
      );
      setPrefs(stored);
      applyAppearance(stored.appearance, update);
    },
    [update],
  );

  const value = useMemo(
    () => ({ prefs, status, error, reload, saveAppearance, finishFirstRun }),
    [prefs, status, error, reload, saveAppearance, finishFirstRun],
  );

  return <ServerPrefsContext.Provider value={value}>{children}</ServerPrefsContext.Provider>;
}

export function useServerPrefs(): ServerPrefsValue {
  const value = useContext(ServerPrefsContext);
  if (!value) throw new Error("useServerPrefs must be used within ServerPrefsProvider");
  return value;
}
