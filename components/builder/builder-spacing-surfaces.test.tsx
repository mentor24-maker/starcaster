import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createEmptySection } from "@/lib/builder-template";
import { BuilderCellStyleSettings } from "./builder-cell-style-settings";
import { BuilderSectionControls } from "./builder-section-controls";

/**
 * The two surfaces E4b reaches that are NOT module panels: the row (section)
 * editor and the cell (column) editor. Both hold their spacing somewhere other
 * than a settings record — the section's own props, and the cell's
 * getCellExtra/onSetCellExtra pair — so each needed a small adapter, and an
 * adapter is exactly the kind of thing that renders nothing at all while the
 * panel around it still looks fine.
 *
 * `npm run check:panels` cannot catch that: it measures the geometry of the
 * rows that ARE there, so a spacing block that vanished would leave a shorter
 * panel and a clean pass. Hence a render assertion here.
 */

function labels(html: string) {
  return [...html.matchAll(/class="builder-(?:module-field|setting)-label"[^>]*>([^<]*)</g)].map((m) => m[1]);
}

describe("spacing rows outside a module panel (E4b)", () => {
  it("the row editor pairs the section's margins and paddings", () => {
    const html = renderToStaticMarkup(
      <BuilderSectionControls
        section={createEmptySection("single")}
        editorDevice="browser"
        onUpdateSection={() => {}}
      />
    );
    const spacing = labels(html).filter((label) => /Margin|Padding/.test(label));
    expect(spacing).toEqual(["V Margin", "H Margin", "V Padding", "H Padding"]);
  });

  it("the cell editor pairs the cell's padding and margin", () => {
    const section = createEmptySection("single");
    const html = renderToStaticMarkup(
      <BuilderCellStyleSettings
        column="main"
        section={section}
        editorDevice="browser"
        onUpdateCellBackground={() => {}}
        onUpdateCellBorderWidth={() => {}}
        onUpdateCellBorderColor={() => {}}
        onUpdateCellBorderRadius={() => {}}
        onSetCellExtra={() => {}}
        getCellExtra={() => ""}
      />
    );
    const spacing = labels(html).filter((label) => /Margin|Padding/.test(label));
    expect(spacing).toEqual(["V Padding", "H Padding", "V Margin", "H Margin"]);
  });

  it("the cell editor still splits a side that was set on its own", () => {
    const section = createEmptySection("single");
    const set: Record<string, string> = { cellPaddingTop: "30", cellPaddingBottom: "5" };
    const html = renderToStaticMarkup(
      <BuilderCellStyleSettings
        column="main"
        section={section}
        editorDevice="browser"
        onUpdateCellBackground={() => {}}
        onUpdateCellBorderWidth={() => {}}
        onUpdateCellBorderColor={() => {}}
        onUpdateCellBorderRadius={() => {}}
        onSetCellExtra={() => {}}
        getCellExtra={(_column, key) => set[key] ?? ""}
      />
    );
    const spacing = labels(html).filter((label) => /Margin|Padding/.test(label));
    expect(spacing.slice(0, 3)).toEqual(["Top Padding", "Bottom Padding", "H Padding"]);
  });
});
