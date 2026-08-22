import { describe, expect, it } from "vitest";
import {
  BUILDER_MODULE_TYPES,
  normalizeModuleType,
  normalizeBuilderModuleSettingsForType
} from "./builder-template";

const carousel = (settings: Record<string, string>) =>
  normalizeBuilderModuleSettingsForType("carousel", settings);

/**
 * The `slideshow` + `slider` → `carousel` merge, 2026-08-16.
 *
 * The reason this file exists rather than trusting the renderer tests: a
 * retired type name that falls out of `RETIRED_MODULE_TYPES` does not throw
 * and does not warn. It lands on the `return "text"` at the bottom of
 * `normalizeModuleType`, which rewrites the module into an empty text block
 * on the next page load — silent, permanent, and indistinguishable from the
 * operator having deleted it (CLAUDE.md landmine 1).
 */
describe("retired module types keep resolving", () => {
  it("maps both old names to carousel", () => {
    expect(normalizeModuleType("slideshow")).toBe("carousel");
    expect(normalizeModuleType("slider")).toBe("carousel");
  });

  it("does not silently coerce them to text", () => {
    expect(normalizeModuleType("slideshow")).not.toBe("text");
    expect(normalizeModuleType("slider")).not.toBe("text");
  });

  it("no longer offers the retired names as live types", () => {
    // The palette and the fixture both enumerate this list; leaving a retired
    // name in it would put a dead tile back in the module picker.
    expect(BUILDER_MODULE_TYPES).toContain("carousel");
    expect(BUILDER_MODULE_TYPES).not.toContain("slideshow");
    expect(BUILDER_MODULE_TYPES).not.toContain("slider");
  });

  it("still coerces a name that never existed", () => {
    expect(normalizeModuleType("bananas")).toBe("text");
  });
});

describe("carousel settings migration", () => {
  it("folds slideshow slides into items, keeping order and both fields", () => {
    const settings = carousel({
      slides: JSON.stringify([
        { id: "a", url: "https://example.com/a.png", alt: "First" },
        { id: "b", url: "https://example.com/b.png", alt: "Second" }
      ])
    });
    expect(JSON.parse(settings.items)).toEqual([
      expect.objectContaining({ id: "a", imageUrl: "https://example.com/a.png", imageAlt: "First" }),
      expect.objectContaining({ id: "b", imageUrl: "https://example.com/b.png", imageAlt: "Second" })
    ]);
    expect(settings.format).toBe("slideshow");
    expect(settings.slides).toBeUndefined();
  });

  it("folds slider items into items without losing title, body or link", () => {
    const settings = carousel({
      sliderItems: JSON.stringify([
        { id: "s1", title: "One", body: "Copy", imageUrl: "https://example.com/1.png", linkUrl: "/one" }
      ])
    });
    expect(JSON.parse(settings.items)[0]).toEqual(
      expect.objectContaining({ title: "One", body: "Copy", linkUrl: "/one" })
    );
    expect(settings.format).toBe("cards");
    expect(settings.sliderItems).toBeUndefined();
  });

  it("carries the old width and gap spellings and drops the dead one", () => {
    const settings = carousel({
      sliderItems: "[]",
      sliderCardWidth: "360",
      sliderGap: "24",
      // Written onto every Card Slider ever created and read by nothing.
      sliderHeight: "auto"
    });
    expect(settings.cardWidth).toBe("360");
    expect(settings.gap).toBe("24");
    expect(settings.sliderHeight).toBeUndefined();
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = carousel({ slides: JSON.stringify([{ id: "a", url: "https://x/a.png", alt: "A" }]) });
    const twice = carousel(once);
    expect(twice).toEqual(once);
  });

  it("keeps a format the operator has already chosen", () => {
    // Switching a migrated slideshow to cards must survive the next load,
    // even though its items still look exactly like slides.
    const settings = carousel({
      format: "cards",
      items: JSON.stringify([{ id: "a", imageUrl: "https://x/a.png", imageAlt: "A" }])
    });
    expect(settings.format).toBe("cards");
  });

  it("concatenates rather than drops when a document carries both collections", () => {
    const settings = carousel({
      slides: JSON.stringify([{ id: "a", url: "https://x/a.png", alt: "A" }]),
      sliderItems: JSON.stringify([{ id: "b", title: "B", imageUrl: "https://x/b.png" }])
    });
    expect(JSON.parse(settings.items)).toHaveLength(2);
  });

  it("survives unparseable JSON without throwing", () => {
    const settings = carousel({ slides: "{not json" });
    expect(JSON.parse(settings.items)).toEqual([]);
  });
});

describe("carousel defaults follow the format", () => {
  it("auto-advances a slideshow and does not auto-advance cards", () => {
    expect(carousel({ format: "slideshow", items: "[]" }).autoplay).toBe("true");
    expect(carousel({ format: "cards", items: "[]" }).autoplay).toBe("false");
  });

  it("keeps an explicit playback choice against the format default", () => {
    expect(carousel({ format: "cards", items: "[]", autoplay: "true" }).autoplay).toBe("true");
    expect(carousel({ format: "slideshow", items: "[]", autoplay: "false" }).autoplay).toBe("false");
  });

  it("refuses fade on the cards format", () => {
    expect(carousel({ format: "cards", items: "[]", transition: "fade" }).transition).toBe("slide");
    expect(carousel({ format: "slideshow", items: "[]", transition: "fade" }).transition).toBe("fade");
  });

  it("leaves captions off unless explicitly on", () => {
    // A live slideshow gaining text it never had is the one visible change a
    // migration must not make.
    expect(carousel({ format: "slideshow", items: "[]" }).showCaptions).toBe("false");
    expect(carousel({ format: "slideshow", items: "[]", showCaptions: "true" }).showCaptions).toBe("true");
  });

  it("clamps values an imported document should never have carried", () => {
    expect(carousel({ items: "[]", intervalMs: "999999" }).intervalMs).toBe("20000");
    expect(carousel({ items: "[]", cardWidth: "9000" }).cardWidth).toBe("420");
    expect(carousel({ items: "[]", heightPx: "-40" }).heightPx).toBe("0");
    expect(carousel({ items: "[]", captionPosition: "nowhere" }).captionPosition).toBe("bottom-left");
  });
});
