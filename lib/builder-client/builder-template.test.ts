import { describe, expect, it } from "vitest";
import {
  createDefaultTheme,
  finalizeBackgroundSettings,
  promoteThemeStylesPageBackground,
  finalizeThemeStylesPageBackground,
  formatHeadingContent,
  formatPlainTextContent,
  formatRichTextContent,
  groupJoinedSections,
  headingHtmlFromEditor,
  prepareHeadingHtmlForEditor,
  isPlainTextVariant,
  PLAIN_TEXT_VARIANT,
  prepareRichTextHtmlForStorage,
  normalizeBuilderAssetUrl,
  normalizeBuilderDocument,
  normalizeBuilderModuleSettingsForType,
  normalizeBuilderModules,
  normalizeBuilderSection,
  normalizeLayoutSections,
  normalizeTheme,
  resolveBuilderModuleType,
  resolveModuleColumnForLayout,
  serializeBuilderDocument
} from "@/lib/builder-template";

describe("resolveModuleColumnForLayout", () => {
  it("keeps every column of a wide row addressable", () => {
    for (const column of ["left", "center", "right", "col4", "col5", "col6"]) {
      expect(resolveModuleColumnForLayout(column, "six-column")).toBe(column);
    }
  });

  it("maps legacy col1..col3 into a wide row instead of dumping them in the first column", () => {
    expect(resolveModuleColumnForLayout("col1", "four-column")).toBe("left");
    expect(resolveModuleColumnForLayout("col2", "four-column")).toBe("center");
    expect(resolveModuleColumnForLayout("col3", "four-column")).toBe("right");
    expect(resolveModuleColumnForLayout("main", "four-column")).toBe("left");
  });

  it("folds columns a narrower layout does not have into its first column", () => {
    expect(resolveModuleColumnForLayout("col5", "four-column")).toBe("left");
    expect(resolveModuleColumnForLayout("col4", "three-column")).toBe("left");
  });
});

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

  it("converts the untouched feature-cards factory colors to theme-following", () => {
    const settings = normalizeBuilderModuleSettingsForType("feature-cards", {
      cardBackground: "#ffffff",
      cardBorderColor: "#e1e8f0",
      iconColor: "#0b2a4a",
      iconAltColor: "#4f9c3a"
    });

    expect(settings.cardBackground).toBe("");
    expect(settings.cardBorderColor).toBe("");
    expect(settings.iconColor).toBe("");
    expect(settings.iconAltColor).toBe("");
  });

  it("keeps feature-cards colors when any one differs from the factory set", () => {
    const settings = normalizeBuilderModuleSettingsForType("feature-cards", {
      cardBackground: "#ffffff",
      cardBorderColor: "#e1e8f0",
      iconColor: "#cc0000",
      iconAltColor: "#4f9c3a"
    });

    expect(settings.cardBackground).toBe("#ffffff");
    expect(settings.cardBorderColor).toBe("#e1e8f0");
    expect(settings.iconColor).toBe("#cc0000");
    expect(settings.iconAltColor).toBe("#4f9c3a");
  });
});

describe("navigation style migration", () => {
  const ctx = { id: "nav-1", type: "navigation" as const, column: "main", name: "", text: "" };
  const nav = (settings: Record<string, string>) =>
    normalizeBuilderModuleSettingsForType("navigation", settings, ctx);

  it("splits the old single navPadding string onto the four link padding sides", () => {
    const settings = nav({ navPadding: "6px 20px" });

    expect(settings.navLinkPaddingTop).toBe("6");
    expect(settings.navLinkPaddingBottom).toBe("6");
    expect(settings.navLinkPaddingLeft).toBe("20");
    expect(settings.navLinkPaddingRight).toBe("20");
    expect(settings.navPadding).toBeUndefined();
  });

  it("uses one value for every side when the old string carried only one", () => {
    const settings = nav({ navPadding: "10px" });

    expect(settings.navLinkPaddingTop).toBe("10");
    expect(settings.navLinkPaddingLeft).toBe("10");
  });

  it("never overwrites padding the operator has already set on the new keys", () => {
    const settings = nav({ navPadding: "6px 20px", navLinkPaddingV: "2", navLinkPaddingH: "40" });

    expect(settings.navLinkPaddingTop).toBe("2");
    expect(settings.navLinkPaddingLeft).toBe("40");
  });

  it("gives a menu that was never styled the padding the CSS always drew", () => {
    // The bar ships 8 on every side and the links 0 top/bottom, 14 beside.
    // Migrating those to a flat 0 would have stripped the padding from every
    // live menu on every site.
    const settings = nav({});

    expect(settings.navPaddingTop).toBe("8");
    expect(settings.navPaddingLeft).toBe("8");
    expect(settings.navLinkPaddingTop).toBe("0");
    expect(settings.navLinkPaddingLeft).toBe("14");
  });

  it("turns Bold into a weight, honouring the answer the old control could not deliver", () => {
    expect(nav({ navBold: "true" }).navWeight).toBe("700");
    expect(nav({ navBold: "false" }).navWeight).toBe("500");
    expect(nav({ navBold: "true" }).navBold).toBeUndefined();
  });

  it("folds the nav's own margins onto the standard module margin sides", () => {
    const settings = nav({ navMarginV: "24", navMarginH: "12" });

    expect(settings.marginTop).toBe("24");
    expect(settings.marginBottom).toBe("24");
    expect(settings.marginLeft).toBe("12");
    expect(settings.marginRight).toBe("12");
    expect(settings.navMarginV).toBeUndefined();
    expect(settings.navMarginH).toBeUndefined();
  });

  it("leaves an existing module margin alone rather than clobbering it", () => {
    const settings = nav({ navMarginV: "24", verticalMargin: "8" });
    expect(settings.marginTop).toBe("8");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = nav({ navPadding: "6px 20px", navBold: "false", navMarginV: "24" });
    const twice = nav({ ...once });

    expect(twice).toEqual(once);
  });

  it("leaves a menu that was never styled with nothing to migrate", () => {
    const settings = nav({});

    expect(settings.navLinkPaddingV).toBeUndefined();
    expect(settings.navWeight).toBeUndefined();
    expect(settings.verticalMargin).toBeUndefined();
    expect(settings.marginTop).toBe("0");
  });
});

describe("table border width round-trip", () => {
  const ctx = { id: "t-1", type: "table" as const, column: "main", name: "", text: "" };

  it("keeps the width the editor wrote instead of the mirror key", () => {
    // The reported bug (2026-08-11): border colour changed, border size did
    // not. `borderThickness` is a mirror nothing reads, but it used to take
    // precedence — so the first save stamped it from the default and every
    // later change to borderWidth was overwritten on the next load.
    const settings = normalizeBuilderModuleSettingsForType(
      "table",
      { borderWidth: "4", borderThickness: "1" },
      ctx
    );

    expect(settings.borderWidth).toBe("4");
    expect(settings.borderThickness).toBe("4");
  });

  it("survives a second pass, which is where the revert used to happen", () => {
    const once = normalizeBuilderModuleSettingsForType("table", { borderWidth: "6" }, ctx);
    const twice = normalizeBuilderModuleSettingsForType("table", { ...once }, ctx);
    expect(twice.borderWidth).toBe("6");
  });

  it("still reads the mirror for a module that only ever had one", () => {
    const settings = normalizeBuilderModuleSettingsForType("table", { borderThickness: "3" }, ctx);
    expect(settings.borderWidth).toBe("3");
  });

  it("keeps a deliberate borderless table at 0 rather than the default", () => {
    const settings = normalizeBuilderModuleSettingsForType(
      "table",
      { borderWidth: "0", borderThickness: "1" },
      ctx
    );
    expect(settings.borderWidth).toBe("0");
  });

  it("never sees a blank width — the generic sanitizer coerces it first", () => {
    // normalizeModuleSettings runs ahead of the per-type branch and puts every
    // present borderWidth through normalizeSpacingValue, so "" arrives as the
    // default and the mirror never gets a look-in. Pinned because it is the
    // reason the table branch needs `??` and not an empty-string guard.
    const settings = normalizeBuilderModuleSettingsForType(
      "table",
      { borderWidth: "", borderThickness: "5" },
      ctx
    );
    expect(settings.borderWidth).toBe("1");
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

describe("formatHeadingContent", () => {
  it("renders a plain heading exactly as it always did", () => {
    expect(formatHeadingContent("Play Where Champions Play")).toBe("Play Where Champions Play");
  });

  it("escapes angle brackets and bare ampersands in a plain heading", () => {
    expect(formatHeadingContent("Swim & Tennis")).toBe("Swim &amp; Tennis");
    expect(formatHeadingContent("3 < 5")).toContain("&lt;");
  });

  it("keeps entities the operator typed", () => {
    expect(formatHeadingContent("Book&nbsp;a&nbsp;Court")).toBe("Book&nbsp;a&nbsp;Court");
  });

  it("keeps a recoloured word", () => {
    const html = formatHeadingContent('Play Where <span style="color:#4f9c3a">Champions</span> Play');
    expect(html).toContain('style="color:#4f9c3a"');
    expect(html).toContain("Champions");
  });

  it("keeps a resized word — the whole point of the module-level cap not applying", () => {
    expect(formatHeadingContent('<span style="font-size:120px">PLAY</span>')).toContain("font-size:120px");
  });

  it("keeps line breaks", () => {
    expect(formatHeadingContent("PLAY WHERE<br />CHAMPIONS PLAY").toLowerCase()).toContain("<br");
    expect(formatHeadingContent("PLAY WHERE\nCHAMPIONS PLAY").toLowerCase()).toContain("<br");
  });

  it("unwraps block markup — nothing block-level can live inside a heading", () => {
    const html = formatHeadingContent("<p>Champions</p>");
    expect(html).toContain("Champions");
    expect(html).not.toContain("<p>");
  });

  it("strips scripts and event handlers", () => {
    const html = formatHeadingContent('Safe<script>alert(1)</script><span onclick="alert(1)">Hi</span>');
    expect(html).toContain("Safe");
    expect(html).not.toContain("script");
    expect(html.toLowerCase()).not.toContain("onclick");
  });

  it("is empty for an empty heading", () => {
    expect(formatHeadingContent("")).toBe("");
    expect(formatHeadingContent(undefined)).toBe("");
  });
});

describe("heading editor round trip", () => {
  it("wraps stored markup in the paragraph the editor needs, and unwraps it again", () => {
    const stored = 'Play Where <span style="color:#4f9c3a">Champions</span> Play';
    const editorHtml = prepareHeadingHtmlForEditor(stored);

    expect(editorHtml.startsWith("<p>")).toBe(true);
    expect(headingHtmlFromEditor(editorHtml)).toBe(stored);
  });

  it("gives the editor a paragraph to type into when the heading is empty", () => {
    expect(prepareHeadingHtmlForEditor("")).toBe("<p></p>");
    expect(headingHtmlFromEditor("<p></p>")).toBe("");
  });

  it("turns a paragraph break into a line break", () => {
    // The sanitizer is what emits the final tag, so it comes back as <br>.
    expect(headingHtmlFromEditor("<p>PLAY WHERE</p><p>CHAMPIONS PLAY</p>").toLowerCase()).toBe(
      "play where<br>champions play"
    );
  });

  it("drops the trailing break the editor leaves under the cursor", () => {
    expect(headingHtmlFromEditor("<p>Champions<br></p>")).toBe("Champions");
  });

  it("sanitizes markup typed into the HTML view", () => {
    const html = headingHtmlFromEditor('<p>Safe<script>alert(1)</script></p>');
    expect(html).toContain("Safe");
    expect(html).not.toContain("script");
  });
});

describe("formatPlainTextContent", () => {
  it("never wraps text in a paragraph", () => {
    const html = formatPlainTextContent("Hello");
    expect(html).toBe("Hello");
    expect(html).not.toContain("<p>");
  });

  it("keeps line breaks as <br> instead of paragraphs", () => {
    const html = formatPlainTextContent("Hello\nWorld");
    expect(html).not.toContain("<p>");
    expect(html.toLowerCase()).toContain("<br");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
  });

  it("escapes angle brackets in plain text", () => {
    expect(formatPlainTextContent("3 < 5")).toContain("&lt;");
  });

  it("passes inline markup through the sanitizer", () => {
    const html = formatPlainTextContent('Serving <em>Provo</em> <img src=x onerror=alert(1) />');
    expect(html).toContain("<em>Provo</em>");
    expect(html).not.toContain("<p>");
    expect(html.toLowerCase()).not.toContain("onerror");
  });

  it("keeps line breaks even when the text also contains an inline tag", () => {
    // Regression: `looksLikeHtml` sees one <em> and calls the whole value HTML,
    // which used to drop every newline in it. Found in the browser, 2026-08-11.
    const html = formatPlainTextContent("First line\nsecond <em>line</em>");
    expect(html.toLowerCase()).toContain("<br");
    expect(html).toContain("<em>line</em>");
  });

  it("lets typed character entities through", () => {
    // Regression: escaping every `&` turned a typed &nbsp; into the six
    // literal characters on the page. Reported 2026-08-11 — entities are the
    // only way to type a space HTML will not collapse.
    const html = formatPlainTextContent("Wide&nbsp;&nbsp;&nbsp;gap");
    expect(html).not.toContain("&amp;nbsp;");
    // DOMPurify may re-serialize the entity or emit the character itself;
    // either one renders as a space, and neither is the literal text.
    expect(/&nbsp;| /.test(html)).toBe(true);
    expect(formatPlainTextContent("Ten&#8212;dash")).not.toContain("&amp;#8212;");
  });

  it("still escapes a bare ampersand", () => {
    expect(formatPlainTextContent("Salt & Pepper")).toContain("&amp;");
    expect(formatPlainTextContent("Tom & Jerry & Co")).not.toContain("&amp;amp;");
  });

  it("leaves block-level markup to lay itself out", () => {
    const html = formatPlainTextContent("<h3>Title</h3>\n<div>Body</div>");
    expect(html.toLowerCase()).not.toContain("<br");
    expect(html).toContain("<h3>Title</h3>");
  });

  it("returns an empty string for empty content", () => {
    expect(formatPlainTextContent("")).toBe("");
    expect(formatPlainTextContent(null)).toBe("");
    expect(formatPlainTextContent("   ")).toBe("");
  });
});

describe("isPlainTextVariant", () => {
  it("recognizes the Simple Text palette entry and nothing else", () => {
    expect(isPlainTextVariant({ variant: PLAIN_TEXT_VARIANT })).toBe(true);
    expect(isPlainTextVariant({ variant: "paragraph" })).toBe(false);
    expect(isPlainTextVariant({})).toBe(false);
    expect(isPlainTextVariant(undefined)).toBe(false);
  });

  it("survives a save/load round trip through the normalizer", () => {
    const [module] = normalizeBuilderModules([
      { id: "m1", type: "text", text: "Flush copy", settings: { variant: PLAIN_TEXT_VARIANT } }
    ]);

    expect(module.type).toBe("text");
    expect(isPlainTextVariant(module.settings)).toBe(true);
  });
});

describe("prepareRichTextHtmlForStorage", () => {
  it("drops a trailing empty paragraph after a heading", () => {
    expect(prepareRichTextHtmlForStorage("<h1>Title</h1><p></p>")).toBe("<h1>Title</h1>");
  });

  it("drops trailing paragraphs that contain only a line break", () => {
    expect(prepareRichTextHtmlForStorage("<h2>Title</h2><p><br></p>")).toBe("<h2>Title</h2>");
  });

  it("drops multiple stacked trailing empty blocks", () => {
    expect(prepareRichTextHtmlForStorage("<h1>Title</h1><p></p><p>&nbsp;</p>")).toBe("<h1>Title</h1>");
  });

  it("keeps empty paragraphs that sit between real content", () => {
    expect(prepareRichTextHtmlForStorage("<p>One</p><p></p><p>Two</p>")).toBe("<p>One</p><p></p><p>Two</p>");
  });

  it("keeps a trailing paragraph that still has text", () => {
    expect(prepareRichTextHtmlForStorage("<h1>Title</h1><p>Body</p>")).toBe("<h1>Title</h1><p>Body</p>");
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

  it("defaults widthMode to contained and preserves full-width", () => {
    const contained = normalizeBuilderSection({ id: "s1", title: "", layout: "single", modules: [] });
    expect(contained?.widthMode).toBe("contained");

    const full = normalizeBuilderSection({ id: "s2", title: "", layout: "single", widthMode: "full-width", modules: [] });
    expect(full?.widthMode).toBe("full-width");

    // Anything unrecognized falls back to contained rather than persisting junk.
    const bogus = normalizeBuilderSection({ id: "s3", title: "", layout: "single", widthMode: "wide", modules: [] });
    expect(bogus?.widthMode).toBe("contained");
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

describe("joined rows", () => {
  const row = (id: string, joinWithPrevious: boolean) => ({
    id,
    title: id,
    layout: "single",
    joinWithPrevious,
    modules: []
  });

  it("keeps a joined row's flag through normalization", () => {
    const sections = normalizeLayoutSections([row("a", false), row("b", true)]);

    expect(sections[0]?.joinWithPrevious).toBe(false);
    expect(sections[1]?.joinWithPrevious).toBe(true);
  });

  it("refuses to join the first row, which has nothing above it", () => {
    const sections = normalizeLayoutSections([row("a", true), row("b", false)]);

    expect(sections[0]?.joinWithPrevious).toBe(false);
  });

  it("defaults to not joined, so every existing page renders as it did", () => {
    const sections = normalizeLayoutSections([{ id: "a", layout: "single", modules: [] }]);

    expect(sections[0]?.joinWithPrevious).toBe(false);
  });

  it("gathers a run of joined rows under the row that carries the background", () => {
    const sections = normalizeLayoutSections([
      row("a", false),
      row("b", true),
      row("c", true),
      row("d", false)
    ]);

    const groups = groupJoinedSections(sections);

    expect(groups.map((group) => group.map((section) => section.id))).toEqual([
      ["a", "b", "c"],
      ["d"]
    ]);
  });

  it("puts every unjoined row in a group of its own", () => {
    const sections = normalizeLayoutSections([row("a", false), row("b", false)]);

    expect(groupJoinedSections(sections)).toHaveLength(2);
  });
});

describe("cell spacing sides", () => {
  function firstSection(raw: unknown) {
    return normalizeBuilderDocument({ sections: [raw] }).layoutSections[0];
  }

  it("seeds every side from the legacy all-sides value, so an old row is unchanged", () => {
    const section = firstSection({
      id: "s1",
      layout: "two-column",
      cellPadding: { left: "18", right: "30" },
      modules: []
    });

    expect(section.cellPaddingTop.left).toBe("18");
    expect(section.cellPaddingBottom.left).toBe("18");
    expect(section.cellPaddingLeft.left).toBe("18");
    expect(section.cellPaddingRight.left).toBe("18");
    expect(section.cellPaddingTop.right).toBe("30");
  });

  it("seeds every side from the vertical/horizontal pair that came between", () => {
    const section = firstSection({
      id: "s1",
      layout: "single",
      cellPadding: { main: "18" },
      cellVerticalPadding: { main: "4" },
      cellHorizontalPadding: { main: "40" },
      modules: []
    });

    expect(section.cellPaddingTop.main).toBe("4");
    expect(section.cellPaddingBottom.main).toBe("4");
    expect(section.cellPaddingLeft.main).toBe("40");
    expect(section.cellPaddingRight.main).toBe("40");
  });

  it("lets one side go to zero while the other three keep their value", () => {
    const section = firstSection({
      id: "s1",
      layout: "single",
      cellPadding: { main: "18" },
      cellPaddingTop: { main: "0" },
      modules: []
    });

    expect(section.cellPaddingTop.main).toBe("0");
    expect(section.cellPaddingBottom.main).toBe("18");
    expect(section.cellPaddingLeft.main).toBe("18");
    expect(section.cellPaddingRight.main).toBe("18");
  });

  it("carries the cell's vertical margin onto its top and bottom sides", () => {
    const section = firstSection({
      id: "s1",
      layout: "single",
      cellVerticalMargin: { main: "30" },
      modules: []
    });

    expect(section.cellMarginTop.main).toBe("30");
    expect(section.cellMarginBottom.main).toBe("30");
    // Left and right never existed before, so they start at nothing.
    expect(section.cellMarginLeft.main).toBe("0");
    expect(section.cellMarginRight.main).toBe("0");
  });

  it("clamps each side to the range its control offers", () => {
    const section = firstSection({
      id: "s1",
      layout: "single",
      cellPaddingTop: { main: "9999" },
      cellPaddingLeft: { main: "-20" },
      modules: []
    });

    expect(section.cellPaddingTop.main).toBe("50");
    expect(section.cellPaddingLeft.main).toBe("0");
  });

  it("gives a cell nobody has set no spacing at all, rather than an inset it never asked for", () => {
    const section = firstSection({ id: "s1", layout: "single", modules: [] });

    expect(section.cellPaddingTop.main).toBe("0");
    expect(section.cellPaddingLeft.main).toBe("0");
    expect(section.cellMarginTop.main).toBe("0");
    expect(section.cellBorderRadius.main).toBe("0");
  });
});

/**
 * The one promise this sweep makes: a page saved before 2026-08-11 renders to
 * the same pixels afterwards. Every object carried its spacing as a
 * vertical/horizontal pair (or, for a button, its own paddingX/paddingY);
 * each side inherits from the pair it came from, so nothing moves until the
 * operator moves it.
 */
describe("spacing migrates to four sides without moving anything", () => {
  const ctx = { id: "m-1", name: "", text: "" };
  const settingsFor = (type: string, settings: Record<string, string>) =>
    normalizeBuilderModuleSettingsForType(type as never, settings, ctx as never);

  it("spreads a module's margin pair across its four sides", () => {
    const settings = settingsFor("text", { verticalMargin: "24", horizontalMargin: "12" });

    expect(settings.marginTop).toBe("24");
    expect(settings.marginBottom).toBe("24");
    expect(settings.marginLeft).toBe("12");
    expect(settings.marginRight).toBe("12");
    expect(settings.verticalMargin).toBeUndefined();
    expect(settings.horizontalMargin).toBeUndefined();
  });

  it("never lets a pair overwrite a side the operator already set", () => {
    const settings = settingsFor("text", { verticalMargin: "24", marginTop: "4" });

    expect(settings.marginTop).toBe("4");
    expect(settings.marginBottom).toBe("24");
  });

  it("spreads an image's padding pair the same way", () => {
    const settings = settingsFor("image", { verticalPadding: "8", horizontalPadding: "16" });

    expect(settings.paddingTop).toBe("8");
    expect(settings.paddingBottom).toBe("8");
    expect(settings.paddingLeft).toBe("16");
    expect(settings.paddingRight).toBe("16");
  });

  it("keeps a button the exact shape it shipped with", () => {
    const untouched = settingsFor("button", {});
    expect(untouched.paddingTop).toBe("12");
    expect(untouched.paddingBottom).toBe("12");
    expect(untouched.paddingLeft).toBe("24");
    expect(untouched.paddingRight).toBe("24");

    const styled = settingsFor("button", { paddingY: "6", paddingX: "40" });
    expect(styled.paddingTop).toBe("6");
    expect(styled.paddingLeft).toBe("40");
    expect(styled.paddingX).toBeUndefined();
    expect(styled.paddingY).toBeUndefined();
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = settingsFor("image", { verticalMargin: "10", horizontalPadding: "5" });
    expect(settingsFor("image", { ...once })).toEqual(once);
  });
});
