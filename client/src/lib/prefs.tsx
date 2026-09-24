import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const PREFS_KEY = "seraframe.prefs";

export type ThemeName = "light" | "dark";

export type Prefs = {
  theme: ThemeName;
  serversAutoHide: boolean;
  showFullPhoto: boolean;
  blurSensitiveThumbs: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  serversAutoHide: true,
  showFullPhoto: true,
  blurSensitiveThumbs: false,
};

export function readPrefs(storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage): Prefs {
  if (!storage) return DEFAULT_PREFS;
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      theme: parsed.theme === "light" ? "light" : "dark",
      serversAutoHide: parsed.serversAutoHide !== false,
      showFullPhoto: parsed.showFullPhoto !== false,
      blurSensitiveThumbs: parsed.blurSensitiveThumbs === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: Prefs, storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage): void {
  storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
}

type PrefsValue = {
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => void;
};

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs());

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    writePrefs(prefs);
  }, [prefs]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => ({ ...current, ...patch }));
  }, []);

  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const value = useContext(PrefsContext);
  if (!value) throw new Error("usePrefs must be used within PrefsProvider");
  return value;
}
