import { describe, expect, it } from "vitest";
import { parseHttpUrl, toCreateServer, toCreateSource } from "./forms";

describe("toCreateSource", () => {
  it("requires a local path and omits a blank label", () => {
    expect(toCreateSource({ type: "local", rootPath: "  ", label: "  " })).toEqual({
      ok: false,
      message: "Enter a local path.",
    });
    expect(toCreateSource({ type: "local", rootPath: " /opt/comfyui_output ", label: "" })).toEqual({
      ok: true,
      body: { type: "local", rootPath: "/opt/comfyui_output" },
    });
  });

  it("requires one SFTP secret and omits an empty port", () => {
    const base = {
      type: "sftp" as const,
      host: "nas.local",
      port: "",
      username: "sera",
      remotePath: "/srv/stills",
      password: "",
      privateKey: "",
      label: "",
    };
    expect(toCreateSource(base).ok).toBe(false);
    expect(toCreateSource({ ...base, privateKey: "KEY" })).toEqual({
      ok: true,
      body: {
        type: "sftp",
        host: "nas.local",
        username: "sera",
        remotePath: "/srv/stills",
        privateKey: "KEY",
      },
    });
    expect(toCreateSource({ ...base, password: "pw", port: "2222", label: " NAS " })).toEqual({
      ok: true,
      body: {
        type: "sftp",
        host: "nas.local",
        port: 2222,
        username: "sera",
        remotePath: "/srv/stills",
        password: "pw",
        label: "NAS",
      },
    });
  });

  it("rejects an out-of-range port", () => {
    expect(
      toCreateSource({
        type: "sftp",
        host: "nas.local",
        port: "70000",
        username: "sera",
        remotePath: "/srv",
        password: "pw",
        privateKey: "",
        label: "",
      }).ok,
    ).toBe(false);
  });
});

describe("toCreateServer", () => {
  it("accepts http(s) URLs and rejects other schemes", () => {
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(toCreateServer("  Lab ", "http://127.0.0.1:8188")).toEqual({
      ok: true,
      body: { name: "Lab", url: "http://127.0.0.1:8188" },
    });
    expect(toCreateSource({ type: "local", rootPath: "relative/output", label: "" }).ok).toBe(false);
    expect(toCreateServer("", "https://example.com").ok).toBe(false);
  });
});
