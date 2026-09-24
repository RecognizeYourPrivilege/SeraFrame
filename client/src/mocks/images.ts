function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(h, 31) + value.charCodeAt(i)) >>> 0;
  return h;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Procedural stand-in. Production thumbs are webp or jpeg per contract v1. */
export function renderStill(relPath: string, mode: "thumb" | "full"): string {
  const h = hash(relPath);
  const hue = h % 360;
  const hue2 = (hue + 48) % 360;
  const size = mode === "thumb" ? 256 : 1280;
  const name = relPath.split("/").pop() ?? relPath;
  const shape = h % 3;
  const shapeMarkup =
    shape === 0
      ? `<circle cx="88" cy="104" r="48" fill="hsl(${hue2} 42% 62%)"/>`
      : shape === 1
        ? `<rect x="36" y="58" width="96" height="120" fill="hsl(${hue2} 38% 58%)"/>`
        : `<polygon points="48,168 96,48 148,168" fill="hsl(${hue2} 40% 60%)"/>`;
  const fullMark =
    mode === "full"
      ? `<text x="16" y="28" fill="#f4efe6" font-size="14" font-family="sans-serif">FULL</text>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" role="img">
  <title>${esc(name)}</title>
  <rect width="256" height="256" fill="hsl(${hue} 22% 16%)"/>
  <rect x="0" y="188" width="256" height="68" fill="hsl(${(hue + 12) % 360} 18% 12%)"/>
  ${shapeMarkup}
  <rect x="132" y="72" width="92" height="92" fill="hsl(${(hue + 90) % 360} 20% 28%)"/>
  ${fullMark}
  <text x="16" y="220" fill="#f4efe6" font-size="13" font-family="sans-serif">${esc(name)}</text>
</svg>`;
}
