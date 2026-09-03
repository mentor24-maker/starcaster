import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBlogTagCloudModuleSettings } from "./builder-blog-tag-cloud-module-settings";
import { createEmptyModule, normalizeBuilderModuleSettingsForType } from "@/lib/builder-template";

const TAGS = JSON.stringify([
  { id: "a", label: "News", slug: "news", count: 24 },
  { id: "b", label: "Tutorial", slug: "tutorial", count: 8 }
]);

function panelHtml(settings: Record<string, string> = {}) {
  const m = {
    ...createEmptyModule("blog-tag-cloud"),
    settings: normalizeBuilderModuleSettingsForType("blog-tag-cloud", { tags: TAGS, ...settings })
  };
  return renderToStaticMarkup(
    <BuilderBlogTagCloudModuleSettings module={m as never} onUpdateModule={() => {}} />
  );
}

/**
 * Asserted on rendered markup, not on the source. The manager was a stack of
 * `label.field` boxes that read perfectly well in TSX and put a second label
 * geometry inside a panel whose other columns were on the lattice.
 */
describe("Blog Tag Cloud settings panel", () => {
  /**
   * The declaration is the whole difference between a manager that is measured
   * and one that is invisible to the check. check_panels selects item managers
   * on `[data-lattice-pairs]` / `[data-lattice-columns]`; this panel declared
   * neither, so every sweep since the check was written reported OK here
   * without ever looking at it.
   */
  it("declares its item manager so check_panels measures it", () => {
    expect(panelHtml()).toContain('class="builder-cards-panel-fields" data-lattice-pairs="2"');
  });

  it("has retired the label.field shape W0 says not to style", () => {
    const html = panelHtml();
    expect(html).not.toContain("builder-slider-item-card");
    expect(html).not.toContain("builder-slider-items");
    // Every tag field is a lattice field now.
    expect(html).toContain("builder-module-field");
    expect(html).toContain("builder-card-field--a");
    expect(html).toContain("builder-card-field--b");
  });

  it("offers a Title, which is what replaced the module's unused text slot", () => {
    expect(panelHtml()).toContain("Title");
  });

  it("names each tag's controls, so a manager of five is navigable", () => {
    const html = panelHtml();
    expect(html).toContain('aria-label="Tag 1 label"');
    expect(html).toContain('aria-label="Tag 1 slug"');
    expect(html).toContain('aria-label="Move tag 1 up"');
    expect(html).toContain('aria-label="Delete tag 2"');
  });

  /**
   * Count only means something in the cloud layout — it is what sizes a tag.
   * The pills and list layouts ignore it, so the field is not offered there.
   */
  it("offers Count only in the layout that uses it", () => {
    expect(panelHtml({ layout: "cloud" })).toContain('aria-label="Tag 1 count"');
    expect(panelHtml({ layout: "pills" })).not.toContain('aria-label="Tag 1 count"');
  });
});
