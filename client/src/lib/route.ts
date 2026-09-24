import { useEffect, useState } from "react";

export type GallerySection = "library" | "foryou" | "albums";

export type AppRoute =
  | { kind: "gallery"; section: GallerySection }
  | { kind: "album"; section: GallerySection; sourceId: string; path: string }
  | { kind: "server"; serverId: string };

export const SECTION_LABEL: Record<GallerySection, string> = {
  library: "Library",
  foryou: "For You",
  albums: "Albums",
};

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function sectionFrom(value: string | null): GallerySection {
  if (value === "library" || value === "foryou" || value === "albums") return value;
  return "library";
}

export function parseHash(hash: string): AppRoute {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIndex = trimmed.indexOf("?");
  const pathPart = qIndex === -1 ? trimmed : trimmed.slice(0, qIndex);
  const query = new URLSearchParams(qIndex === -1 ? "" : trimmed.slice(qIndex + 1));
  const segments = pathPart
    .split("/")
    .filter((part) => part.length > 0)
    .map(decodePart);
  const head = segments[0] ?? "";

  if (head === "server") {
    const serverId = segments[1] ?? "";
    if (serverId) return { kind: "server", serverId };
  }

  if (head === "album") {
    const sourceId = segments[1] ?? "";
    if (sourceId) {
      return {
        kind: "album",
        section: sectionFrom(query.get("from")),
        sourceId,
        path: segments.slice(2).join("/"),
      };
    }
  }

  if (head === "foryou" || head === "for-you") return { kind: "gallery", section: "foryou" };
  if (head === "albums") return { kind: "gallery", section: "albums" };
  return { kind: "gallery", section: "library" };
}

export function sectionHash(section: GallerySection): string {
  if (section === "foryou") return "#/foryou";
  if (section === "albums") return "#/albums";
  return "#/library";
}

export function albumHash(sourceId: string, path: string, from: GallerySection): string {
  const segments = ["#/album", encodeURIComponent(sourceId)];
  for (const part of path.split("/")) {
    if (part) segments.push(encodeURIComponent(part));
  }
  return `${segments.join("/")}?from=${from}`;
}

export function serverHash(serverId: string): string {
  return `#/server/${encodeURIComponent(serverId)}`;
}

export function routeSection(route: AppRoute): GallerySection | null {
  return route.kind === "server" ? null : route.section;
}

export function useRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route;
}
