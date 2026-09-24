import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, PREFS_KEY, readPrefs, writePrefs } from "./prefs";

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

  it("persists the theme cache and feature toggles", () => {
    const next = {
      theme: "light" as const,
      serversAutoHide: false,
      showFullPhoto: true,
      blurSensitiveThumbs: true,
      mobileLayout: 1 as const,
    };
    writePrefs(next, localStorage);
    expect(readPrefs(localStorage)).toEqual(next);
  });

  it("defaults mobile layout to option 1 and keeps option 2 or 3", () => {
    localStorage.removeItem(PREFS_KEY);
    expect(readPrefs(localStorage).mobileLayout).toBe(1);

    localStorage.setItem(PREFS_KEY, JSON.stringify({ mobileLayout: 2 }));
    expect(readPrefs(localStorage).mobileLayout).toBe(2);

    localStorage.setItem(PREFS_KEY, JSON.stringify({ mobileLayout: 3 }));
    expect(readPrefs(localStorage).mobileLayout).toBe(3);

    localStorage.setItem(PREFS_KEY, JSON.stringify({ mobileLayout: 9 }));
    expect(readPrefs(localStorage).mobileLayout).toBe(1);

    const next = { ...DEFAULT_PREFS, mobileLayout: 2 as const };
    writePrefs(next, localStorage);
    expect(readPrefs(localStorage).mobileLayout).toBe(2);
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({ mobileLayout: 2 });
  });

  it("keeps a saved theme as a display cache and ignores a first-run flag", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ theme: "light", firstRunAppearanceDone: true, showFullPhoto: false }),
    );
    const prefs = readPrefs(localStorage);
    expect(prefs.theme).toBe("light");
    expect(prefs.showFullPhoto).toBe(false);
    expect("firstRunAppearanceDone" in prefs).toBe(false);
  });

  it("ignores a corrupt payload", () => {
    localStorage.setItem(PREFS_KEY, "{");
    expect(readPrefs(localStorage)).toEqual(DEFAULT_PREFS);
  });
});
