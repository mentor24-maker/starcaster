import { describe, expect, it } from "vitest";
import {
  buildClonedPageCreatePayload,
  columnHasOnlyOverlayImageModules,
  getHeadingModuleStyle,
  getImageOverlayStyle,
  getImageModuleShellStyle,
  getModuleWidthShellStyle,
  getModuleWidthStyle,
  getOverlayFlowCollapsedModuleStyle,
  getOverlayFlowCollapsedSectionStyle,
  getSpeechBubbleBodyStyle,
  getSpeechBubbleModuleStyle,
  buildBuilderThemeStyles,
  getBuilderThemeStyleVars,
  getThemeRootVars,
  isFloatingImageModule,
  isOverlayImageModule,
  sectionHasOnlyOverlayImageModules,
  sectionHasOnlyPageOverlayImageModules,
  sectionHasOnlySectionScopedOverlayModules,
  isSectionScopedOverlayDecor,
  resolveSectionScopedOverlaySectionZIndex
} from "@/components/builder/builder-utils";
import { createDefaultTheme, normalizeTheme } from "@/lib/builder-template";

describe("overlay flow collapse helpers", () => {
  it("detects floating image modules", () => {
    expect(
      isFloatingImageModule({
        type: "floating-image",
        settings: {}
      } as never)
    ).toBe(true);
    expect(
      isOverlayImageModule({
        type: "floating-image",
        settings: {}
      } as never)
    ).toBe(true);
    expect(
      isOverlayImageModule({
        type: "image",
        settings: { positionMode: "overlay", variant: "image" }
      } as never)
    ).toBe(true);
    expect(
      isOverlayImageModule({
        type: "image",
        settings: { positionMode: "inline", variant: "image" }
      } as never)
    ).toBe(false);
  });

  it("resolves section z-index from module settings (floor 40)", () => {
    const section = {
      modules: [{ type: "floating-image", settings: { trigger: "button", zIndex: "120" } }]
    } as never;

    expect(resolveSectionScopedOverlaySectionZIndex(section)).toBe(120);
  });

  it("treats button-trigger floating images as section-scoped decor", () => {
    const decor = {
      type: "floating-image",
      settings: { effect: "bounce" }
    } as never;

    expect(isSectionScopedOverlayDecor(decor)).toBe(true);
    expect(sectionHasOnlySectionScopedOverlayModules({ modules: [decor] } as never)).toBe(true);
    expect(sectionHasOnlyPageOverlayImageModules({ modules: [decor] } as never)).toBe(false);
  });

  it("collapses section layout box for game-trigger full-page overlay sections", () => {
    const section = {
      modules: [{ type: "floating-image", settings: { trigger: "game" } }]
    } as never;

    expect(sectionHasOnlyOverlayImageModules(section)).toBe(true);
    expect(getOverlayFlowCollapsedSectionStyle(true)).toEqual({
      marginTop: 0,
      marginBottom: 0,
      paddingTop: 0,
      paddingBottom: 0,
      minHeight: 0,
      overflow: "visible"
    });
    expect(getOverlayFlowCollapsedModuleStyle(true)).toMatchObject({
      position: "absolute",
      inset: 0,
      width: "100%"
    });
  });

  it("does not collapse sections that mix overlay and inline modules", () => {
    const section = {
      modules: [
        { type: "image", settings: { positionMode: "overlay" } },
        { type: "text", settings: {} }
      ]
    } as never;

    expect(sectionHasOnlyOverlayImageModules(section)).toBe(false);
    expect(
      columnHasOnlyOverlayImageModules([
        { type: "image", settings: { positionMode: "overlay" } } as never
      ])
    ).toBe(true);
  });
});

describe("getImageModuleShellStyle", () => {
  it("nudges inline images using signed horizontal and vertical offsets", () => {
    const style = getImageModuleShellStyle({
      positionMode: "inline",
      horizontalOffset: "12",
      verticalOffset: "8"
    });

    expect(style.transform).toBe("translate(12px, -8px)");
    expect(style.position).toBe("relative");
  });

  it("appends nudge transforms after overlay anchor transforms", () => {
    const style = getImageModuleShellStyle({
      positionMode: "overlay",
      overlayAnchor: "center",
      offsetX: "0",
      offsetY: "0",
      horizontalOffset: "-6",
      verticalOffset: "10"
    });

    expect(style.transform).toContain("translate(-50%, -50%)");
    expect(style.transform).toContain("translate(0px, 0px)");
    expect(style.transform).toContain("translate(-6px, -10px)");
  });
});

describe("buildClonedPageCreatePayload", () => {
  const makeSource = () => ({
    id: "page-1",
    name: "Image TEST",
    slug: "test-image",
    templateId: "tpl-1",
    themeId: "theme-abc",
    theme: {
      typography: {
        fonts: { heading: "Georgia", body: "Arial", mono: "" },
        scale: { baseSize: 16, ratio: 1.25, baseLineHeight: 1.5 },
        colors: { text: "#111111", heading: "#000000", muted: "#888888", link: "#0000ff", linkHover: "#0000cc", selection: "" },
        elements: {}
      }
    },
    pageBackground: { mode: "color" as const, color: "#ffffff", color2: "#ffffff", imageUrl: "", styleKey: "" as const },
    layoutSections: [
      {
        id: "section-1",
        title: "Section",
        layout: "single" as const,
        alignment: "left" as const,
        marginTop: "0",
        marginBottom: "0",
        mobileHidden: "",
        desktopHidden: "",
        mobileLayout: "stack" as const,
        background: { mode: "none" as const, color: "#ffffff", color2: "#ffffff", imageUrl: "", styleKey: "" as const },
        cellBackgrounds: {},
        cellPadding: {},
        cellVerticalMargin: {},
        cellMobileHidden: {},
        cellBorderWidth: {},
        cellBorderColor: {},
        cellBorderRadius: {},
        modules: [
          {
            id: "module-1",
            type: "heading" as const,
            column: "main",
            name: "Heading",
            text: "Hello",
            settings: {}
          }
        ]
      }
    ],
    createdAt: "",
    updatedAt: "",
    isPublished: true
  });

  it("assigns a unique slug and fresh section/module ids", () => {
    const source = makeSource();
    const payload = buildClonedPageCreatePayload(source, [source, { ...source, id: "page-2", slug: "test-image-copy" }]);

    expect(payload.name).toBe("Image TEST Copy");
    expect(payload.slug).toBe("test-image-copy-2");
    expect(payload.layoutSections[0]?.id).not.toBe("section-1");
    expect(payload.layoutSections[0]?.modules[0]?.id).not.toBe("module-1");
  });

  it("inherits templateId, templateKind, themeId, and theme from source", () => {
    const source = makeSource();
    const payload = buildClonedPageCreatePayload(source, [source]);

    expect(payload.templateId).toBe("tpl-1");
    expect(payload.templateKind).toBe("modular");
    expect(payload.themeId).toBe("theme-abc");
    expect(payload.theme?.typography.fonts.heading).toBe("Georgia");
    expect(payload.theme).not.toBe(source.theme);
  });

  it("omits themeId when source has none", () => {
    const source = { ...makeSource(), themeId: undefined };
    const payload = buildClonedPageCreatePayload(source, [source]);
    expect(payload.themeId).toBeUndefined();
  });
});

describe("getImageOverlayStyle", () => {
  it("moves center-anchored overlays down when Y offset is negative", () => {
    const style = getImageOverlayStyle({
      overlayAnchor: "center",
      offsetX: "-45",
      offsetY: "-300"
    });

    expect(style.transform).toBe("translate(-50%, -50%) translate(-45px, 300px)");
  });

  it("moves center-anchored overlays up when Y offset is positive", () => {
    const style = getImageOverlayStyle({
      overlayAnchor: "center",
      offsetY: "120"
    });

    expect(style.transform).toBe("translate(-50%, -50%) translate(0px, -120px)");
  });
});

describe("getSpeechBubbleModuleStyle", () => {
  it("nudges speech bubbles using signed horizontal and vertical offsets", () => {
    const style = getSpeechBubbleModuleStyle({
      offsetX: "24",
      offsetY: "-40"
    });

    expect(style.transform).toBe("translate(24px, 40px)");
    expect(style.zIndex).toBe(10);
  });

  it("leaves transform unset when both offsets are zero", () => {
    const style = getSpeechBubbleModuleStyle({
      offsetX: "0",
      offsetY: "0"
    });

    expect(style.transform).toBeUndefined();
  });

  it("applies container width and minimum height variables in embedded layout", () => {
    const style = getSpeechBubbleModuleStyle(
      {
        containerWidth: "640",
        containerHeight: "220"
      },
      "embedded"
    );

    expect(style.width).toBe("min(640px, 100%)");
    expect(style.maxWidth).toBe("min(640px, 100%)");
    expect(style["--speech-bubble-container-width"]).toBe("640px");
    expect(style["--speech-bubble-container-min-height"]).toBe("220px");
  });

  it("uses viewport cap for overlay layout (game / full-screen events)", () => {
    const style = getSpeechBubbleModuleStyle(
      {
        containerWidth: "720"
      },
      "overlay"
    );

    expect(style.width).toBe("min(720px, calc(100vw - 48px))");
    expect(style.maxWidth).toBe("min(720px, calc(100vw - 48px))");
  });

  it("omits minimum height when container height is zero", () => {
    const style = getSpeechBubbleModuleStyle({
      containerWidth: "520",
      containerHeight: "0"
    });

    expect(style["--speech-bubble-container-width"]).toBe("520px");
    expect(style["--speech-bubble-container-min-height"]).toBeUndefined();
  });
});

describe("getSpeechBubbleBodyStyle", () => {
  it("sets min-height when container height is configured", () => {
    expect(getSpeechBubbleBodyStyle({ containerHeight: "180" })).toMatchObject({
      width: "100%",
      minHeight: "180px",
      boxSizing: "border-box",
      "--speech-bubble-bg": "#ffffff"
    });
  });

  it("always spans the outer shell width", () => {
    expect(getSpeechBubbleBodyStyle({ containerHeight: "0", backgroundColor: "#f8fdff" })).toMatchObject({
      width: "100%",
      boxSizing: "border-box",
      "--speech-bubble-bg": "#f8fdff"
    });
  });
});

describe("getHeadingModuleStyle", () => {
  it("nudges headings using signed horizontal and vertical offsets", () => {
    const style = getHeadingModuleStyle({
      fontSize: "32",
      horizontalOffset: "12",
      verticalOffset: "8"
    });

    expect(style.transform).toBe("translate(12px, -8px)");
    expect(style.position).toBe("relative");
    expect(style.marginBottom).toBe("-8px");
  });

  it("zeros default heading margins so h3–h6 presets do not inherit browser spacing", () => {
    const style = getHeadingModuleStyle({ fontSize: "14" });

    expect(style.margin).toBe(0);
  });
});

describe("module width styles", () => {
  it("clamps poll module width to supported percentages", () => {
    expect(getModuleWidthStyle({ size: "66" })).toEqual({
      width: "66%",
      maxWidth: "100%",
      boxSizing: "border-box"
    });
  });

  it("aligns undersized poll modules within the column", () => {
    expect(getModuleWidthShellStyle({ size: "75", alignment: "center" })).toMatchObject({
      width: "75%",
      alignSelf: "center"
    });
    expect(getModuleWidthShellStyle({ size: "100", alignment: "left" })).toMatchObject({
      width: "100%",
      alignSelf: "stretch"
    });
  });
});

describe("getThemeRootVars", () => {
  it("emits no custom properties for a default (no-op) theme", () => {
    expect(getThemeRootVars(createDefaultTheme())).toEqual({});
    expect(getThemeRootVars(undefined)).toEqual({});
  });

  it("resolves font keys to stacks and emits set colors only", () => {
    const vars = getThemeRootVars(
      normalizeTheme({
        typography: {
          fonts: { heading: "oswald", body: "lora", mono: "" },
          colors: { text: "#214c71", link: "#0f4f8f" }
        }
      })
    ) as Record<string, string>;

    expect(vars["--bx-font-heading"]).toBe("'Oswald', 'Arial Narrow', sans-serif");
    expect(vars["--bx-font-body"]).toBe("'Lora', Georgia, serif");
    expect(vars).not.toHaveProperty("--bx-font-mono");
    expect(vars["--bx-text"]).toBe("#214c71");
    expect(vars["--bx-link"]).toBe("#0f4f8f");
    expect(vars).not.toHaveProperty("--bx-heading");
  });

  it("derives the H1–H6 scale from baseSize × ratio^(6 − level)", () => {
    const vars = getThemeRootVars(
      normalizeTheme({
        typography: { scale: { baseSize: 16, ratio: 1.25, baseLineHeight: 1.5 } }
      })
    ) as Record<string, string>;

    expect(vars["--bx-size-base"]).toBe("16px");
    expect(vars["--bx-line-base"]).toBe("1.5");
    expect(vars["--bx-size-h6"]).toBe("16px"); // ratio^0
    expect(vars["--bx-size-h5"]).toBe("20px"); // 16 × 1.25
    expect(vars["--bx-size-h1"]).toBe("48.83px"); // 16 × 1.25^5, rounded
  });

  it("omits the derived scale unless both baseSize and ratio are set", () => {
    const vars = getThemeRootVars(
      normalizeTheme({ typography: { scale: { baseSize: 18, ratio: 0, baseLineHeight: 0 } } })
    ) as Record<string, string>;

    expect(vars["--bx-size-base"]).toBe("18px");
    expect(vars).not.toHaveProperty("--bx-size-h1");
  });
});

describe("getBuilderThemeStyleVars", () => {
  it("emits no custom properties when styles are absent", () => {
    expect(getBuilderThemeStyleVars(undefined)).toEqual({});
  });

  it("maps saved theme margins and container tokens to shell CSS variables", () => {
    const vars = getBuilderThemeStyleVars(
      buildBuilderThemeStyles({
        primaryColor: "#0b82d4",
        backgroundColor: "#f5fbff",
        accentColor: "#1a4f81",
        borderThickness: 2,
        borderRadius: 16,
        containerBlur: 4,
        contrastLevel: 20,
        topMargin: 12,
        bottomMargin: 24,
        sideMargins: 80,
      })
    ) as Record<string, string>;

    expect(vars["--bx-theme-padding-top"]).toBe("12px");
    expect(vars["--bx-theme-padding-bottom"]).toBe("24px");
    expect(vars["--bx-theme-padding-inline"]).toBe("80px");
    expect(vars["--lp-border-thickness"]).toBe("2px");
    expect(vars["--lp-radius"]).toBe("16px");
    expect(vars["--lp-blur"]).toBe("4px");
    expect(vars["--lp-filter"]).toBe("contrast(1.2)");
    expect(vars["--lp-accent"]).toBe("#1a4f81");
    expect(vars).not.toHaveProperty("--lp-background");
  });
});
