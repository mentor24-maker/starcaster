import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

const SLIDES = JSON.stringify([
  { id: "a", url: "https://example.com/a.png", alt: "First" },
  { id: "b", url: "https://example.com/b.png", alt: "Second" }
]);

function renderSlideshow(settings: Record<string, string>) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Slideshow",
          layout: "single",
          background: { mode: "color", color: "#ffffff" },
          modules: [{ id: "m1", type: "slideshow", column: "main", settings: { slides: SLIDES, ...settings } }]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

/**
 * The Slideshow nudge, added 2026-08-12 with the two controls in the panel's
 * left column.
 *
 * Asserted on the RENDERED page, not on the settings editor: a control whose
 * value nothing reads looks identical in the panel to one that works, and
 * that is exactly the failure doctrine E7 names. The published site renders
 * through this same component (`BuilderPublicSitePage`), so a pass here is a
 * pass on the live page.
 */
describe("slideshow offset", () => {
  it("emits no transform at all while both offsets are zero", () => {
    const html = renderSlideshow({});
    const frame = html.slice(html.indexOf("builder-preview-slideshow"));
    expect(frame).not.toContain("translate(");
  });

  it("moves the slideshow right and up on positive values", () => {
    // Vertical is inverted on purpose — the label promises "positive moves up",
    // and CSS y grows downward.
    expect(renderSlideshow({ horizontalOffset: "40", verticalOffset: "25" })).toContain(
      "translate(40px, -25px)"
    );
  });

  it("moves it left and down on negative values", () => {
    expect(renderSlideshow({ horizontalOffset: "-30", verticalOffset: "-15" })).toContain(
      "translate(-30px, 15px)"
    );
  });

  it("keeps the height setting when a nudge is applied", () => {
    const html = renderSlideshow({ heightPx: "420", horizontalOffset: "10" });
    expect(html).toContain("height:420px");
    expect(html).toContain("translate(10px, 0px)");
  });

  it("clamps a value the document should never have carried", () => {
    // normalizeBuilderModuleSettingsForType runs on load, so an imported page
    // cannot smuggle a 9,000px offset through. Asserted as the clamped value
    // rather than "not 9000px", which would also pass if the nudge silently
    // stopped rendering at all.
    expect(renderSlideshow({ horizontalOffset: "9000" })).toContain("translate(500px, 0px)");
  });
});
