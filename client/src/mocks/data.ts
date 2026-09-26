import type { Source, Still, TreeEntry } from "../api/types";

export const DEMO_PASSWORD = "seraframe-demo";

export const SUGGESTED_PATHS = ["/opt/comfyui_output", "/opt/comfyui_input", "/opt/comfyui_models"];

export type MockNode = {
  stills: string[];
  dirs: { name: string; relPath: string; node: MockNode }[];
};

function folder(stills: string[], dirs: MockNode["dirs"] = []): MockNode {
  return { stills, dirs };
}

export function seedLibrary(): Record<string, MockNode> {
  return {
    "src-local": folder(
      ["overview.png"],
      [
        {
          name: "portraits",
          relPath: "portraits",
          node: folder(
            Array.from({ length: 36 }, (_, index) => `portrait-${String(index + 1).padStart(2, "0")}.png`),
          ),
        },
        {
          name: "landscapes",
          relPath: "landscapes",
          node: folder([
            "ridge-01.jpg",
            "ridge-02.jpg",
            "coast-01.webp",
            "coast-02.webp",
            "field-01.png",
            "field-02.png",
          ]),
        },
        {
          name: "tests",
          relPath: "tests",
          node: folder(
            [],
            [
              {
                name: "upscales",
                relPath: "tests/upscales",
                node: folder(["upscale-01.png", "upscale-02.png", "upscale-03.png", "upscale-04.png"]),
              },
            ],
          ),
        },
      ],
    ),
    "src-sftp": folder(
      [],
      [
        {
          name: "incoming",
          relPath: "incoming",
          node: folder(["plate-01.png", "plate-02.png", "plate-03.png"]),
        },
      ],
    ),
  };
}

export function seedSources(): Source[] {
  return [
    {
      id: "src-local",
      type: "local",
      label: "comfyui_output",
      rootPath: "/opt/comfyui_output",
    },
    {
      id: "src-sftp",
      type: "sftp",
      label: "studio-nas",
      host: "nas.local",
      port: 22,
      username: "sera",
      remotePath: "/srv/stills",
      hasPrivateKey: true,
      hasPassword: false,
    },
  ];
}

export function seedServers(): { id: string; name: string; url: string }[] {
  const origin = typeof window === "undefined" ? "http://127.0.0.1:5173" : window.location.origin;
  return [
    { id: "srv-mock", name: "ComfyUI mock", url: `${origin}/mock/comfy.html` },
    { id: "srv-blocked", name: "Blocked example", url: "https://github.com" },
  ];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function findNode(root: MockNode, relPath: string): MockNode | null {
  if (relPath === "") return root;
  const walk = (node: MockNode): MockNode | null => {
    for (const dir of node.dirs) {
      if (dir.relPath === relPath) return dir.node;
      const nested = walk(dir.node);
      if (nested) return nested;
    }
    return null;
  };
  return walk(root);
}

export function rejectedPath(relPath: string): boolean {
  if (relPath.includes("\0") || relPath.includes("\\") || relPath.startsWith("/")) return true;
  return relPath.split("/").some((part) => part === "..");
}

export function treeEntries(node: MockNode, folderRel: string): TreeEntry[] {
  const dirs = node.dirs
    .slice()
    .sort((a, b) => collator.compare(a.name, b.name))
    .map(
      (dir): TreeEntry => ({
        kind: "dir",
        name: dir.name,
        relPath: dir.relPath,
        stillCount: dir.node.stills.length,
      }),
    );
  const stills = node.stills
    .slice()
    .sort((a, b) => collator.compare(a, b))
    .map(
      (name): TreeEntry => ({
        kind: "still",
        name,
        relPath: folderRel ? `${folderRel}/${name}` : name,
      }),
    );
  return [...dirs, ...stills];
}

export function stillsIn(sourceId: string, node: MockNode, folderRel: string): Still[] {
  return node.stills
    .slice()
    .sort((a, b) => collator.compare(a, b))
    .map((name) => {
      const relPath = folderRel ? `${folderRel}/${name}` : name;
      const query = `path=${encodeURIComponent(relPath)}`;
      return {
        sourceId,
        relPath,
        name,
        thumbUrl: `/api/media/${sourceId}/thumb?${query}`,
        fullUrl: `/api/media/${sourceId}/full?${query}`,
      };
    });
}

export function hasStill(root: MockNode, relPath: string): boolean {
  const slash = relPath.lastIndexOf("/");
  const folderRel = slash === -1 ? "" : relPath.slice(0, slash);
  const name = slash === -1 ? relPath : relPath.slice(slash + 1);
  const node = findNode(root, folderRel);
  return Boolean(node?.stills.includes(name));
}
