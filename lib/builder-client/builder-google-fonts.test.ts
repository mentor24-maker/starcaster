import { describe, expect, it } from "vitest";
import {
  collectGoogleFontFamilies,
  googleFontFamily,
  googleFontKey,
  googleFontStack,
  googleFontStylesheetHref,
  isGoogleFontKey,
} from "./builder-google-fonts";
import { normalizeLayoutSections, normalizeTheme } from "./builder-template";

/**
 * Any Google Font, not only the ten built-ins (task 86bce9wwv). The import of
 * daneofearth.org (Open Sans) is what asked for it: before this, the theme
 * normalizer blanked any font outside the fixed list on every save.
 */
describe("Google font keys", () => {
  it("accepts real family names and refuses anything else", () => {
    expect(googleFontKey("Open Sans")).toBe("gf:Open Sans");
    expect(googleFontKey("  IBM   Plex Sans ")).toBe("gf:IBM Plex Sans");
    expect(googleFontKey("M PLUS 1p")).toBe("gf:M PLUS 1p");
    for (const bad of ["", "Open Sans'; }", "a<b", "Font/Name", "x".repeat(38)]) {
      expect(googleFontKey(bad)).toBe("");
    }
    expect(isGoogleFontKey("gf:Open Sans")).toBe(true);
    expect(isGoogleFontKey("inter")).toBe(false);
    expect(isGoogleFontKey("gf:Open  Sans")).toBe(false);
    expect(googleFontFamily("gf:Open Sans")).toBe("Open Sans");
  });

  it("resolves to a font stack and a stylesheet that tolerates missing weights", () => {
    expect(googleFontStack("gf:Open Sans")).toBe("'Open Sans', system-ui, sans-serif");
    expect(googleFontStack("inter")).toBeUndefined();
    const href = googleFontStylesheetHref("Open Sans");
    expect(href.startsWith("https://fonts.googleapis.com/css?family=Open+Sans:")).toBe(true);
    expect(href).toContain("display=swap");
  });

  it("collects each family a theme and its sections name, once", () => {
    const theme = { typography: { fonts: { heading: "gf:Open Sans", body: "gf:Lato", mono: "" } } };
    const sections = [{ modules: [{ settings: { fontFamily: "gf:Open Sans" } }, { settings: { fontFamily: "inter" } }] }];
    expect(collectGoogleFontFamilies(theme, sections)).toEqual(["Open Sans", "Lato"]);
    expect(collectGoogleFontFamilies(undefined, null, "gf:")).toEqual([]);
  });
});

describe("saving keeps a Google font (it used to be blanked)", () => {
  it("theme font roles and per-element fonts survive normalization", () => {
    const theme = normalizeTheme({
      typography: {
        fonts: { heading: "gf:Open Sans", body: "lora", mono: "" },
        elements: { h1: { fontFamily: "gf:Playfair Display SC" } },
      },
    });
    expect(theme.typography.fonts.heading).toBe("gf:Open Sans");
    expect(theme.typography.fonts.body).toBe("lora");
    expect(theme.typography.elements.h1?.fontFamily).toBe("gf:Playfair Display SC");
  });

  it("an invalid font still normalizes to inherit", () => {
    const theme = normalizeTheme({ typography: { fonts: { heading: "comic-sans", body: "gf:bad;name", mono: "" } } });
    expect(theme.typography.fonts.heading).toBe("");
    expect(theme.typography.fonts.body).toBe("");
  });

  it("a heading module keeps a Google font", () => {
    const [section] = normalizeLayoutSections([
      { id: "r", title: "r", layout: "single", modules: [{ id: "h", type: "heading", column: "main", text: "Hi", settings: { fontFamily: "gf:Open Sans" } }] },
    ]);
    expect(section.modules[0].settings.fontFamily).toBe("gf:Open Sans");
  });
});
