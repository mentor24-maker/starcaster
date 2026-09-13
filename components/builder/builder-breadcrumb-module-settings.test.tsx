import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBreadcrumbModuleSettings } from "./builder-breadcrumb-module-settings";
import { createEmptyModule } from "@/lib/builder-template";

const ITEMS = JSON.stringify([
  { id: "crumb-1", label: "Home", url: "/" },
  { id: "crumb-2", label: "Junior High Performance Academy", url: "/junior-high-performance" },
  { id: "crumb-3", label: "Court Fees", url: "/court-fees" }
]);

function breadcrumbHtml(settings: Record<string, string> = {}) {
  const module = { ...createEmptyModule("breadcrumb"), settings };
  return renderToStaticMarkup(
    <BuilderBreadcrumbModuleSettings module={module as never} onUpdateModule={() => {}} />
  );
}

/**
 * The Breadcrumb editor, panel sweep 10/15 (ticket 86bbjt1b6).
 *
 * Both assertions here are for things `npm run check:panels` cannot catch on
 * its own, which is the whole reason they are written down as tests:
 *
 *  - The inline width was invisible to the browser check BY CONSTRUCTION.
 *    `check_panels` measures the field's SLOT — the grid cell — and the slot
 *    was always the column's full 213px and always correct. The 48px was on
 *    the input INSIDE it. A green run said nothing about it and never could.
 *  - The `data-lattice-columns` declaration is what makes the trail manager
 *    visible to that check at all. Deleting it does not fail anything: the
 *    manager simply drops out of the measurement and the run goes green over
 *    less, which is exactly how this panel passed every sweep before now.
 *
 * Asserted on rendered markup rather than on the source, for the reason the
 * Social suite gives: a class name or an attribute is something a refactor
 * can drop without breaking anything a diff would show.
 */
describe("Breadcrumb settings editor", () => {
  it("carries no width on an individual field (W0)", () => {
    const html = breadcrumbHtml({ separator: "›", items: ITEMS });
    // `style={{ width: 48 }}` on the Separator input, removed in the sweep.
    // React renders an inline style as style="width:48px", so a `width`
    // DECLARATION inside a style attribute in this panel is the defect
    // coming back.
    //
    // The property has to be matched exactly, and this is why (review
    // round 2, 2026-09-13): the old pattern `/style="[^"]*width:/` also
    // matches `max-width:` and `min-width:` — both legitimate here, both
    // part of how W9 caps a control — and it scans the whole rendered
    // panel including shared chrome. Any inline `maxWidth` anywhere in
    // that tree failed this test with a confident claim about a breadcrumb
    // field carrying a width it does not have. So the style attributes are
    // parsed into declarations and the PROPERTY is compared, rather than
    // the string being searched for a substring that three properties end
    // with.
    const inlineWidths = [...html.matchAll(/style="([^"]*)"/g)]
      .flatMap(([, decls]) => decls.split(";"))
      .map((decl) => decl.split(":")[0].trim().toLowerCase())
      .filter((prop) => prop === "width");
    expect(inlineWidths).toHaveLength(0);
    // And it takes the column's shared token instead, the same one Label
    // uses, so the input sizes from the track rather than from a number
    // typed into the panel.
    expect(html).toContain("builder-module-field--text-md");
    expect(html).not.toContain("builder-module-field--auto");
  });

  it("puts the trail manager under check_panels with three titled columns", () => {
    const html = breadcrumbHtml({ items: ITEMS });
    // Without this the manager is not failing the lattice check — it is
    // absent from it, and the summary line cannot tell the two apart.
    expect(html).toContain('data-lattice-columns="3"');
    // The count has to match what is actually rendered: three titles, and
    // three cells per trail item. A declaration that outruns the markup
    // lands every later cell in the wrong column.
    expect([...html.matchAll(/builder-item-grid-header"/g)]).toHaveLength(3);
    expect([...html.matchAll(/builder-item-grid-actions"/g)]).toHaveLength(3);
    expect([...html.matchAll(/aria-label="Item \d+ (label|URL)"/g)]).toHaveLength(6);
  });

  it("stamps every cell with the row it belongs to, so a scrambled row can be caught", () => {
    /*
     * `data-lattice-row` is the unit `check_panels` counts cells in, and
     * without it that assertion cannot fail at all (review round 2,
     * 2026-09-13). A trail item renders as a Fragment, so its three cells
     * are direct children of the grid with no element of their own; an item
     * that renders two cells instead of three does not shorten a grid row,
     * it shifts every later cell up one slot. Measured in a browser at
     * 1440, a panel broken that way still reports three cells in every grid
     * row however they are grouped — by resolved grid row, by wrap in x, or
     * by y. The stamp is the only record of which cells were MEANT to be one
     * row, so its absence is the assertion going quietly dead.
     */
    const html = breadcrumbHtml({ items: ITEMS });
    // The title band is one row, and says so.
    expect([...html.matchAll(/data-lattice-row="header"/g)]).toHaveLength(3);
    // Three cells per item, each carrying its own index.
    for (const index of [0, 1, 2]) {
      expect([...html.matchAll(new RegExp(`data-lattice-row="${index}"`, "g"))]).toHaveLength(3);
    }
    // And no cell is left unstamped: every direct child of the grid carries
    // one. A partially stamped grid is reported as unreadable rather than
    // measured around, so this is the condition that keeps it measurable.
    const grid = html.slice(html.indexOf('data-lattice-columns="3"'));
    const cells = [...grid.matchAll(/data-lattice-row="/g)];
    // 3 header titles + 3 trail items x 3 cells. ITEMS is a JSON *string*,
    // so its `.length` is characters, not items — spelled out rather than
    // computed from it.
    expect(cells).toHaveLength(3 + 3 * 3);
  });

  it("still saves the same keys the module reads", () => {
    // The sweep is layout only — a non-goal of the ticket is changing what
    // any setting does. maxLength on the separator is part of that.
    const html = breadcrumbHtml({ separator: "→", items: ITEMS });
    expect(html).toContain('maxLength="4"');
    expect(html).toContain('value="→"');
    expect(html).toContain(">Separator<");
    expect(html).toContain(">Trail items — last item is the current page<");
  });
});
