import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderTableModuleSettings } from "./builder-table-module-settings";
import { createEmptyModule } from "@/lib/builder-template";

/**
 * Panel sweep 4/15 — the Table editor (86bbjt1ax).
 *
 * L6a offers an item manager two shapes, and this one is unambiguous: the
 * manager IS a spreadsheet, and its column titles are the operator's own table
 * headers. One labelled block per item would be absurd for it, so it stays a
 * titled-column grid — which means it must declare `data-lattice-columns`, or
 * `check_panels` skips it in silence.
 *
 * It was skipped in silence. `check_panels` only knew the Navigation Links
 * div-grid markup, so declaring on a real <table> failed with "rendered no
 * rows" — the only choices were to leave a spreadsheet unmeasured or to
 * rewrite it as a div grid to satisfy the checker. The checker was taught the
 * <table> shape instead.
 *
 * Asserted on rendered markup rather than on the source, for the reason the
 * Social suite gives: a class name or an attribute is something a refactor can
 * drop without breaking anything a diff would show.
 */

const TABLE_DATA = JSON.stringify({
  headers: ["Phone", "Hours", "Status"],
  rowCount: 2,
  cells: {},
});

function tableHtml(settings: Record<string, string> = {}) {
  const module = { ...createEmptyModule("table"), settings: { tableData: TABLE_DATA, ...settings } };
  return renderToStaticMarkup(
    <BuilderTableModuleSettings
      module={module as never}
      onUpdateModule={() => {}}
      onUpdateModuleBackground={() => {}}
      renderCellPreview={() => null}
    />
  );
}

describe("Table settings editor", () => {
  it("declares itself a titled-column grid, so check_panels measures it", () => {
    const html = tableHtml();
    // Without this the grid is invisible to the check: a 900px header input
    // and a header band detached from its own columns both passed green.
    expect(html).toContain("data-lattice-columns");
  });

  it("counts every titled column INCLUDING the Row actions column", () => {
    // Three headers plus the Row column = 4. Counting only the data columns
    // would put every row one cell over its declared width and the check
    // would fail on the panel's own correct markup.
    expect(tableHtml()).toContain('data-lattice-columns="4"');
  });

  it("the count follows the operator's columns, it is not a fixed number", () => {
    const five = JSON.stringify({
      headers: ["A", "B", "C", "D", "E"],
      rowCount: 1,
      cells: {},
    });
    expect(tableHtml({ tableData: five })).toContain('data-lattice-columns="6"');
  });

  it("keeps a real header band and real rows — the shape the check reads", () => {
    const html = tableHtml();
    // thead/tbody are what the <table> branch of check_panels looks for. A
    // refactor to divs would silently take this manager back out of the check.
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect([...html.matchAll(/<th/g)].length).toBeGreaterThanOrEqual(4);
  });

  it("renders a row per row — an empty manager measures nothing and passes", () => {
    const html = tableHtml();
    expect([...html.matchAll(/<tr/g)].length).toBe(3); // 1 header + 2 rows
  });
});
