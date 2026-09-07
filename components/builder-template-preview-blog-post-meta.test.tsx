// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The post form's author and date fields (86bbvtzt1). Rendered where the
 * component actually paints: `npm run check:render` cannot see this module,
 * because builder-preview.html applies the live site's rule that admin-only
 * modules never render on a public page.
 *
 * Static markup runs no effects, so this is the CREATE form (no ?id= in the
 * URL). Edit mode's behaviour — loading the stored date, linking the
 * thumbnail — is covered by the pure helpers in
 * lib/builder-client/blog-post-editor-meta.test.ts.
 */
function formMarkup(settings: Record<string, string>) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      pageBackground={createDefaultBackgroundSettings()}
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Admin",
          layout: "single",
          modules: [
            { id: "m-1", type: "blog-post-create", column: "main", name: "", text: "", settings },
          ],
        },
      ] as never)}
    />
  );
}

describe("Blog post form: author and date", () => {
  it("shows a Post date picker on the create form, with the blank-means-publish-time note", () => {
    const html = formMarkup({});
    expect(html).toContain("Post date");
    expect(html).toContain('type="date"');
    expect(html).toContain("stamped the moment the post is published");
  });

  it("shows the Author field by default — a hidden field never meant a logged-in author, it meant no author", () => {
    const html = formMarkup({});
    expect(html).toContain(">Author<");
    expect(html).toContain('placeholder="Author name"');
  });

  it("still lets the module hide Author on the create form when told to", () => {
    const html = formMarkup({ showAuthorField: "false" });
    expect(html).not.toContain('placeholder="Author name"');
    // The date is not gated by that setting.
    expect(html).toContain('type="date"');
  });

  it("gives an unsaved post no thumbnail link — it has no address yet", () => {
    const html = formMarkup({});
    expect(html).not.toContain("builder-blog-post-create-thumb-link");
  });
});
