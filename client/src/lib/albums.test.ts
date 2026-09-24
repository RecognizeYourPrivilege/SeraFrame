import { afterEach, describe, expect, it, vi } from "vitest";
import type { Source } from "../api/types";
import { collectAlbums } from "./albums";

const sftp: Source = {
  id: "src-sftp",
  type: "sftp",
  label: "studio-nas",
  host: "nas.local",
  port: 22,
  username: "sera",
  remotePath: "/srv/stills",
};

const local: Source = {
  id: "src-local",
  type: "local",
  label: "comfyui_output",
  rootPath: "/opt/comfyui_output",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("collectAlbums", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("builds SFTP albums from the tree without a second stills request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/sources/src-sftp/tree") {
        return jsonResponse({
          path: "",
          entries: [
            { kind: "dir", name: "incoming", relPath: "incoming", stillCount: 1 },
            { kind: "still", name: "root.png", relPath: "root.png" },
          ],
        });
      }
      if (url === "/api/sources/src-sftp/tree?path=incoming") {
        return jsonResponse({
          path: "incoming",
          entries: [{ kind: "still", name: "plate.png", relPath: "incoming/plate.png" }],
        });
      }
      return jsonResponse({ error: { code: "not_found", message: "not found" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { albums, failures } = await collectAlbums([sftp], new AbortController().signal);

    expect(failures).toEqual([]);
    expect(albums.map((album) => album.path).sort()).toEqual(["", "incoming"]);
    const incoming = albums.find((album) => album.path === "incoming");
    expect(incoming?.stillCount).toBe(1);
    expect(incoming?.coverUrl).toBe("/api/media/src-sftp/thumb?path=incoming/plate.png");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/stills"))).toBe(false);
  });

  it("records a folder timeout and still loads the next source", async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      if (url === "/api/sources/src-sftp/tree") {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      if (url === "/api/sources/src-local/tree") {
        return Promise.resolve(
          jsonResponse({
            path: "",
            entries: [{ kind: "still", name: "overview.png", relPath: "overview.png" }],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ error: { code: "not_found", message: "not found" } }, 404));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { albums, failures } = await collectAlbums([sftp, local], new AbortController().signal, {
      requestTimeoutMs: 30,
    });

    expect(failures).toEqual(["studio-nas: This folder took too long to respond."]);
    expect(albums.map((album) => album.sourceId)).toEqual(["src-local"]);
    expect(albums[0]?.stillCount).toBe(1);
  });

  it("keeps going when one SFTP folder returns an error", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/sources/src-sftp/tree") {
        return jsonResponse({ error: { code: "io_error", message: "sftp request failed" } }, 502);
      }
      if (url === "/api/sources/src-local/tree") {
        return jsonResponse({
          path: "",
          entries: [{ kind: "still", name: "overview.png", relPath: "overview.png" }],
        });
      }
      return jsonResponse({ error: { code: "not_found", message: "not found" } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { albums, failures } = await collectAlbums([sftp, local], new AbortController().signal);

    expect(failures).toEqual(["studio-nas: sftp request failed"]);
    expect(albums).toHaveLength(1);
    expect(albums[0]?.title).toBe("comfyui_output");
  });
});
