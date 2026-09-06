import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderTemplatePreview } from "./builder-template-preview";
import {
  createDefaultBackgroundSettings,
  normalizeBuilderModuleSettingsForType,
  normalizeLayoutSections,
  type BuilderTemplateModule
} from "@/lib/builder-template";

type ModuleType = BuilderTemplateModule["type"];

/**
 * A BUILDER-TIME AFFORDANCE MUST NOT RENDER AT VISIT TIME.
 *
 * Two shapes, one mistake. A module with nothing configured either invents
 * demo content so the canvas is not an empty box ("Tags: Example Tag", a
 * dashed rectangle reading "Author Bio"), or it prints an instruction to
 * whoever is building the page ("Add cards in the editor"). Both are correct
 * on the canvas and both are wrong on a published tenant site, where the
 * reader has no editor, no module settings and nothing to act on.
 *
 * Dane reported "Tags: Example Tag" on delraytennis.starcaster.pro/blog on
 * 2026-09-03, in the same screenshots that produced the tag cloud fix (#564)
 * and the six builder notes (#580). The tag cloud's own guard is tested in
 * builder-template-preview-tag-cloud.test.tsx; this file covers the modules
 * the sweep for that ticket (86bbugd2e) then found carrying the same shape.
 *
 * These render the LIVE tenant site, not a mockup of it:
 * routes/publicSitePages.js serves public/site.html, which mounts
 * BuilderPublicSitePage -> BuilderTemplatePreview with `liveSite`. There is no
 * server-side renderer for these module types, so what BuilderTemplatePreview
 * draws is the whole of what a visitor sees.
 */
function render(
  type: ModuleType,
  settings: Record<string, string>,
  { liveSite }: { liveSite: boolean }
) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      liveSite={liveSite}
      pageBackground={createDefaultBackgroundSettings()}
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Row",
          layout: "single",
          modules: [
            {
              id: `${type}-1`,
              type,
              column: "main",
              text: "",
              settings: normalizeBuilderModuleSettingsForType(type, settings)
            }
          ]
        }
      ])}
    />
  );
}

const live = (type: ModuleType, settings: Record<string, string> = {}) =>
  render(type, settings, { liveSite: true });
const canvas = (type: ModuleType, settings: Record<string, string> = {}) =>
  render(type, settings, { liveSite: false });

describe("demo content never reaches a visitor", () => {
  /**
   * The defect the operator photographed. `blog-post-tags` fell back to
   * ["Example", "Tag"] whenever its `tags` setting was empty, so a live post
   * announced two tags it does not have, under the module's own "Tags:"
   * prefix, as though they were real.
   */
  it("does not invent 'Example Tag' on a published post", () => {
    const html = live("blog-post-tags");
    expect(html).not.toContain("Example");
    expect(html).not.toContain("Tags:");
  });

  it("still shows the sample tags on the Builder canvas", () => {
    const html = canvas("blog-post-tags");
    expect(html).toContain("Example");
    expect(html).toContain("Tag");
  });

  it("renders the tags a post actually has, on both surfaces", () => {
    expect(live("blog-post-tags", { tags: "junior tennis, clinics" })).toContain(
      "junior tennis"
    );
    expect(canvas("blog-post-tags", { tags: "junior tennis, clinics" })).toContain(
      "junior tennis"
    );
  });

  /**
   * The tags render inside styled pills, so the words alone are not the whole
   * of it — an empty module must contribute no markup at all rather than an
   * empty pill row with the prefix still in it.
   */
  it("renders nothing at all rather than an empty pill row", () => {
    expect(live("blog-post-tags")).not.toContain("border-radius:999px");
  });

  /**
   * blog-post-card, blog-author-bio and blog-toc have no renderer yet. The
   * canvas shows a named dashed box where one will go; a visitor was getting
   * that same grey rectangle with a module name in it.
   */
  it.each<[ModuleType, string]>([
    ["blog-post-card", "Post Card"],
    ["blog-author-bio", "Author Bio"],
    ["blog-toc", "Table of Contents"]
  ])("does not show the %s scaffold to a visitor", (type, label) => {
    expect(live(type)).not.toContain(label);
    expect(canvas(type)).toContain(label);
  });
});

describe("an instruction to the page builder never reaches a visitor", () => {
  /**
   * Four modules print "Add <things> in the editor" when nothing is
   * configured. On the canvas that is Standard 5 — an empty module is a
   * designed state, not a blank box. On a live site it is landmine 16: a
   * reader with no editor is told to go and use one.
   *
   * They are not caught by npm run check:builder-notes, whose phrase list
   * covers "in module settings" and "in the Messaging section" but not
   * "in the editor" — noted on ticket 86bbugd2e.
   */
  it.each<[ModuleType, Record<string, string>, string]>([
    ["carousel", {}, "Add slides in the editor"],
    ["carousel", { format: "cards" }, "Add cards in the editor"],
    ["headline-rotator", {}, "Add headlines in the editor"],
    ["program-list", {}, "Add programs in the editor"],
    ["feature-cards", {}, "Add cards in the editor"]
  ])("hides the %s empty state from a visitor", (type, settings, phrase) => {
    expect(live(type, settings)).not.toContain(phrase);
    expect(canvas(type, settings)).toContain(phrase);
  });

  /**
   * The note is the ONLY thing these modules would render, so the module has
   * to disappear entirely — a lone styled box over empty space is the same
   * defect wearing a hat (CLAUDE.md landmine 16).
   */
  it.each<[ModuleType, string]>([
    ["carousel", "builder-preview-carousel-empty"],
    ["headline-rotator", "builder-preview-headline-rotator"],
    ["program-list", "builder-preview-programs-empty"],
    ["feature-cards", "builder-preview-feature-cards-empty"]
  ])("leaves no empty %s box behind on a live page", (type, className) => {
    expect(live(type)).not.toContain(className);
  });
});
