import { api } from "../api/client";
import { formatApiError } from "../api/errors";
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

export type FolderFailure = {
  sourceId: string;
  message: string;
};

export type FolderPhase = "loading" | "ready";

const MAX_DEPTH = 8;

/** One stalled folder must not leave the gallery on "Loading library…". */
export const DEFAULT_FOLDER_TIMEOUT_MS = 50_000;

const FOLDER_TIMEOUT_MESSAGE = "This folder took too long to respond.";

function isDir(entry: TreeEntry): entry is Extract<TreeEntry, { kind: "dir" }> {
  return entry.kind === "dir";
}

function isStill(entry: TreeEntry): entry is Extract<TreeEntry, { kind: "still" }> {
  return entry.kind === "still";
}

function folderLabel(source: Source, path: string): string {
  return path ? `${source.label} / ${path}` : source.label;
}

function failureText(source: Source, path: string, err: unknown): FolderFailure {
  const detail = formatApiError(err) || "Could not load this folder.";
  const label = folderLabel(source, path);
  return { sourceId: source.id, message: `${label}: ${detail}` };
}

export function sourceConnectionText(
  sourceId: string,
  folderStatus: FolderPhase,
  failures: FolderFailure[],
  albumCount: number,
): { role: "status" | "alert"; text: string } {
  const own = failures.filter((failure) => failure.sourceId === sourceId);
  if (own.length > 0) return { role: "alert", text: own.map((failure) => failure.message).join(" ") };
  if (folderStatus === "loading") return { role: "status", text: "Connected. Checking folders…" };
  if (albumCount === 0) return { role: "status", text: "Connected. No photos in this source yet." };
  return { role: "status", text: "Connected" };
}

function thumbUrl(sourceId: string, relPath: string): string {
  const encoded = relPath.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `/api/media/${encodeURIComponent(sourceId)}/thumb?path=${encoded}`;
}

async function loadTree(sourceId: string, path: string, signal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await api.sourceTree(sourceId, path, { signal: controller.signal });
  } catch (err) {
    if (signal.aborted) throw err;
    if (controller.signal.aborted) throw new Error(FOLDER_TIMEOUT_MESSAGE);
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onParentAbort);
  }
}

async function walk(
  source: Source,
  path: string,
  depth: number,
  albums: Album[],
  failures: FolderFailure[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  let entries: TreeEntry[];
  try {
    const tree = await loadTree(source.id, path, signal, timeoutMs);
    entries = tree.entries;
  } catch (err) {
    if (signal.aborted) throw err;
    failures.push(failureText(source, path, err));
    return;
  }

  const stills = entries.filter(isStill);
  const dirs = entries.filter(isDir);
  const cover = stills[0];
  if (cover) {
    const title = path.split("/").filter(Boolean).pop() || source.label;
    albums.push({
      sourceId: source.id,
      sourceLabel: source.label,
      sourceType: source.type,
      path,
      title,
      stillCount: stills.length,
      coverUrl: thumbUrl(source.id, cover.relPath),
    });
  }

  if (depth >= MAX_DEPTH) return;
  for (const dir of dirs) {
    await walk(source, dir.relPath, depth + 1, albums, failures, signal, timeoutMs);
  }
}

export async function collectAlbums(
  sources: Source[],
  signal: AbortSignal,
  options: { requestTimeoutMs?: number } = {},
): Promise<{ albums: Album[]; failures: FolderFailure[] }> {
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_FOLDER_TIMEOUT_MS;
  const albums: Album[] = [];
  const failures: FolderFailure[] = [];
  for (const source of sources) {
    await walk(source, "", 0, albums, failures, signal, timeoutMs);
  }
  albums.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.sourceLabel.localeCompare(b.sourceLabel));
  return { albums, failures };
}

export function photoLabel(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`;
}
