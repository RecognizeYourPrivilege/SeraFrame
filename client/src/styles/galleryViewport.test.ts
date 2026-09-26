import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/global.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(start, close + 1);
}

describe("gallery viewport fit", () => {
  it("binds the shell to the viewport and scrolls the stage, not the page", () => {
    const page = rule("html:has(.shell),\nbody:has(.shell)");
    expect(page).toContain("overflow: hidden");
    expect(page).toContain("100dvh");

    const shell = rule(".shell {");
    expect(shell).toContain("max-height: 100dvh");
    expect(shell).toContain("overflow: hidden");
    expect(shell).toContain("max-width: 100%");

    const stage = rule(".stage {");
    expect(stage).toContain("overflow-y: auto");
    expect(stage).toContain("overflow-x: hidden");
    expect(stage).toContain("min-height: 0");
  });

  it("keeps the bottom image feed and clears the last grid row above it", () => {
    const feed = rule(".image-feed {");
    expect(feed).toContain("position: fixed");
    expect(feed).toContain("bottom: 0");
    expect(feed).toContain("z-index: 99");

    const clearance = rule(".stage.gallery.has-image-feed {");
    expect(clearance).toContain("padding-bottom");
    expect(clearance).toContain("72px");
  });

  it("contain-fits the lightbox and does not cover-crop a fitted still", () => {
    const lightbox = css.slice(css.indexOf(".lightbox {"));
    expect(lightbox).toContain("object-fit: contain");
    expect(lightbox).not.toContain("object-fit: cover");
    expect(rule(".lightbox {")).toContain("z-index: 1001");
    expect(rule(".lightbox {")).toContain("overflow: hidden");
    expect(rule(".lightbox-close {")).toContain("top:");
    expect(rule(".lightbox-close {")).toContain("right:");
  });
});
