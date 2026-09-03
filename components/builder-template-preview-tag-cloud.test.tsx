import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderTemplatePreview } from "./builder-template-preview";
import {
  createDefaultBackgroundSettings,
  normalizeBuilderModuleSettingsForType,
  normalizeLayoutSections
} from "@/lib/builder-template";

const TAGS = JSON.stringify([
  { id: "a", label: "News", slug: "news", count: 20 },
  { id: "b", label: "Tutorial", slug: "tutorial", count: 4 }
]);

/**
 * This renders the LIVE tenant site's tag cloud, not a mockup of it.
 * routes/publicSitePages.js serves public/site.html, which mounts
 * BuilderPublicSitePage -> BuilderTemplatePreview. There is no server-side
 * renderer for this module type, so what BuilderTemplatePreview draws is the
 * whole of what a visitor sees.
 */
function siteHtml(settings: Record<string, string> = {}) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      pageBackground={createDefaultBackgroundSettings()}
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Tags",
          layout: "single",
          modules: [
            {
              id: "cloud-1",
              type: "blog-tag-cloud",
              column: "main",
              text: "",
              settings: normalizeBuilderModuleSettingsForType("blog-tag-cloud", {
                tags: TAGS,
                ...settings
              })
            }
          ]
        }
      ])}
    />
  );
}

describe("the Tag Cloud a visitor actually sees", () => {
  /**
   * The defect this module was rebuilt for. The palette calls it a "Tag
   * navigation widget … that filters posts by ?tag=slug"; every tag rendered
   * as a <span> with no href, so it navigated nowhere, while its sibling
   * Blog Category Filter had linked correctly all along.
   */
  it("links each tag to the filter it names", () => {
    const html = siteHtml();
    expect(html).toContain('href="?tag=news"');
    expect(html).toContain('href="?tag=tutorial"');
  });

  it("links to the target page when one is chosen", () => {
    const html = siteHtml({ targetPageUrl: "/blog", filterParam: "topic" });
    expect(html).toContain('href="/blog?topic=news"');
  });

  /**
   * The layout was honoured on the Builder canvas and ignored here, so the
   * operator set it, saw it apply, published, and got the pill row.
   */
  it("renders the list layout as a list, not as pills", () => {
    expect(siteHtml({ layout: "list" })).toContain("<ul");
    expect(siteHtml({ layout: "cloud" })).not.toContain("<ul");
  });

  it("sizes cloud tags by their count, and stops doing so in pills", () => {
    // News has 5x Tutorial's count, so it takes the max size and Tutorial
    // lands near the minimum. Nothing was ever sized by count before.
    const cloud = siteHtml({ layout: "cloud", minFontSize: "10", maxFontSize: "30" });
    expect(cloud).toContain("font-size:30px");
    expect(cloud).toContain("font-size:14px");

    const pills = siteHtml({ layout: "pills", minFontSize: "10", maxFontSize: "30" });
    expect(pills).toContain("font-size:10px");
    expect(pills).not.toContain("font-size:30px");
  });

  it("honours the tag colour it is given, rather than colouring every tag active", () => {
    const html = siteHtml({ inactiveColor: "#123456" });
    expect(html).toContain("#123456");
  });

  it("renders the Title when there is one, and no heading when there is not", () => {
    expect(siteHtml({ title: "Browse by tag" })).toContain("Browse by tag");
    expect(siteHtml({ title: "" })).not.toContain("margin-bottom:0.6rem");
  });

  /**
   * A module inserted from the palette carries only { layout: "cloud" }, so
   * showCounts arrives undefined. The old renderer tested `!== "false"` and
   * showed the counts while the panel's checkbox read unchecked.
   */
  it("keeps counts hidden until they are asked for", () => {
    expect(siteHtml({})).not.toContain("(20)");
    expect(siteHtml({ showCounts: "true" })).toContain("(20)");
  });
});
