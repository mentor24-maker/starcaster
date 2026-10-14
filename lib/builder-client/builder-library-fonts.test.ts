import { describe, expect, it } from "vitest";
import {
  collectLibraryFontSlugs,
  isLibraryFontKey,
  libraryFontFaceCss,
  libraryFontKey,
  libraryFontSlug,
  libraryFontStack,
  libraryFontsRequestUrl,
} from "./builder-library-fonts";
import { normalizeLayoutSections, normalizeTheme } from "./builder-template";

/**
 * Font Library 3/7 (task 86bchyd46): a font slot takes a font from
 * Starcaster's own font library, stored "lf:<slug>".
 */
describe("library font keys", () => {
  it("accepts slugs as slugify writes them and refuses anything else", () => {
    expect(libraryFontKey("orbitron")).toBe("lf:orbitron");
    expect(libraryFontKey("space-mono-2")).toBe("lf:space-mono-2");
    for (const bad of ["", "Orbitron", "two  words", "a--b", "-a", "a'b", "x;}", "x".repeat(38)]) {
      expect(libraryFontKey(bad)).toBe("");
    }
    expect(isLibraryFontKey("lf:orbitron")).toBe(true);
    expect(isLibraryFontKey("gf:Orbitron")).toBe(false);
    expect(isLibraryFontKey("lf:Orbitron")).toBe(false);
    expect(libraryFontSlug("lf:orbitron")).toBe("orbitron");
    expect(libraryFontSlug("inter")).toBe("");
  });

  it("fits a 37-character slug inside the 40 characters a font slot stores", () => {
    const key = libraryFontKey("x".repeat(37));
    expect(key.length).toBe(40);
  });

  it("resolves to a stack named after the slug, needing no database read", () => {
    expect(libraryFontStack("lf:orbitron")).toBe("'lf-orbitron', system-ui, sans-serif");
    expect(libraryFontStack("gf:Orbitron")).toBeUndefined();
  });

  it("collects each slug a theme and its sections name, once", () => {
    const theme = { typography: { fonts: { heading: "lf:orbitron", body: "gf:Lato", mono: "" } } };
    const sections = [{ modules: [{ settings: { fontFamily: "lf:orbitron" } }, { settings: { fontFamily: "lf:space-mono" } }] }];
    expect(collectLibraryFontSlugs(theme, sections)).toEqual(["orbitron", "space-mono"]);
    expect(collectLibraryFontSlugs(undefined, null, "lf:", "inter")).toEqual([]);
  });

  it("asks for the same set of fonts at the same address", () => {
    expect(libraryFontsRequestUrl(["space-mono", "orbitron"], "p1")).toBe(
      "/api/public/fonts?slugs=orbitron%2Cspace-mono&projectId=p1"
    );
    expect(libraryFontsRequestUrl(["orbitron"])).toBe("/api/public/fonts?slugs=orbitron");
  });
});

describe("@font-face rules for a library font", () => {
  it("writes one rule per file under the slug's name", () => {
    const css = libraryFontFaceCss({
      slug: "orbitron",
      family: "Orbitron",
      styles: [
        { weight: 400, style: "normal", url: "https://blob.example/orbitron-400.woff2", format: "woff2" },
        { weight: 700, style: "italic", url: "https://blob.example/orbitron-700i.ttf", format: "ttf" },
      ],
    });
    const rules = css.split("\n");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain("font-family:'lf-orbitron'");
    expect(rules[0]).toContain('src:url("https://blob.example/orbitron-400.woff2") format("woff2")');
    expect(rules[0]).toContain("font-weight:400;font-style:normal");
    expect(rules[1]).toContain('format("truetype")');
    expect(rules[1]).toContain("font-style:italic");
  });

  it("skips a file whose address could break out of the rule", () => {
    const css = libraryFontFaceCss({
      slug: "orbitron",
      family: "Orbitron",
      styles: [
        { weight: 400, style: "normal", url: 'https://x/a.woff2");}body{display:none' },
        { weight: 400, style: "normal", url: "javascript:alert(1)" },
        { weight: 400, style: "oblique", url: "https://x/b.woff2" },
      ],
    });
    expect(css).toBe("");
    expect(libraryFontFaceCss({ slug: "Bad Slug", family: "x", styles: [{ weight: 400, style: "normal", url: "https://x/a.woff2" }] })).toBe("");
  });
});

describe("saving keeps a library font", () => {
  it("a built-in, a Google and a library font all survive a save and a reload", () => {
    const saved = normalizeTheme({
      typography: {
        fonts: { heading: "lf:orbitron", body: "gf:Open Sans", mono: "" },
        elements: { h1: { fontFamily: "lora" }, h2: { fontFamily: "lf:space-mono" } },
      },
    });
    // A reload reads back what was saved and normalizes it again.
    const reloaded = normalizeTheme(JSON.parse(JSON.stringify(saved)));
    for (const theme of [saved, reloaded]) {
      expect(theme.typography.fonts.heading).toBe("lf:orbitron");
      expect(theme.typography.fonts.body).toBe("gf:Open Sans");
      expect(theme.typography.elements.h1?.fontFamily).toBe("lora");
      expect(theme.typography.elements.h2?.fontFamily).toBe("lf:space-mono");
    }
  });

  it("a heading module keeps a library font; a malformed one still inherits", () => {
    const [section] = normalizeLayoutSections([
      {
        id: "r",
        title: "r",
        layout: "single",
        modules: [
          { id: "h", type: "heading", column: "main", text: "Hi", settings: { fontFamily: "lf:orbitron" } },
          { id: "h2", type: "heading", column: "main", text: "Hi", settings: { fontFamily: "lf:Orbitron;}" } },
        ],
      },
    ]);
    expect(section.modules[0].settings.fontFamily).toBe("lf:orbitron");
    expect(section.modules[1].settings.fontFamily).toBe("");
  });
});
