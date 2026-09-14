import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBlogRelatedPostsModuleSettings } from "./builder-blog-related-posts-module-settings";
import { BuilderBlogTocModuleSettings } from "./builder-blog-toc-module-settings";
import { BuilderBlogAuthorBioModuleSettings } from "./builder-blog-author-bio-module-settings";
import { BuilderBlogPostModuleSettings } from "./builder-blog-post-module-settings";
import { BuilderModuleChromeSlotProvider } from "./builder-module-chrome-slot";
import {
  createEmptyModule,
  normalizeBuilderModuleSettingsForType,
  type BuilderTemplateModuleType
} from "@/lib/builder-template";

/**
 * PANEL SWEEP 12/15 — the blog reading panels (ticket 86bbjt1bc).
 *
 * Asserted on rendered MARKUP rather than on the source, and in vitest rather
 * than in `check_panels`, because that is where each of these is actually
 * enforceable:
 *
 *   - `check_panels` measures a field's SLOT. A width set on the control
 *     INSIDE the slot is invisible to it — that is how the breadcrumb
 *     Separator shipped 165px short of the block edge for as long as it
 *     existed (panel sweep 10/15, UI_RULES L6a).
 *   - The `data-lattice-pairs` declaration is what makes a manager measured at
 *     all. Delete it and `check_panels` stops holding the manager to its own
 *     lattice; nothing else in the repo notices.
 *   - Three of these managers were built from `.builder-slider-item-grid`,
 *     which `check_panels` EXPLICITLY EXCLUDES from measurement
 *     (`scripts/ui/check_panels.mjs`, the `.closest(...)` filter). Every sweep
 *     since the check was written reported a clean pass over these panels
 *     without ever looking inside them.
 */

const RELATED_POSTS = JSON.stringify([
  { id: "rel-1", title: "Junior academy", imageUrl: "/a.png", url: "/junior", date: "Jun 20, 2026", categories: "Juniors" },
  { id: "rel-2", title: "Sunday mixer", imageUrl: "/b.jpg", url: "/sunday", date: "Jul 4, 2026", categories: "Adults" }
]);

const TOC_ITEMS = JSON.stringify([
  { id: "toc-1", label: "Junior academy", anchor: "junior-academy", depth: 1 },
  { id: "toc-2", label: "Court fees", anchor: "court-fees", depth: 2 }
]);

const SOCIAL_LINKS = JSON.stringify([
  { id: "link-1", platform: "website", url: "https://example.com" },
  { id: "link-2", platform: "instagram", url: "https://instagram.com/x" }
]);

function html(type: BuilderTemplateModuleType, Component: never, settings: Record<string, string>) {
  const m = {
    ...createEmptyModule(type),
    settings: normalizeBuilderModuleSettingsForType(type, settings)
  };
  const Render = Component as unknown as (props: Record<string, unknown>) => JSX.Element;
  return renderToStaticMarkup(<Render module={m} onUpdateModule={() => {}} />);
}

const MANAGERS: Array<{ name: string; markup: () => string }> = [
  {
    name: "Related Posts",
    markup: () =>
      html("blog-related-posts", BuilderBlogRelatedPostsModuleSettings as never, {
        matchBy: "manual",
        manualPosts: RELATED_POSTS
      })
  },
  {
    name: "Table of Contents",
    markup: () => html("blog-toc", BuilderBlogTocModuleSettings as never, { items: TOC_ITEMS })
  },
  {
    name: "Author Bio",
    markup: () => html("blog-author-bio", BuilderBlogAuthorBioModuleSettings as never, { socialLinks: SOCIAL_LINKS })
  }
];

describe.each(MANAGERS)("$name settings panel", ({ markup }) => {
  /**
   * The declaration is the whole difference between a manager that is measured
   * and one that is not. Deleting it was break-tested against the live
   * checker: `check_panels` stopped treating the manager as its own lattice
   * and failed the panel 12 ways at 1440/1600/1920.
   */
  it("declares its item manager so check_panels measures it", () => {
    expect(markup()).toContain('data-lattice-pairs="1"');
  });

  it("has retired the label.field shape W0 says not to style", () => {
    const m = markup();
    // These three classes are what `check_panels` excludes from measurement.
    expect(m).not.toContain("builder-slider-item-grid");
    expect(m).not.toContain("builder-slider-item-card");
    expect(m).not.toContain("builder-slider-items");
    // Every item field is a lattice field on the shared card grid now.
    expect(m).toContain("builder-cards-panel-fields");
    expect(m).toContain("builder-module-field");
    expect(m).toContain("builder-card-field--a");
  });

  /**
   * W0's one absolute: "Never set a width on an individual field." A width on
   * the CONTROL rather than on its slot is the case no browser run can catch,
   * so it is asserted here.
   */
  it("sets no width on any individual field", () => {
    const m = markup();
    expect(m).not.toMatch(/style="[^"]*\bwidth:/);
    expect(m).not.toMatch(/style="[^"]*\bmargin-left:/);
  });

  it("names every item control, so a manager of five is navigable", () => {
    expect(markup()).toMatch(/aria-label="[^"]* 1 /);
    expect(markup()).toMatch(/aria-label="[^"]* 2 /);
  });
});

describe("Table of Contents settings panel", () => {
  /**
   * The nesting used to be an inline `marginLeft: 16` on every H3 card, which
   * gave ONE manager two x-positions of its own (0 and 16) — measured at 1440
   * before this change. It is written in the card's head row instead, which is
   * where the level already was.
   */
  it("says an item's level in words instead of indenting it off the lattice", () => {
    const m = html("blog-toc", BuilderBlogTocModuleSettings as never, { items: TOC_ITEMS });
    expect(m).toContain("H2 · Junior academy");
    expect(m).toContain("H3 · Court fees");
    expect(m).not.toMatch(/margin-left/);
  });
});

describe("Blog Post settings panel", () => {
  const markup = () =>
    html("blog-post", BuilderBlogPostModuleSettings as never, { title: "A post", status: "draft" });

  /**
   * This panel is hand-rolled rather than schema-driven, so its field strips
   * were each their own grid and the shared chrome was another below them: one
   * panel, three label widths (71/76/125px) and three control positions
   * (77/82/125px) at 1440. Rendering a chrome slot inside one
   * `.builder-schema-panel-column` is the mechanism that makes them one grid
   * (ticket 86bbq065f). Break-tested: removing the slot fails `check_panels`
   * at all three widths with the seam message.
   */
  it("puts its fields in one lattice column that also receives the chrome", () => {
    const m = markup();
    expect(m).toContain("builder-schema-panel-column");

    /*
     * `BuilderModuleChromeSlot` renders NOTHING without a provider above it —
     * deliberately, so a schema panel used by the row or cell editor, which
     * has no module chrome at all, does not draw an empty box. So the slot is
     * asserted under a provider, which is also the arrangement the real card
     * uses. Rendered on its own the panel below shows no slot, and that is
     * correct rather than a miss.
     */
    const withCard = renderToStaticMarkup(
      <BuilderModuleChromeSlotProvider value={() => {}}>
        <BuilderBlogPostModuleSettings
          module={
            {
              ...createEmptyModule("blog-post"),
              settings: normalizeBuilderModuleSettingsForType("blog-post", { title: "A post" })
            } as never
          }
          onUpdateModule={() => {}}
        />
      </BuilderModuleChromeSlotProvider>
    );
    expect(withCard).toContain("builder-module-chrome-slot");
    // And the slot is INSIDE the column, which is the whole mechanism — the
    // chrome portals into it, so its DOM parent is the column's grid.
    const column = withCard.indexOf("builder-schema-panel-column");
    const slot = withCard.indexOf("builder-module-chrome-slot");
    expect(column).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(column);
  });

  /** Status was a bare 557px select at x=83, on no lattice at all. */
  it("renders Status as a lattice field rather than loose chrome", () => {
    expect(markup()).toMatch(/builder-module-field-label[^>]*>Status</);
  });

  /**
   * Prose in a lattice column must span both tracks, or it takes a label cell
   * and every pair below it runs half a cell out of phase — the blog-search
   * defect (`_builder-react-overrides.css`, the `.builder-schema-bare` note).
   */
  it("wraps its field prose so the lattice spans it", () => {
    const m = html("blog-post", BuilderBlogPostModuleSettings as never, {
      title: "A post",
      tags: "a, b"
    });
    // The notes live on the Taxonomy and SEO tabs, which are not the open one,
    // so what this asserts is the class pairing wherever a note renders.
    expect(m).not.toMatch(/<p style="font-size:11px/);
  });

  it("sets no width on any individual field", () => {
    expect(markup()).not.toMatch(/style="[^"]*\bwidth:/);
  });
});
