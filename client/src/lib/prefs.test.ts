import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, PREFS_KEY, readPrefs, writePrefs } from "./prefs";

describe("prefs", () => {
  it("defaults to dark chrome that auto-hides", () => {
    localStorage.removeItem(PREFS_KEY);
    expect(readPrefs(localStorage)).toEqual(DEFAULT_PREFS);
  });

  it("persists appearance and feature toggles", () => {
    const next = {
      theme: "light" as const,
      serversAutoHide: false,
      showFullPhoto: true,
      blurSensitiveThumbs: true,
    };
    writePrefs(next, localStorage);
    expect(readPrefs(localStorage)).toEqual(next);
  });

  it("ignores a corrupt payload", () => {
    localStorage.setItem(PREFS_KEY, "{");
    expect(readPrefs(localStorage)).toEqual(DEFAULT_PREFS);
  });
});
