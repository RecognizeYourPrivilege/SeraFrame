import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const PREFS_KEY = "seraframe.prefs";

export type ThemeName = "light" | "dark";

/** Phone chrome. 1 bottom bar, 2 hamburger, 3 bottom bar with sticky Save. */
export type MobileLayout = 1 | 2 | 3;

export type Prefs = {
  theme: ThemeName;
  serversAutoHide: boolean;
  showFullPhoto: boolean;
  blurSensitiveThumbs: boolean;
  /** Client-only. Never copied to `PUT /api/prefs`. */
  mobileLayout: MobileLayout;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  serversAutoHide: true,
  showFullPhoto: true,
  blurSensitiveThumbs: false,
  mobileLayout: 1,
};

export function mobileLayoutFrom(value: unknown): MobileLayout {
  return value === 2 || value === 3 ? value : 1;
}

/**
 * Browser cache for chrome and feature toggles.
 * Appearance and first-run live on `GET`/`PUT /api/prefs`. A saved theme here
 * is only a display cache: it is not copied to the server, and it does not
 * finish first-run. The cache may paint once before the server response.
 * Mobile layout stays in this cache only.
 */
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
      mobileLayout: mobileLayoutFrom(parsed.mobileLayout),
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
