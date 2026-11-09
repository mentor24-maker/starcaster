/**
 * The editor must size text the way the published page does (task 86bczr7x7,
 * review round 1 on PR #1001): with a theme Base size set, an Intro Copy or
 * Caption editor showed its paragraphs at the Base size while the live page
 * kept them at their own. The page decides by excluding variant classes in
 * CSS; the editor decides with `textModuleFollowsThemeBaseSize`. These tests
 * pin the helper, pin that the editor's Base-size rules are opt-in, and fail
 * if the page's exclusions and the helper's list ever disagree.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXT_VARIANTS_WITH_OWN_SIZE, textModuleFollowsThemeBaseSize } from "./text-body-size";

const css = (file: string) => readFileSync(resolve(__dirname, "../../src/css", file), "utf8");

/** Every rule (selector list + body) in a stylesheet that sets a size from --bx-size-base. */
function baseSizeSelectors(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const match of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/font-size:\s*var\(--bx-size-base\b/.test(match[2])) out.push(match[1].trim());
  }
  return out;
}

describe("which text follows the theme's Base size", () => {
  it("paragraph text does — the Paragraph variant and the legacy unset one", () => {
    expect(textModuleFollowsThemeBaseSize({ variant: "paragraph" })).toBe(true);
    expect(textModuleFollowsThemeBaseSize({ variant: "" })).toBe(true);
    expect(textModuleFollowsThemeBaseSize({})).toBe(true);
    expect(textModuleFollowsThemeBaseSize(undefined)).toBe(true);
  });

  it("Intro Copy, Caption and Simple Text do not", () => {
    expect(textModuleFollowsThemeBaseSize({ variant: "intro" })).toBe(false);
    expect(textModuleFollowsThemeBaseSize({ variant: "caption" })).toBe(false);
    expect(textModuleFollowsThemeBaseSize({ variant: "plain" })).toBe(false);
  });

  it("the page rule excludes exactly the variants the helper says keep their own size", () => {
    const page = baseSizeSelectors(css("_builder-theme.css"));
    expect(page.length).toBeGreaterThan(0);
    for (const selector of page) {
      const excluded = [...selector.matchAll(/:not\(\.builder-preview-text-([a-z-]+)\)/g)].map((m) => m[1]).sort();
      expect(excluded, selector).toEqual([...TEXT_VARIANTS_WITH_OWN_SIZE].sort());
    }
  });

  it("every editor rule that reads the Base size is scoped to the opt-in class", () => {
    const editor = baseSizeSelectors(css("_builder-react-overrides.css")).filter((s) => s.includes("ProseMirror"));
    expect(editor.length).toBeGreaterThan(0);
    for (const selector of editor) {
      expect(selector).toContain(".builder-rich-text-content-theme-body");
    }
  });
});
