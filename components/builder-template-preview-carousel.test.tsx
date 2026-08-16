import { readFileSync } from "node:fs";
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
 * Height, per format.
 *
 * These exist because the merged module shipped with Height wired to the
 * frame in BOTH formats, which on a card slider is an element whose height
 * comes from its cards — so the number changed nothing visible except the
 * empty band it added underneath, while a hard-coded 180px picture box
 * cropped every card image (operator, 2026-08-16). The renderer tests above
 * all passed throughout: they asserted the setting was READ, never that it
 * reached the thing an operator was looking at.
 */
describe("carousel height", () => {
  const cards = (settings = {}) =>
    render({ type: "carousel", settings: { format: "cards", items: LEGACY_SLIDER_ITEMS, ...settings } });

  it("sizes a slideshow's frame", () => {
    expect(slideshow({ heightPx: "420" })).toContain("height:420px");
  });

  it("sizes a card's picture, not the row it scrolls in", () => {
    const html = cards({ heightPx: "600" });
    // The picture box carries it...
    const imageBox = html.slice(html.indexOf("builder-preview-carousel-card-image"));
    expect(imageBox).toContain("height:600px");
    // ...and the scrolling row does not, or the row grows past its cards and
    // leaves the empty band the operator reported.
    const row = html.slice(html.indexOf("builder-preview-carousel-cards"), html.indexOf("builder-preview-carousel-card-image"));
    expect(row).not.toContain("height:600px");
  });

  // Scoped to the picture's own tag: the surrounding page carries plenty of
  // unrelated zeroes (`--builder-section-min-height:0px`), and an assertion
  // over the whole document would catch those instead.
  const cardImageTag = (html: string) => {
    const at = html.indexOf("builder-preview-carousel-card-image");
    return html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at) + 1);
  };

  it("leaves the picture unbounded on auto, so nothing is cropped", () => {
    expect(cardImageTag(cards({ heightPx: "0" }))).not.toContain("height");
  });

  it("treats a missing height the same as auto", () => {
    expect(cardImageTag(cards())).not.toContain("height");
  });

  /**
   * The OTHER half of the same bug lived in CSS, where no markup test can
   * reach it: `.builder-preview-carousel-card-image` carried `height: 180px`,
   * so `object-fit: cover` cropped every card picture to that box no matter
   * what the markup said. Three of the tests written alongside this one
   * passed happily against the broken build for exactly that reason, which is
   * worth stating rather than quietly deleting them.
   *
   * So this one reads the stylesheet. Crude, and the only kind of guard the
   * repo has for CSS at all (CLAUDE.md: "nothing tests CSS") — but it fails
   * for real if a future edit pins that box's height again.
   */
  it("does not pin the picture's height in CSS either", () => {
    const css = readFileSync(
      new URL("../src/css/_builder-react-overrides.css", import.meta.url),
      "utf8"
    );
    const at = css.indexOf(".builder-react-root .builder-preview-carousel-card-image {");
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).not.toMatch(/(^|[^-])height\s*:/m);
  });
});

/**
 * The image frame — border, corner and drop shadow (operator, 2026-08-16:
 * "full border control that applies to all images, including dropshadows").
 *
 * Asserted on the RENDERED page for the reason the Height tests above record:
 * a control whose value reaches no element looks identical in the panel to
 * one that works (doctrine E7). Where the frame LANDS is the whole question
 * here — the slideshow's frame is the picture, a card's picture is its own
 * box — and it is exactly what a settings-level test cannot see.
 */
describe("carousel image frame", () => {
  const cards = (settings = {}) =>
    render({ type: "carousel", settings: { format: "cards", items: LEGACY_SLIDER_ITEMS, ...settings } });

  const cardImageTag = (html: string) => {
    const at = html.indexOf("builder-preview-carousel-card-image");
    return html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at) + 1);
  };

  const slideshowFrameTag = (html: string) => {
    const at = html.indexOf("builder-preview-carousel-slideshow");
    return html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at) + 1);
  };

  it("puts the border on the slideshow's frame, which IS its picture", () => {
    const tag = slideshowFrameTag(slideshow({ imageBorderWidth: "8", imageBorderColor: "#ff0000" }));
    expect(tag).toContain("border:8px solid #ff0000");
  });

  it("puts the border on each card's picture, not on the row or the copy", () => {
    const html = cards({ imageBorderWidth: "4", imageBorderColor: "#00ff00" });
    expect(cardImageTag(html)).toContain("border:4px solid #00ff00");
    // The row is the scroller; a border there would frame the whole shelf.
    const row = html.slice(
      html.indexOf("builder-preview-carousel-cards"),
      html.indexOf("builder-preview-carousel-card-image")
    );
    expect(row).not.toContain("border:4px");
  });

  it("gives every card the same frame — there is no per-item version", () => {
    const html = cards({ imageBorderWidth: "4" });
    expect([...html.matchAll(/border:4px solid/g)]).toHaveLength(2);
  });

  it("rounds both formats by 8px when nobody has touched the setting", () => {
    expect(slideshowFrameTag(slideshow())).toContain("border-radius:8px");
    expect(cardImageTag(cards())).toContain("border-radius:8px");
  });

  it("squares the corners when the operator asks for 0", () => {
    expect(slideshowFrameTag(slideshow({ imageBorderRadius: "0" }))).toContain("border-radius:0px");
    expect(cardImageTag(cards({ imageBorderRadius: "0" }))).toContain("border-radius:0px");
  });

  /**
   * Operator, 2026-08-16: "allow the radius to go all the way to 0px". The
   * control offered 0 from the day it shipped, but the card ROW carries its
   * own 8px rounding in CSS and clips to it, so the outer corners of the
   * first and last card stayed rounded whatever the pictures said — square
   * everywhere except the two corners anyone would look at first.
   */
  it("stops the card row rounding more than its cards do", () => {
    const rowTag = (html: string) => {
      const at = html.indexOf("builder-preview-carousel-cards");
      return html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at) + 1);
    };
    expect(rowTag(cards({ imageBorderRadius: "0" }))).toContain("border-radius:0px");
    expect(rowTag(cards({ imageBorderRadius: "24" }))).toContain("border-radius:24px");
  });

  it("keeps the height setting alongside the frame", () => {
    // Both land on the same element in each format, so one must not eat the
    // other — the bug this style of merge invites.
    expect(slideshowFrameTag(slideshow({ heightPx: "420", imageBorderWidth: "2" }))).toContain(
      "height:420px"
    );
    const tag = cardImageTag(cards({ heightPx: "300", imageBorderWidth: "2" }));
    expect(tag).toContain("height:300px");
    expect(tag).toContain("border:2px");
  });

  it("draws the drop shadow on the picture in both formats", () => {
    expect(slideshowFrameTag(slideshow({ imageShadow: "true" }))).toContain(
      "box-shadow:0px 6px 18px 0px rgba(0, 0, 0, 0.3)"
    );
    expect(cardImageTag(cards({ imageShadow: "true" }))).toContain("box-shadow:0px 6px 18px");
  });

  /**
   * `overflow-x: auto` on the card row clips the vertical axis whether or not
   * anything asks it to, so a shadow under a card is cut off at the card's
   * own edge. The row is given room instead — vertically only, because
   * horizontal padding would move every scroll offset the card loop counts in.
   */
  it("makes room under the cards for the shadow to fall into", () => {
    const html = cards({ imageShadow: "true" });
    const row = html.slice(
      html.indexOf("builder-preview-carousel-cards"),
      html.indexOf("builder-preview-carousel-card-image")
    );
    expect(row).toContain("padding-top:24px");
    expect(row).toContain("padding-bottom:24px");
  });

  it("adds no gutter when there is no shadow to make room for", () => {
    // The row's own tag, not the page: the section around it carries padding
    // of its own and an assertion over the document would read that instead.
    const html = cards();
    const at = html.indexOf("builder-preview-carousel-cards");
    const rowTag = html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at) + 1);
    expect(rowTag).not.toContain("padding-top:");
  });

  it("leaves the slideshow's frame unpadded — nothing clips it", () => {
    expect(slideshowFrameTag(slideshow({ imageShadow: "true" }))).not.toContain("padding-top");
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
