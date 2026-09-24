import { useCallback, useEffect, useRef, useState } from "react";

/** Top bar and Servers rail leave together after this much quiet time. */
export const CHROME_IDLE_MS = 10_000;

/**
 * Hides shell chrome after idle when auto-hide is on.
 * Activity never brings chrome back. Call `restore` from the corner triangle only.
 * A server route starts immersive (chrome already hidden).
 */
export function useChromeVisibility(autoHide: boolean, immersive: boolean) {
  const [hidden, setHidden] = useState(immersive);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useEffect(() => {
    if (immersive) setHidden(true);
  }, [immersive]);

  useEffect(() => {
    if (!autoHide && !immersive) setHidden(false);
  }, [autoHide, immersive]);

  useEffect(() => {
    if (!autoHide) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      if (hiddenRef.current) return;
      timer = window.setTimeout(() => setHidden(true), CHROME_IDLE_MS);
    };
    arm();
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const eventName of events) {
      window.addEventListener(eventName, arm, { passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const eventName of events) window.removeEventListener(eventName, arm);
    };
  }, [autoHide, hidden]);

  const restore = useCallback(() => setHidden(false), []);
  const conceal = useCallback(() => setHidden(true), []);
  return { hidden, restore, conceal };
}
