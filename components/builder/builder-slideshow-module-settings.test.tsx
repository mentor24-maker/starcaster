import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderSlideshowModuleSettings } from "./builder-slideshow-module-settings";
import { BuilderSocialModuleSettings } from "./builder-social-module-settings";
import { createEmptyModule } from "@/lib/builder-template";

function slideshowHtml(settings: Record<string, string> = {}) {
  const m = { ...createEmptyModule("slideshow"), settings };
  return renderToStaticMarkup(
    <BuilderSlideshowModuleSettings module={m as never} onUpdateModule={() => {}} />
  );
}

const SLIDES = JSON.stringify([
  { id: "a", url: "https://example.com/a-very-long-blob-storage-url.png", alt: "First slide" },
  { id: "b", url: "", alt: "" }
]);

/**
 * The Slideshow editor, rebuilt 2026-08-12 to the Feature Cards shape.
 *
 * Asserted on rendered markup rather than on the source: "settings left,
 * items right" is two class names that a refactor can drop without breaking
 * anything visible in a diff, and the panel it replaced was a stacked column
 * of `label.field` boxes that looked perfectly reasonable in TSX.
 */
describe("Slideshow settings editor", () => {
  it("renders only the right column — the left one is the module chrome", () => {
    const html = slideshowHtml({ slides: SLIDES });
    expect(html).toContain("builder-cards-panel");
    expect(html).toContain("builder-cards-panel-items");
    // Operator, 2026-08-12: Playback moved out of the left column, which left
    // it holding nothing this component renders. A settings half here again
    // means the split has drifted back.
    expect(html).not.toContain("builder-cards-panel-settings");
  });

  it("puts Playback above the slides, both in the right column", () => {
    const html = slideshowHtml({ slides: SLIDES });
    const heading = html.indexOf("Slideshow</div>");
    const playback = html.indexOf(">Playback<");
    const slidesGroup = html.indexOf(">Slides<");
    const grid = html.indexOf("builder-item-grid--slides");
    expect(heading).toBeGreaterThan(-1);
    expect(heading).toBeLessThan(playback);
    expect(playback).toBeLessThan(slidesGroup);
    expect(slidesGroup).toBeLessThan(grid);
    // Playback's three fields sit in their own lattice column, not in the one
    // that would swallow the item grid below them.
    expect(html).toContain("builder-schema-panel-column");
  });

  it("puts the slides in a titled-column item grid, one row per slide", () => {
    const html = slideshowHtml({ slides: SLIDES });
    expect(html).toContain("builder-item-grid--slides");
    for (const header of ["Image", "Alt text", "Action"]) {
      expect(html).toContain(`>${header}</span>`);
    }
    // Two slides seeded, so two of each per-row control.
    expect([...html.matchAll(/aria-label="Slide \d+ alt text"/g)]).toHaveLength(2);
    expect([...html.matchAll(/builder-item-grid-picker/g)]).toHaveLength(2);
  });

  it("has no label.field boxes left — that shape is what stretched", () => {
    // W9: the old editor was six `<label class="field">` wrappers, each one a
    // full-width box with its label floating above it.
    expect(slideshowHtml({ slides: SLIDES })).not.toContain('class="field');
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
