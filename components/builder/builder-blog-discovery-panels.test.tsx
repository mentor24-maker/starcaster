import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBlogCategoryFilterModuleSettings } from "./builder-blog-category-filter-module-settings";
import { createEmptyModule, normalizeBuilderModuleSettingsForType } from "@/lib/builder-template";

const CATEGORIES = JSON.stringify([
  { id: "a", label: "Junior High Performance Academy", slug: "junior-high-performance-academy" },
  { id: "b", label: "Adult Clinics", slug: "adult-clinics" }
]);

function categoryFilterHtml(settings: Record<string, string> = {}) {
  const m = {
    ...createEmptyModule("blog-category-filter"),
    settings: normalizeBuilderModuleSettingsForType("blog-category-filter", {
      categories: CATEGORIES,
      ...settings
    })
  };
  return renderToStaticMarkup(
    <BuilderBlogCategoryFilterModuleSettings module={m as never} onUpdateModule={() => {}} />
  );
}

/**
 * PANEL SWEEP 13/15 — the blog discovery panels (ticket 86bbjt1bd).
 *
 * Asserted on rendered MARKUP rather than on the source, and this is the half
 * `check:panels` cannot hold: the browser check measures the SLOT, so a width
 * written onto a field inside a declared manager moves nothing it compares.
 * A break test proved exactly that during this build — `width: 40px` on every
 * `--b` input in this manager, and the run came back green.
 *
 * The declaration itself IS load-bearing and the browser does see that:
 * removing `data-lattice-pairs="2"` took check:panels to exit 1 with 12
 * failures at 1440/1600/1920, because the manager's fields were then measured
 * against the axis column holding them. The test below is what makes the same
 * regression fail in CI, which has no browser.
 */
describe("Blog Category Filter settings panel", () => {
  it("declares its item manager so check_panels measures it", () => {
    expect(categoryFilterHtml()).toContain(
      'class="builder-cards-panel-fields" data-lattice-pairs="2"'
    );
  });

  /**
   * `.builder-slider-item-card` holding `label.field` boxes is the shape W0
   * says to RETIRE rather than style — it stacks a label ABOVE a full-width
   * box, so the manager runs a second label geometry inside a panel whose
   * other columns are on the lattice. Worse, `check_panels` excludes
   * `.builder-slider-item-grid` BY NAME, so every pair inside it was filtered
   * out of every sweep since the check was written.
   */
  it("has retired the label.field shape W0 says not to style", () => {
    const html = categoryFilterHtml();
    expect(html).not.toContain("builder-slider-item-card");
    expect(html).not.toContain("builder-slider-item-grid");
    expect(html).not.toContain("builder-slider-items");
    expect(html).toContain("builder-card-field--a");
    expect(html).toContain("builder-card-field--b");
  });

  /**
   * W0's mechanism: the COLUMN is the grid and every field is
   * `display: contents`, so a width on a field is the per-field sizing the
   * rule exists to forbid. The old manager carried two hardcoded 478px tracks.
   */
  it("puts no width on any field in the manager", () => {
    expect(categoryFilterHtml()).not.toMatch(/style="[^"]*width/i);
  });

  it("names each category's controls, so a manager of five is navigable", () => {
    const html = categoryFilterHtml();
    expect(html).toContain('aria-label="Category 1 label"');
    expect(html).toContain('aria-label="Category 1 slug"');
    expect(html).toContain('aria-label="Move category 1 up"');
    expect(html).toContain('aria-label="Delete category 2"');
  });

  /**
   * The conversion changes how the row is laid out and nothing about what is
   * saved (a Non-goal of the ticket, stated in as many words).
   */
  it("still edits the same categories, label and slug", () => {
    const html = categoryFilterHtml();
    expect(html).toContain("Junior High Performance Academy");
    expect(html).toContain("junior-high-performance-academy");
    expect(html).toContain("Adult Clinics");
  });
});
