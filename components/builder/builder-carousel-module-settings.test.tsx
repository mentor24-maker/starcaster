import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderCarouselModuleSettings, carouselFormatSupports } from "./builder-carousel-module-settings";
import { BuilderSocialModuleSettings } from "./builder-social-module-settings";
import { createEmptyModule, normalizeBuilderModuleSettingsForType } from "@/lib/builder-template";

const ITEMS = JSON.stringify([
  {
    id: "a",
    title: "Junior programs",
    body: "Camps and clinics",
    imageUrl: "https://example.com/a-very-long-blob-storage-url.png",
    imageAlt: "First slide",
    linkUrl: "/juniors",
    linkLabel: "See the schedule"
  },
  { id: "b", title: "", body: "", imageUrl: "", imageAlt: "", linkUrl: "", linkLabel: "" }
]);

/**
 * Rendered through the normalizer, not from a raw object: the panel reads
 * format-dependent defaults that `normalizeBuilderModuleSettingsForType`
 * resolves on load, so a test that hands it bare settings is testing a state
 * the app never puts it in.
 */
function panelHtml(settings: Record<string, string> = {}) {
  const m = {
    ...createEmptyModule("carousel"),
    settings: normalizeBuilderModuleSettingsForType("carousel", { items: ITEMS, ...settings })
  };
  return renderToStaticMarkup(
    <BuilderCarouselModuleSettings module={m as never} onUpdateModule={() => {}} />
  );
}

/**
 * The Carousel editor, inherited from the Slideshow panel rebuilt 2026-08-12
 * to the Feature Cards shape and extended by the 2026-08-16 merge.
 *
 * Asserted on rendered markup rather than on the source: "settings left,
 * items right" is two class names that a refactor can drop without breaking
 * anything visible in a diff, and the panel it replaced was a stacked column
 * of `label.field` boxes that looked perfectly reasonable in TSX.
 */
describe("Carousel settings editor", () => {
  it("leaves column 1 to the module chrome, which it does not render", () => {
    const html = panelHtml();
    expect(html).toContain("builder-cards-panel");
    expect(html).toContain("builder-cards-panel-items");
    /**
     * Operator, 2026-08-12: Playback moved out of the left column, leaving it
     * holding nothing this component renders — the chrome fills it by itself,
     * from `builder-module-card.tsx`.
     *
     * This used to assert that no `builder-cards-panel-settings` existed at
     * all, which stopped being the right test on 2026-08-16 when Image Border
     * took a column of its own (the operator's second column, not a rebuilt
     * first one). What must never come back is the CHROME, so that is what is
     * named now — a duplicate Label or margin here would be two controls
     * writing one setting, which is the drift the original guard was for.
     */
    for (const chrome of [">Label<", ">Background<", ">Alignment<", ">V Margin<", ">H Margin<"]) {
      expect(html).not.toContain(chrome);
    }
  });

  it("puts Format first, then playback, then the items", () => {
    const html = panelHtml();
    const heading = html.indexOf("Carousel</div>");
    const format = html.indexOf(">Format<");
    const playback = html.indexOf(">Playback<");
    const items = html.indexOf(">Slides<");
    const grid = html.indexOf("builder-item-grid--carousel");
    expect(heading).toBeGreaterThan(-1);
    expect(heading).toBeLessThan(format);
    // Format governs which other controls exist, so it cannot sit among them.
    expect(format).toBeLessThan(playback);
    expect(playback).toBeLessThan(items);
    expect(items).toBeLessThan(grid);
    // Each group's fields sit in their own lattice column, not in the one that
    // would swallow the item grid below them.
    expect(html).toContain("builder-schema-panel-column");
  });

  it("puts the items in a titled-column item grid, one row per item", () => {
    const html = panelHtml();
    expect(html).toContain("builder-item-grid--carousel");
    for (const header of ["Image", "Alt text", "Action"]) {
      expect(html).toContain(`>${header}</span>`);
    }
    // Two items seeded, so two of each per-row control.
    expect([...html.matchAll(/aria-label="Slide \d+ alt text"/g)]).toHaveLength(2);
    expect([...html.matchAll(/builder-item-grid-picker/g)]).toHaveLength(2);
  });
});

/**
 * The merge's central promise: `format` decides which controls exist, and it
 * decides it in ONE place that the renderer reads too.
 *
 * A control the format cannot use is HIDDEN rather than disabled — a disabled
 * control still reads as "a thing this module does", which is the confusion
 * the merge exists to end.
 */
describe("format-specific controls", () => {
  it("agrees with the renderer about what each format supports", () => {
    expect(carouselFormatSupports("slideshow")).toEqual({
      transition: true,
      cardWidth: false,
      captions: true
    });
    expect(carouselFormatSupports("cards")).toEqual({
      transition: false,
      cardWidth: true,
      captions: false
    });
  });

  it("offers Transition and Captions on a slideshow, and no Card width", () => {
    const html = panelHtml({ format: "slideshow" });
    expect(html).toContain(">Transition<");
    expect(html).toContain(">Captions<");
    expect(html).not.toContain(">Card width<");
  });

  it("offers Card width on a card slider, and neither Transition nor Captions", () => {
    const html = panelHtml({ format: "cards" });
    expect(html).toContain(">Card width<");
    // Fade needs one item to fade between; several cards share the frame.
    expect(html).not.toContain(">Transition<");
    expect(html).not.toContain(">Captions<");
  });

  it("names the items for the format an operator chose", () => {
    expect(panelHtml({ format: "slideshow" })).toContain(">Slides<");
    expect(panelHtml({ format: "cards" })).toContain(">Cards<");
  });

  it("shows both formats the controls the merge gave them", () => {
    // Neither module had both: the slideshow could not be moved by hand at
    // all, and the card slider never advanced on its own.
    for (const format of ["slideshow", "cards"]) {
      const html = panelHtml({ format });
      expect(html).toContain(">Arrows<");
      expect(html).toContain(">Dots<");
      expect(html).toContain(">Auto-advance<");
    }
  });

  it("keeps a slideshow's caption copy fields behind the Captions toggle", () => {
    // With captions off there is nowhere on the slide for title and body to
    // appear, and an editor that collects copy nothing renders is the defect
    // this merge is cleaning up.
    expect(panelHtml({ format: "slideshow" })).not.toContain(">Caption title<");
    expect(panelHtml({ format: "slideshow", showCaptions: "true" })).toContain(">Caption title<");
    // The link is the exception — a slide can be clickable with no text.
    expect(panelHtml({ format: "slideshow" })).toContain(">Link<");
  });
});

/**
 * The image frame, asked for on 2026-08-16. It is one of the few groups here
 * that is NOT format-specific: the operator asked for a border "that applies
 * to all images", so both formats get the identical set.
 */
describe("image border controls", () => {
  it("offers the whole set on both formats", () => {
    for (const format of ["slideshow", "cards"]) {
      const html = panelHtml({ format });
      expect(html).toContain(">Image Border<");
      for (const label of [">Style<", ">Border<", ">Border Color<", ">Radius<", ">Drop Shadow<"]) {
        expect(html).toContain(label);
      }
    }
  });

  it("keeps the shadow's own numbers behind its checkbox", () => {
    // Five dead number boxes is what an Advanced section used to hide, and A0
    // retired those — so they appear when the shadow does, and not before.
    const off = panelHtml();
    for (const label of [">Shadow Color<", ">Shadow X<", ">Shadow Blur<", ">Shadow Opacity<"]) {
      expect(off).not.toContain(label);
    }
    const on = panelHtml({ imageShadow: "true" });
    for (const label of [">Shadow Color<", ">Shadow X<", ">Shadow Y<", ">Shadow Blur<", ">Shadow Spread<", ">Shadow Opacity<"]) {
      expect(on).toContain(label);
    }
  });

  /**
   * Operator, 2026-08-16: "move the border controls into its own column to
   * the right of Settings". A column, not a group: it is placed by document
   * order (the CSS puts the panel's settings half in track 2 and its items
   * half in track 3), so its position in the markup IS the layout.
   */
  it("is its own column between the chrome and the carousel", () => {
    const html = panelHtml({ format: "cards" });
    const column = html.indexOf("builder-cards-panel-settings");
    const items = html.indexOf("builder-cards-panel-items");
    expect(column).toBeGreaterThan(-1);
    expect(column).toBeLessThan(items);
    // Its own column name, at column size rather than group size.
    expect(html).toContain('class="builder-cards-panel-heading">Image Border<');
    // And it is a lattice column of its own, so its labels stop setting the
    // track for Format, Loop and Gap.
    const heading = html.indexOf(">Image Border<");
    expect(html.lastIndexOf("builder-schema-panel-column", heading)).toBeGreaterThan(-1);
  });

  it("keeps the carousel's own groups out of it", () => {
    const html = panelHtml({ format: "cards" });
    const border = html.indexOf(">Image Border<");
    const carousel = html.indexOf("builder-cards-panel-items");
    // Everything the module does that is not the picture frame stays in the
    // column to its right.
    for (const group of [">Format<", ">Playback<", ">Controls<", ">Size<"]) {
      expect(html.indexOf(group)).toBeGreaterThan(carousel);
    }
    expect(border).toBeLessThan(carousel);
  });

  it("shows the frame an untouched carousel already has", () => {
    // 8px is what the stylesheet rounded both formats by before this control
    // existed; a panel that showed 0 there would be lying about the page.
    const html = panelHtml();
    const at = html.indexOf(">Radius<");
    const select = html.slice(html.indexOf("<select", at), html.indexOf("</select>", at));
    expect(select).toContain('value="8"');
    expect(select).toContain('selected=""');
  });

  it("offers 0 — square corners are a choice, not just the floor", () => {
    const html = panelHtml();
    const at = html.indexOf(">Radius<");
    const select = html.slice(html.indexOf("<select", at), html.indexOf("</select>", at));
    expect(select).toContain('value="0"');
  });
});

/**
 * W8, widened to spacing 2026-08-12. Operator: "slideshow module also has
 * sizes incremented by 1 that should be 5."
 *
 * Social stands in for the shared four-margin strip every hand-written panel
 * renders — the point is that the step survives the trip through
 * BuilderNumberSelectControl, which a source-level check cannot tell.
 */
describe("spacing dropdowns count in fives", () => {
  it("a 0–160 margin holds 33 options, not 161", () => {
    const m = { ...createEmptyModule("social"), settings: {} };
    const html = renderToStaticMarkup(
      <BuilderSocialModuleSettings
        module={m as never}
        onUpdateModule={() => {}}
        onUpdateModuleBackground={() => {}}
        onOpenGallery={() => {}}
      />
    );
    const at = html.indexOf("Top Margin");
    const chunk = html.slice(html.indexOf("<select", at), html.indexOf("</select>", at));
    const opts = [...chunk.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((x) => x[1]);
    expect(opts).toHaveLength(33);
    expect(opts.slice(0, 4)).toEqual(["0", "5", "10", "15"]);
  });
});
