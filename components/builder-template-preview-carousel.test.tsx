import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/** The retired `slideshow` shape, exactly as live documents still carry it. */
const LEGACY_SLIDES = JSON.stringify([
  { id: "a", url: "https://example.com/a.png", alt: "First" },
  { id: "b", url: "https://example.com/b.png", alt: "Second" }
]);

/** The retired `slider` shape. */
const LEGACY_SLIDER_ITEMS = JSON.stringify([
  { id: "s1", title: "One", body: "Body one", imageUrl: "https://example.com/1.png", linkUrl: "/one" },
  { id: "s2", title: "Two", body: "Body two", imageUrl: "https://example.com/2.png", linkUrl: "" }
]);

function render(module: { type: string; settings: Record<string, string> }) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Carousel",
          layout: "single",
          background: { mode: "color", color: "#ffffff" },
          modules: [{ id: "m1", column: "main", ...module }]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

const slideshow = (settings: Record<string, string> = {}) =>
  render({ type: "carousel", settings: { format: "slideshow", items: LEGACY_SLIDES, ...settings } });

/**
 * The merge itself: a page saved before 2026-08-16 renders as what it was.
 *
 * These assert on the RENDERED page rather than on the normalizer's output,
 * because the failure this guards against is not "the settings look wrong" —
 * it is landmine 1, where an unrecognized type is silently coerced to `text`
 * and the module's content disappears from the page with no error. A test on
 * settings alone would still pass while the page rendered an empty text box.
 */
describe("carousel — retired module types", () => {
  it("renders a stored `slideshow` module as a slideshow", () => {
    const html = render({ type: "slideshow", settings: { slides: LEGACY_SLIDES } });
    expect(html).toContain("builder-preview-carousel-slideshow");
    expect(html).toContain("https://example.com/a.png");
    expect(html).toContain("https://example.com/b.png");
    // The specific way this breaks: coerced to a text module instead.
    expect(html).not.toContain("builder-preview-text");
  });

  it("renders a stored `slider` module as the cards format", () => {
    const html = render({ type: "slider", settings: { sliderItems: LEGACY_SLIDER_ITEMS } });
    expect(html).toContain("builder-preview-carousel-cards");
    expect(html).toContain("Body one");
    expect(html).toContain("https://example.com/2.png");
    expect(html).not.toContain("builder-preview-text");
  });

  it("keeps a slider's per-item link", () => {
    const html = render({ type: "slider", settings: { sliderItems: LEGACY_SLIDER_ITEMS } });
    expect(html).toContain('href="/one"');
  });

  it("carries the old card width and gap spellings across", () => {
    const html = render({
      type: "slider",
      settings: { sliderItems: LEGACY_SLIDER_ITEMS, sliderCardWidth: "360", sliderGap: "24" }
    });
    expect(html).toContain("min-width:360px");
    expect(html).toContain("gap:24px");
  });
});

/**
 * Behaviour each format inherited from the other half of the merge. Before
 * 2026-08-16 a slideshow could not be moved by a visitor at all and a card
 * shelf could not advance on its own.
 */
describe("carousel — the union of the two modules", () => {
  it("gives a slideshow the arrows the card slider had", () => {
    expect(slideshow()).toContain("builder-preview-carousel-arrow");
  });

  it("gives both formats the dots neither had", () => {
    expect(slideshow({ showDots: "true" })).toContain("builder-preview-carousel-dot");
    const cards = render({
      type: "carousel",
      settings: { format: "cards", items: LEGACY_SLIDER_ITEMS, showDots: "true" }
    });
    expect(cards).toContain("builder-preview-carousel-dot");
  });

  it("hides controls that were switched off", () => {
    const html = slideshow({ showArrows: "false", showDots: "false" });
    expect(html).not.toContain("builder-preview-carousel-arrow");
    expect(html).not.toContain("builder-preview-carousel-dot");
  });

  it("renders no caption until captions are switched on", () => {
    const withCopy = JSON.stringify([
      { id: "a", imageUrl: "https://example.com/a.png", title: "Summer camp", body: "Now open" }
    ]);
    expect(render({ type: "carousel", settings: { format: "slideshow", items: withCopy } })).not.toContain(
      "Summer camp"
    );
    expect(
      render({ type: "carousel", settings: { format: "slideshow", items: withCopy, showCaptions: "true" } })
    ).toContain("Summer camp");
  });

  it("places the caption where the setting says", () => {
    const withCopy = JSON.stringify([
      { id: "a", imageUrl: "https://example.com/a.png", title: "Centered" }
    ]);
    const html = render({
      type: "carousel",
      settings: { format: "slideshow", items: withCopy, showCaptions: "true", captionPosition: "center" }
    });
    expect(html).toContain("builder-preview-carousel-caption-center");
  });

  it("refuses fade on the cards format, where there is nothing to fade between", () => {
    const html = render({
      type: "carousel",
      settings: { format: "cards", items: LEGACY_SLIDER_ITEMS, transition: "fade" }
    });
    expect(html).not.toContain("builder-preview-carousel-fade");
  });

  it("keeps fade on the slideshow format", () => {
    expect(slideshow({ transition: "fade" })).toContain("builder-preview-carousel-fade");
  });
});

/**
 * The nudge, added 2026-08-12 with the two controls in the panel's left
 * column and inherited unchanged by the merged module.
 *
 * Asserted on the RENDERED page, not on the settings editor: a control whose
 * value nothing reads looks identical in the panel to one that works, and
 * that is exactly the failure doctrine E7 names. The published site renders
 * through this same component (`BuilderPublicSitePage`), so a pass here is a
 * pass on the live page.
 */
describe("carousel offset", () => {
  it("emits no transform at all while both offsets are zero", () => {
    const html = slideshow();
    const frame = html.slice(html.indexOf("builder-preview-carousel"));
    expect(frame).not.toContain("translate(");
  });

  it("moves the carousel right and up on positive values", () => {
    // Vertical is inverted on purpose — the label promises "positive moves up",
    // and CSS y grows downward.
    expect(slideshow({ horizontalOffset: "40", verticalOffset: "25" })).toContain(
      "translate(40px, -25px)"
    );
  });

  it("moves it left and down on negative values", () => {
    expect(slideshow({ horizontalOffset: "-30", verticalOffset: "-15" })).toContain(
      "translate(-30px, 15px)"
    );
  });

  it("keeps the height setting when a nudge is applied", () => {
    const html = slideshow({ heightPx: "420", horizontalOffset: "10" });
    expect(html).toContain("height:420px");
    expect(html).toContain("translate(10px, 0px)");
  });

  it("clamps a value the document should never have carried", () => {
    // normalizeBuilderModuleSettingsForType runs on load, so an imported page
    // cannot smuggle a 9,000px offset through. Asserted as the clamped value
    // rather than "not 9000px", which would also pass if the nudge silently
    // stopped rendering at all.
    expect(slideshow({ horizontalOffset: "9000" })).toContain("translate(500px, 0px)");
  });
});
