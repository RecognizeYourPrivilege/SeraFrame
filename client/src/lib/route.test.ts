import { describe, expect, it } from "vitest";
import { albumHash, parseHash, serverHash } from "./route";

describe("parseHash", () => {
  it("treats empty, gallery, and servers hashes as Library", () => {
    expect(parseHash("")).toEqual({ kind: "gallery", section: "library" });
    expect(parseHash("#/gallery")).toEqual({ kind: "gallery", section: "library" });
    expect(parseHash("#/servers")).toEqual({ kind: "gallery", section: "library" });
    expect(parseHash("#/library")).toEqual({ kind: "gallery", section: "library" });
  });

  it("reads For You and Albums", () => {
    expect(parseHash("#/foryou")).toEqual({ kind: "gallery", section: "foryou" });
    expect(parseHash("#/for-you")).toEqual({ kind: "gallery", section: "foryou" });
    expect(parseHash("#/albums")).toEqual({ kind: "gallery", section: "albums" });
  });

  it("round-trips album and server hashes", () => {
    const album = albumHash("src/local", "tests/up scales", "albums");
    expect(parseHash(album)).toEqual({
      kind: "album",
      section: "albums",
      sourceId: "src/local",
      path: "tests/up scales",
    });

    const server = serverHash("srv/mock");
    expect(parseHash(server)).toEqual({ kind: "server", serverId: "srv/mock" });
  });

  it("defaults a missing album origin to Library", () => {
    expect(parseHash("#/album/src-local/portraits")).toEqual({
      kind: "album",
      section: "library",
      sourceId: "src-local",
      path: "portraits",
    });
    expect(parseHash("#/album/src-local?from=nope")).toEqual({
      kind: "album",
      section: "library",
      sourceId: "src-local",
      path: "",
    });
  });
});
