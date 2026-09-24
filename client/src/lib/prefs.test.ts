import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, PREFS_KEY, firstRunAppearanceDoneFrom, readPrefs, writePrefs } from "./prefs";

describe("prefs", () => {
  it("defaults to dark chrome that auto-hides, with full photos on", () => {
    localStorage.removeItem(PREFS_KEY);
    expect(readPrefs(localStorage)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.showFullPhoto).toBe(true);
  });

  it("keeps an explicit Show full photo off", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ showFullPhoto: false }));
    expect(readPrefs(localStorage).showFullPhoto).toBe(false);
  });

  it("persists appearance and feature toggles", () => {
    const next = {
      theme: "light" as const,
      serversAutoHide: false,
      showFullPhoto: true,
      blurSensitiveThumbs: true,
      firstRunAppearanceDone: true,
    };
    writePrefs(next, localStorage);
    expect(readPrefs(localStorage)).toEqual(next);
  });

  it("skips first-run when a theme was already saved", () => {
    expect(firstRunAppearanceDoneFrom({ theme: "light" })).toBe(true);
    expect(firstRunAppearanceDoneFrom({ theme: "dark", showFullPhoto: false })).toBe(true);
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "light" }));
    expect(readPrefs(localStorage).firstRunAppearanceDone).toBe(true);
    expect(readPrefs(localStorage).theme).toBe("light");
  });

  it("keeps the first-run picker when the flag is false", () => {
    expect(firstRunAppearanceDoneFrom(null)).toBe(false);
    expect(firstRunAppearanceDoneFrom({ showFullPhoto: true })).toBe(false);
    expect(firstRunAppearanceDoneFrom({ theme: "dark", firstRunAppearanceDone: false })).toBe(false);
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: "dark", firstRunAppearanceDone: false }));
    expect(readPrefs(localStorage).firstRunAppearanceDone).toBe(false);
  });

  it("ignores a corrupt payload", () => {
    localStorage.setItem(PREFS_KEY, "{");
    expect(readPrefs(localStorage)).toEqual(DEFAULT_PREFS);
  });
});
