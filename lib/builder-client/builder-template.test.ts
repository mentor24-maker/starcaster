import { describe, expect, it } from "vitest";
import {
  formatRichTextContent,
  normalizeBuilderAssetUrl,
  normalizeBuilderModuleSettingsForType,
  normalizeBuilderModules,
  normalizeBuilderSection,
  normalizeLayoutSections,
  resolveBuilderModuleType
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
        url: "/gallery/normie.png"
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
