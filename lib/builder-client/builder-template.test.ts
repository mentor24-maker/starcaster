import { describe, expect, it } from "vitest";
import {
  createDefaultTheme,
  finalizeBackgroundSettings,
  promoteThemeStylesPageBackground,
  finalizeThemeStylesPageBackground,
  formatRichTextContent,
  normalizeBuilderAssetUrl,
  normalizeBuilderDocument,
  normalizeBuilderModuleSettingsForType,
  normalizeBuilderModules,
  normalizeBuilderSection,
  normalizeLayoutSections,
  normalizeTheme,
  resolveBuilderModuleType,
  serializeBuilderDocument
} from "@/lib/builder-template";

describe("normalizeBuilderModuleSettingsForType", () => {
  it("preserves transparent poll category list background on save", () => {
    const settings = normalizeBuilderModuleSettingsForType(
      "poll-category-list",
      {
        backgroundMode: "none",
        backgroundColor: "#e8f6fc",
        backgroundColor2: "#eaf4ff",
        backgroundImageUrl: "https://example.com/bg.png",
        backgroundStyleKey: "blue-yellow-circles"
      },
      { id: "cat-1", type: "poll-category-list", column: "main", name: "", text: "" }
    );

    expect(settings.backgroundMode).toBe("none");
    expect(settings.backgroundColor).toBe("");
    expect(settings.backgroundColor2).toBe("");
    expect(settings.backgroundImageUrl).toBe("");
    expect(settings.backgroundStyleKey).toBe("");
  });
});

describe("formatRichTextContent", () => {
  it("wraps plain text in paragraphs", () => {
    const html = formatRichTextContent("Hello\n\nWorld");
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain("<p>World</p>");
  });

  it("escapes angle brackets in plain text", () => {
    const html = formatRichTextContent("3 < 5");
    expect(html).toContain("&lt;");
  });

  it("sanitizes stored html", () => {
    const html = formatRichTextContent("<p>Safe</p><img src=x onerror=alert(1) />");
    expect(html).toContain("Safe");
    expect(html.toLowerCase()).not.toContain("onerror");
  });
});

describe("normalizeBuilderSection", () => {
  it("maps legacy verticalMargin to separate top and bottom margins", () => {
    const section = normalizeBuilderSection({
      id: "section-1",
      title: "Menu",
      layout: "single",
      verticalMargin: "24",
      modules: []
    });

    expect(section?.marginTop).toBe("24");
    expect(section?.marginBottom).toBe("24");
  });

  it("keeps independent top and bottom margins when provided", () => {
    const section = normalizeBuilderSection({
      id: "section-1",
      title: "Menu",
      layout: "single",
      marginTop: "10",
      marginBottom: "30",
      modules: []
    });

    expect(section?.marginTop).toBe("10");
    expect(section?.marginBottom).toBe("30");
  });
});

describe("normalizeBuilderModule heading margins", () => {
  it("maps legacy verticalMargin to marginTop and marginBottom on heading modules", () => {
    const modules = normalizeBuilderModules([
      {
        id: "heading-1",
        type: "heading",
        column: "main",
        text: "Title",
        settings: { verticalMargin: "24" }
      }
    ]);

    expect(modules[0]?.settings.marginTop).toBe("24");
    expect(modules[0]?.settings.marginBottom).toBe("24");
  });

  it("keeps independent heading marginTop and marginBottom when provided", () => {
    const modules = normalizeBuilderModules([
      {
        id: "heading-1",
        type: "heading",
        column: "main",
        text: "Title",
        settings: { marginTop: "8", marginBottom: "40" }
      }
    ]);

    expect(modules[0]?.settings.marginTop).toBe("8");
    expect(modules[0]?.settings.marginBottom).toBe("40");
  });
});

describe("normalizeBuilderAssetUrl", () => {
  it("rewrites legacy admin gallery paths to public gallery urls", () => {
    expect(normalizeBuilderAssetUrl("/api/admin/media-file/gallery/social-x.svg")).toBe(
      "/gallery/social-x.svg"
    );
  });

  it("strips localhost origin to a path", () => {
    expect(normalizeBuilderAssetUrl("http://localhost:3000/gallery/social-x.svg")).toBe(
      "/gallery/social-x.svg"
    );
  });

  it("normalizes gallery paths missing a leading slash", () => {
    expect(normalizeBuilderAssetUrl("gallery/social-x.svg")).toBe("/gallery/social-x.svg");
  });

  it("normalizes legacy admin gallery paths missing a leading slash", () => {
    expect(normalizeBuilderAssetUrl("api/admin/media-file/gallery/social-x.svg")).toBe(
      "/gallery/social-x.svg"
    );
  });
});

describe("floating-image module migration", () => {
  it("resolves legacy overlay images to floating-image", () => {
    expect(
      resolveBuilderModuleType("image", {
        positionMode: "overlay",
        variant: "image",
        url: "/gallery/sample.png"
      })
    ).toBe("floating-image");
  });

  it("normalizes overlay image modules and strips overlay-only settings from inline images", () => {
    const [floating, inline] = normalizeBuilderModules([
      {
        id: "float-1",
        type: "image",
        column: "main",
        settings: {
          positionMode: "overlay",
          overlayAnchor: "center",
          offsetY: "-479",
          url: "/gallery/bounce.png"
        }
      },
      {
        id: "img-1",
        type: "image",
        column: "main",
        settings: {
          positionMode: "inline",
          overlayAnchor: "top-left",
          url: "/gallery/logo.png"
        }
      }
    ]);

    expect(floating?.type).toBe("floating-image");
    expect(floating?.settings.positionMode).toBeUndefined();
    expect(floating?.settings.offsetY).toBe("-479");

    expect(inline?.type).toBe("image");
    expect(inline?.settings.positionMode).toBeUndefined();
    expect(inline?.settings.overlayAnchor).toBeUndefined();
  });

  it("migrates overlay images when normalizing layout sections for pages", () => {
    const sections = normalizeLayoutSections([
      {
        id: "section-1",
        title: "Decor",
        layout: "single",
        marginTop: "80",
        marginBottom: "80",
        modules: [
          {
            id: "bounce-1",
            type: "image",
            column: "main",
            settings: {
              positionMode: "overlay",
              overlayAnchor: "center",
              offsetY: "-479",
              size: "15",
              url: "/gallery/bounce.png"
            }
          }
        ]
      }
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.modules[0]?.type).toBe("floating-image");
    expect(sections[0]?.modules[0]?.settings.offsetY).toBe("-479");
    expect(sections[0]?.modules[0]?.settings.positionMode).toBeUndefined();
  });
});

describe("normalizeTheme", () => {
  it("returns a no-op default theme for missing/invalid input", () => {
    const fallback = createDefaultTheme();
    expect(normalizeTheme(undefined)).toEqual(fallback);
    expect(normalizeTheme(null)).toEqual(fallback);
    expect(normalizeTheme([])).toEqual(fallback);
    expect(normalizeTheme("nope")).toEqual(fallback);
    // The default is a pure "inherit" theme — no fonts, no scale, no overrides.
    expect(fallback.typography.fonts).toEqual({ heading: "", body: "", mono: "" });
    expect(fallback.typography.scale).toEqual({ baseSize: 0, ratio: 0, baseLineHeight: 0 });
    expect(fallback.typography.elements).toEqual({});
  });

  it("keeps valid values and clamps/drops invalid ones", () => {
    const theme = normalizeTheme({
      typography: {
        fonts: { heading: "oswald", body: "not-a-font", mono: "" },
        scale: { baseSize: 999, ratio: 1.25, baseLineHeight: 0 },
        colors: { heading: "#FFF", link: "rgb(0,0,0)", text: "garbage" },
        elements: {
          h1: { fontSize: 48, fontWeight: 700, color: "#123456", textTransform: "uppercase" },
          p: { lineHeight: 1.6, letterSpacing: 0, marginBottom: 24 },
          bogus: { fontSize: 12 },
          h2: { fontSize: 0, color: "" }
        }
      }
    });

    expect(theme.typography.fonts).toEqual({ heading: "oswald", body: "", mono: "" });
    // baseSize clamps to its max; baseLineHeight 0 stays "inherit".
    expect(theme.typography.scale).toEqual({ baseSize: 100, ratio: 1.25, baseLineHeight: 0 });
    expect(theme.typography.colors.heading).toBe("#ffffff");
    expect(theme.typography.colors.link).toBe("#000000");
    expect(theme.typography.colors.text).toBe("");
    expect(theme.typography.elements.h1).toEqual({
      fontSize: 48,
      fontWeight: 700,
      color: "#123456",
      textTransform: "uppercase"
    });
    // letterSpacing 0 is dropped (unset); only the set fields survive.
    expect(theme.typography.elements.p).toEqual({ lineHeight: 1.6, marginBottom: 24 });
    // Unknown element keys are discarded; elements that normalize to empty are omitted.
    expect(theme.typography.elements).not.toHaveProperty("bogus");
    expect(theme.typography.elements).not.toHaveProperty("h2");
  });

  it("round-trips theme through document normalize/serialize", () => {
    const input = {
      pageBackground: { mode: "none" },
      theme: { typography: { fonts: { heading: "lora" }, elements: { h1: { fontSize: 40 } } } },
      sections: []
    };
    const serialized = serializeBuilderDocument(input);
    expect(serialized.theme.typography.fonts.heading).toBe("lora");
    expect(serialized.theme.typography.elements.h1).toEqual({ fontSize: 40 });

    const reloaded = normalizeBuilderDocument(serialized);
    expect(reloaded.theme).toEqual(serialized.theme);
  });

  it("defaults theme when a document has none", () => {
    expect(normalizeBuilderDocument({ sections: [] }).theme).toEqual(createDefaultTheme());
    expect(normalizeBuilderDocument([]).theme).toEqual(createDefaultTheme());
  });
});

describe("finalizeBackgroundSettings", () => {
  it("promotes mode to color when a custom color was saved without mode", () => {
    expect(
      finalizeBackgroundSettings({
        color: "#0b82d4",
        color2: "#eaf4ff",
        imageUrl: "",
        styleKey: ""
      }).mode
    ).toBe("color");
  });

  it("leaves unset backgrounds as none", () => {
    expect(
      finalizeBackgroundSettings({
        mode: "none",
        color: "#ffffff",
        color2: "#eaf4ff",
        imageUrl: "",
        styleKey: "",
        opacity: 100
      }).mode
    ).toBe("none");
  });

  it("keeps explicit none when a stale custom color remains", () => {
    const cleared = finalizeBackgroundSettings({
      mode: "none",
      color: "#0b82d4",
      color2: "#eaf4ff",
      imageUrl: "",
      styleKey: "",
      opacity: 100
    });
    expect(cleared.mode).toBe("none");
    expect(cleared.color).toBe("#ffffff");
  });
});

describe("promoteThemeStylesPageBackground", () => {
  it("promotes theme styles when mode is none but color is set", () => {
    const promoted = promoteThemeStylesPageBackground({
      mode: "none",
      color: "#ceedf8",
      color2: "#eaf4ff",
      imageUrl: "",
      styleKey: "",
      opacity: 100,
    });
    expect(promoted?.mode).toBe("color");
    expect(promoted?.color).toBe("#ceedf8");
  });

  it("finalizeThemeStylesPageBackground persists promoted theme styles", () => {
    const saved = finalizeThemeStylesPageBackground({
      mode: "none",
      color: "#ceedf8",
      color2: "#eaf4ff",
      imageUrl: "",
      styleKey: "",
      opacity: 100,
    });
    expect(saved.mode).toBe("color");
    expect(saved.color).toBe("#ceedf8");
  });
});
