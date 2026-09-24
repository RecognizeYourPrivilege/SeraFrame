import { api } from "../api/client";
import { isAbortError } from "../api/errors";
import type { Source, TreeEntry } from "../api/types";

export type Album = {
  sourceId: string;
  sourceLabel: string;
  sourceType: Source["type"];
  path: string;
  title: string;
  stillCount: number;
  coverUrl: string | null;
};

const MAX_DEPTH = 8;

function isDir(entry: TreeEntry): entry is Extract<TreeEntry, { kind: "dir" }> {
  return entry.kind === "dir";
}

function isStill(entry: TreeEntry): entry is Extract<TreeEntry, { kind: "still" }> {
  return entry.kind === "still";
}

async function walk(
  source: Source,
  path: string,
  depth: number,
  albums: Album[],
  failures: string[],
  signal: AbortSignal,
): Promise<void> {
  let entries: TreeEntry[];
  try {
    const tree = await api.sourceTree(source.id, path, { signal });
    entries = tree.entries;
  } catch (err) {
    if (isAbortError(err) || signal.aborted) throw err;
    failures.push(path ? `${source.label} / ${path}` : source.label);
    return;
  }

  const stills = entries.filter(isStill);
  const dirs = entries.filter(isDir);
  if (stills.length > 0) {
    try {
      const page = await api.sourceStills(source.id, path, { signal });
      const title = path.split("/").filter(Boolean).pop() || source.label;
      albums.push({
        sourceId: source.id,
        sourceLabel: source.label,
        sourceType: source.type,
        path,
        title,
        stillCount: page.stills.length,
        coverUrl: page.stills[0]?.thumbUrl ?? null,
      });
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw err;
      failures.push(path ? `${source.label} / ${path}` : source.label);
    }
  }

  if (depth >= MAX_DEPTH) return;
  for (const dir of dirs) {
    await walk(source, dir.relPath, depth + 1, albums, failures, signal);
  }
}

export async function collectAlbums(
  sources: Source[],
  signal: AbortSignal,
): Promise<{ albums: Album[]; failures: string[] }> {
  const albums: Album[] = [];
  const failures: string[] = [];
  for (const source of sources) {
    await walk(source, "", 0, albums, failures, signal);
  }
  albums.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.sourceLabel.localeCompare(b.sourceLabel));
  return { albums, failures };
}

export function photoLabel(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`;
}
