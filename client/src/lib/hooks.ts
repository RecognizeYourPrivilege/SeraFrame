import { useEffect, useState } from "react";

/** Phone width for mobile chrome (A-32). Landscape uses the same query. */
export const PHONE_QUERY = "(max-width: 768px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Publishes the visible viewport so sheets can sit above the keyboard. */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;

    const sync = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const keyboard = Math.max(0, window.innerHeight - height - offsetTop);
      root.style.setProperty("--vv-height", `${Math.round(height)}px`);
      root.style.setProperty("--keyboard-inset", `${Math.round(keyboard)}px`);
    };

    sync();
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
