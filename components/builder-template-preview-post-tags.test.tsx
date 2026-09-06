import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderTemplatePreview } from "./builder-template-preview";
import {
  createDefaultBackgroundSettings,
  normalizeBuilderModuleSettingsForType,
  normalizeLayoutSections,
  type BuilderTemplateModuleType
} from "@/lib/builder-template";

/**
 * Ticket 86bbup8df — the /tags sidebar on delraytennis.starcaster.pro was
 * showing two literal pills reading "Example" and "Tag" to visitors.
 *
 * These modules have no server-side renderer: routes/publicSitePages.js serves
 * public/site.html, which mounts BuilderPublicSitePage ->
 * BuilderTemplatePreview -> the components under test. What is rendered here
 * is the whole of what a visitor sees.
 *
 * The rule is the one PR #564 wrote for the Tag Cloud: placeholder content is
 * a BUILDER affordance, so the canvas is not an empty box while somebody
 * designs a page. On a live page, nothing to show means nothing rendered.
 *
 * Both halves are tested on purpose. Testing only the live half would let
 * somebody "fix" a leak by deleting the placeholder outright, trading a
 * visible defect for a silent one.
 */

function html(
  type: BuilderTemplateModuleType,
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
              id: `m-${type}`,
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

describe("the post-tags row never shows a visitor sample content", () => {
  /**
   * The live module on the Delray tag index is `blog-post-tags-1788472879720-5`
   * with `tags: ""` and `showPrefix: "true"`, so the page read
   * `Tags: [Example] [Tag]`.
   *
   * Worth recording because the ticket described it differently: this module
   * does NOT read a current post. It reads only its own `tags` setting, so an
   * empty setting produced the sample pills on every page type, a blog post
   * included — not just on a tag index with no post in scope.
   */
  it("renders NOTHING on a live page when no tags are set", () => {
    const live = html("blog-post-tags", { tags: "" }, { liveSite: true });
    expect(live).not.toContain("Example");
    // Not even the prefix. A "Tags:" label over empty space is the same defect
    // in a smaller hat (CLAUDE.md landmine 16).
    expect(live).not.toContain("Tags:");
  });

  it("renders NOTHING on a live page when the tags setting is only separators", () => {
    // " , , " filters down to zero real tags, which is the same empty case.
    const live = html("blog-post-tags", { tags: " , , " }, { liveSite: true });
    expect(live).not.toContain("Example");
    expect(live).not.toContain("Tags:");
  });

  it("still shows the tags a page actually carries", () => {
    const live = html("blog-post-tags", { tags: "clinics, juniors" }, { liveSite: true });
    expect(live).toContain("clinics");
    expect(live).toContain("juniors");
    expect(live).toContain("Tags:");
    expect(live).not.toContain("Example");
  });

  it("still shows the sample pills OFF a live page, so the canvas is not an empty box", () => {
    const canvas = html("blog-post-tags", { tags: "" }, { liveSite: false });
    expect(canvas).toContain("Example");
  });
});

/**
 * The same rule, one floor down. These three types have no renderer at all —
 * a dashed rectangle naming the module is everything they draw — so a
 * published page carrying one would show a visitor a grey box reading
 * "Post Card". No public page carries one today; this closes it first.
 */
describe("a module that only draws its own name never draws it to a visitor", () => {
  const CASES: Array<{ type: BuilderTemplateModuleType; label: string }> = [
    { type: "blog-post-card", label: "Post Card" },
    { type: "blog-author-bio", label: "Author Bio" },
    { type: "blog-toc", label: "Table of Contents" }
  ];

  for (const { type, label } of CASES) {
    it(`${type} renders nothing on a live page`, () => {
      expect(html(type, {}, { liveSite: true })).not.toContain(label);
    });

    it(`${type} still names itself on the Builder canvas`, () => {
      expect(html(type, {}, { liveSite: false })).toContain(label);
    });
  }
});
