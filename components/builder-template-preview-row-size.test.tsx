import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultBackgroundSettings,
  createEmptySection,
  getLayoutColumnPercents,
  normalizeLayoutSections
} from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";
import { getSectionGridTemplate, getSectionHorizontalMarginStyle } from "./builder/builder-utils";

function renderRows(rows: unknown[]) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections(rows)}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

const TWO_COLUMN_ROW = {
  id: "row-1",
  title: "4 - Feature Cards",
  layout: "two-column",
  background: { mode: "color", color: "#ffffff" },
  modules: [
    { id: "m1", type: "text", column: "left", text: "Left" },
    { id: "m2", type: "text", column: "right", text: "Right" }
  ]
};

function normalizeRow(overrides: Record<string, unknown>) {
  return normalizeLayoutSections([{ ...TWO_COLUMN_ROW, ...overrides }])[0];
}

describe("row side padding", () => {
  it("is off on a new row and on every row saved before the control existed", () => {
    const section = createEmptySection("single");
    expect(section.paddingLeft).toBe("0");
    expect(section.paddingRight).toBe("0");

    const [old] = normalizeLayoutSections([{ id: "old", layout: "single", modules: [] }]);
    expect(old.paddingLeft).toBe("0");
    expect(old.paddingRight).toBe("0");
  });

  it("emits no side token at all while it is zero, so the content-width inset stands alone", () => {
    const html = renderRows([TWO_COLUMN_ROW]);

    expect(html).not.toContain("--builder-section-padding-left");
    expect(html).not.toContain("--builder-section-padding-right");
  });

  it("publishes each side separately once set", () => {
    const html = renderRows([{ ...TWO_COLUMN_ROW, paddingLeft: "40", paddingRight: "12" }]);

    expect(html).toContain("--builder-section-padding-left:40px");
    expect(html).toContain("--builder-section-padding-right:12px");
  });
});

describe("row side margin", () => {
  it("moves a contained row in from both edges", () => {
    const style = getSectionHorizontalMarginStyle(normalizeRow({ marginLeft: "30", marginRight: "10" }));

    expect(style.marginLeft).toBe("30px");
    expect(style.marginRight).toBe("10px");
  });

  it("keeps a full-width row's escape to the viewport edge instead of cancelling it", () => {
    const style = getSectionHorizontalMarginStyle(
      normalizeRow({ widthMode: "full-width", marginLeft: "24" })
    );

    // Plain "24px" here would silently un-full-width the row.
    expect(style.marginLeft).toBe("calc(24px - var(--bx-theme-padding-inline, 0px))");
  });

  it("stays out of the way entirely at zero", () => {
    expect(getSectionHorizontalMarginStyle(normalizeRow({}))).toEqual({});
  });
});

describe("column gap", () => {
  it("defaults to the 16px the renderer used to hard-code", () => {
    expect(createEmptySection("two-column").columnGap).toBe("16");
    expect(renderRows([TWO_COLUMN_ROW])).toContain("gap:16px");
  });

  it("takes the operator's number", () => {
    expect(renderRows([{ ...TWO_COLUMN_ROW, columnGap: "48" }])).toContain("gap:48px");
  });

  it("closes to nothing at zero", () => {
    expect(renderRows([{ ...TWO_COLUMN_ROW, columnGap: "0" }])).toContain("gap:0px");
  });
});

describe("row minimum height", () => {
  it("is off by default, leaving the existing content-sized behaviour", () => {
    expect(createEmptySection("single").minHeight).toBe("0");
    expect(renderRows([TWO_COLUMN_ROW])).toContain("--builder-section-min-height:0px");
  });

  it("overrides the release-to-content rule once the operator asks for a taller band", () => {
    const html = renderRows([{ ...TWO_COLUMN_ROW, minHeight: "400" }]);

    expect(html).toContain("--builder-section-min-height:400px");
    expect(html).not.toContain("--builder-section-min-height:0px");
  });
});

describe("custom column widths", () => {
  it("follows the layout preset until a complete set is given", () => {
    expect(getSectionGridTemplate(normalizeRow({}))).toBe("1fr 1fr");
    expect(getSectionGridTemplate(normalizeRow({ layout: "two-four" }))).toBe("2fr 4fr");
  });

  it("ignores a half-filled set rather than collapsing a column to nothing", () => {
    const section = normalizeRow({ columnWidths: { left: "70" } });

    expect(getSectionGridTemplate(section)).toBe("1fr 1fr");
  });

  it("takes a complete set as proportions", () => {
    const section = normalizeRow({ columnWidths: { left: "70", right: "30" } });

    expect(getSectionGridTemplate(section)).toBe("70fr 30fr");
    expect(renderRows([{ ...TWO_COLUMN_ROW, columnWidths: { left: "70", right: "30" } }])).toContain(
      "grid-template-columns:70fr 30fr"
    );
  });

  it("fills the row even when the numbers do not add up to 100", () => {
    const section = normalizeRow({ columnWidths: { left: "2", right: "1" } });

    expect(getSectionGridTemplate(section)).toBe("2fr 1fr");
  });

  it("never applies to a one column row, which has nothing to split", () => {
    const section = normalizeLayoutSections([
      { id: "s", layout: "single", columnWidths: { main: "40" }, modules: [] }
    ])[0];

    expect(getSectionGridTemplate(section)).toBe("1fr");
  });

  it("reads the preset back as the percentages the boxes should start on", () => {
    expect(getLayoutColumnPercents("two-column")).toEqual([50, 50]);
    expect(getLayoutColumnPercents("two-four")).toEqual([33, 67]);
    expect(getLayoutColumnPercents("three-column")).toEqual([33, 33, 33]);
    expect(getLayoutColumnPercents("single")).toEqual([100]);
  });
});

describe("match column heights", () => {
  it("is off by default and adds no class", () => {
    expect(createEmptySection("two-column").equalColumnHeights).toBe("false");
    expect(renderRows([TWO_COLUMN_ROW])).not.toContain("builder-preview-section-equal-columns");
  });

  it("marks the row when the operator turns it on", () => {
    const html = renderRows([{ ...TWO_COLUMN_ROW, equalColumnHeights: "true" }]);

    expect(html).toContain("builder-preview-section-equal-columns");
  });
});
