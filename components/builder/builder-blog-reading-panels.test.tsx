import { readFileSync } from "node:fs";
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

  /**
   * The group title was "Headings — H3s indent under the nearest H2" and this
   * sweep shortened it to "Headings", which dropped the only sentence saying
   * what an H3 does on the RENDERED page (review round 1, 2026-09-13). It is
   * prose now rather than a longer heading, so pin the sentence itself — and
   * it names the `Indent H3s` setting, because the nesting only shows on the
   * page when that is on (landmine 17: a note that overstates is its own bug).
   */
  it("still says what an H3 does on the page", () => {
    const m = html("blog-toc", BuilderBlogTocModuleSettings as never, { items: TOC_ITEMS });
    expect(m).toContain("An H3 belongs to the nearest H2 above it");
    expect(m).toContain("Indent H3s decides whether");
    expect(m).toContain("builder-panel-field-note");
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
   * W0's absolute rides along with it: never a width on an individual field.
   *
   * REVIEW ROUND 1 (2026-09-13) — the two assertions below used to render the
   * panel and read the markup, and the panel opens on its Content tab, which
   * holds no prose at all. The reviewer put the original defect back (the
   * Taxonomy note as `<p style={{ fontSize: 11, color: "#8ba9be" }}>`) and all
   * 17 tests still passed. Four of the five tabs — Meta, Categories & Tags,
   * SEO, Display — were covered by nothing: `check_panels` never clicks a tab
   * bar either.
   *
   * There is no @testing-library here, so a tab cannot be clicked in vitest.
   * These read the SOURCE instead, which is the one thing that sees all five
   * tabs at once, and is a pattern several component tests already use
   * (`saved-section-usage-fetch.test.tsx`, `builder-template-preview-carousel.test.tsx`).
   */
  const source = () =>
    readFileSync(new URL("./builder-blog-post-module-settings.tsx", import.meta.url), "utf8");

  it("wraps its field prose so the lattice spans it, on every tab", () => {
    const src = source();

    // The defect itself: prose styled inline instead of taking the shared
    // note class. This is the exact shape the reviewer restored.
    expect(src).not.toMatch(/<p\s[^>]*style=\{\{/);

    const paragraphs = [...src.matchAll(/<p[\s>]/g)];
    expect(paragraphs.length).toBeGreaterThan(0);
    for (const p of paragraphs) {
      const before = src.slice(0, p.index);
      // The nearest wrapper still open above this <p> has to be the bare one.
      // A note dropped straight into a field strip would have closed it
      // first — and that is the half-a-cell phase error the wrapper prevents.
      expect(before.lastIndexOf('className="builder-schema-bare"')).toBeGreaterThan(
        before.lastIndexOf("</div>")
      );
    }
  });

  /**
   * W0's absolute — "never a width on an individual field" — asserted over the
   * whole panel rather than over whichever tab happens to be open. `resize` is
   * the one inline declaration this panel is allowed: it is the textarea's
   * drag handle, not a layout width.
   */
  it("sets no width on any individual field, on any of its five tabs", () => {
    const declarations = [...source().matchAll(/style=\{\{([^}]*)\}\}/g)].map((m) => m[1]);
    expect(declarations.length).toBeGreaterThan(0);
    for (const decl of declarations) {
      expect(decl).not.toMatch(/\b(width|maxWidth|minWidth|flex|margin|padding|fontSize)\b/);
    }
    // The rendered Content tab as well, kept as the cheap direct check.
    expect(markup()).not.toMatch(/style="[^"]*\bwidth:/);
  });
});
