import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The bulk import of the discarded Delray posts (86bbtuh3y) is reachable only
 * through one button in the Blog Manager's heading, and the manager renders
 * three different ways — loading, empty, and with posts. A button placed in
 * the "with posts" branch alone would be invisible on a site with no posts
 * yet, with no error to notice: precisely the case a recovery tool is for.
 *
 * `npm run check:render` cannot cover this. Its harness drives
 * builder-preview.html, which applies the live site's rule that admin-only
 * modules never paint on a public page (components/builder-preview-page.tsx,
 * filterPublicSections) — the Blog Manager is admin-only, so it renders
 * nothing there and a contract would measure an empty page. This is that
 * coverage, taken where the component actually renders.
 */

function managerMarkup() {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Admin",
          layout: "single",
          modules: [
            { id: "m-1", type: "blog-post-manager", column: "main", name: "", text: "", settings: {} },
          ],
        },
      ] as never)}
    />
  );
}

describe("Blog Manager: the import entry point", () => {
  it("offers the import button before any posts have loaded", () => {
    const html = managerMarkup();
    expect(html).toContain("builder-blog-import-open");
    expect(html).toContain("Import from discarded pages");
  });

  it("keeps the button in the heading, not inside the post list", () => {
    const html = managerMarkup();
    const headingAt = html.indexOf("builder-blog-post-manager-heading");
    const buttonAt = html.indexOf("builder-blog-import-open");
    const listAt = html.indexOf("builder-blog-post-manager-list");
    expect(headingAt).toBeGreaterThanOrEqual(0);
    expect(buttonAt).toBeGreaterThan(headingAt);
    // The list may not render at all in this state; when it does, the button
    // must still come first — a button inside the list disappears with it.
    if (listAt >= 0) expect(buttonAt).toBeLessThan(listAt);
  });

  it("does not open the panel until the button is used", () => {
    // Nothing is fetched and nothing is written on first paint: the panel and
    // its confirm step exist only after a deliberate click.
    const html = managerMarkup();
    expect(html).not.toContain("builder-blog-import-panel");
    expect(html).not.toContain("Preview import");
  });
});
