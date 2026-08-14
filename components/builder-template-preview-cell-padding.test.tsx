import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

function renderRows(rows: unknown[]) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections(rows)}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

/** A banner cell holding a logo — the shape that produced the split. */
function bannerRow(cellRecords: Record<string, unknown>) {
  return {
    id: "banner",
    title: "Menu Banner",
    layout: "two-column",
    modules: [
      { id: "logo", type: "image", column: "left", settings: { url: "https://example.com/logo.png" } },
      { id: "nav", type: "text", column: "right", text: "Menu" }
    ],
    ...cellRecords
  };
}

describe("cell padding on the rendered page", () => {
  it("keeps a row saved before the split rendering exactly as it did", () => {
    const html = renderRows([bannerRow({ cellPadding: { left: "18", right: "18" } })]);

    expect(html).toContain("padding:18px 18px 18px 18px");
  });

  it("drops the top and bottom without losing the left and right", () => {
    const html = renderRows([
      bannerRow({ cellPadding: { left: "18", right: "18" }, cellVerticalPadding: { left: "0" } })
    ]);

    expect(html).toContain("padding:0px 18px 0px 18px");
  });

  it("drops the left and right without losing the top and bottom", () => {
    const html = renderRows([
      bannerRow({ cellPadding: { left: "18", right: "18" }, cellHorizontalPadding: { left: "0" } })
    ]);

    expect(html).toContain("padding:18px 0px 18px 0px");
  });
});

/**
 * The cell publishes its numbers so no breakpoint can replace them.
 *
 * Operator, 2026-08-12: "set to have cellpadding of 4, but it is clearly much
 * larger than that." Measured: 4px at 1440 and 900, but 12px at 560 and 480,
 * where the generated stylesheet forces `padding: 12px !important` on every
 * cell. An `!important` in a stylesheet beats an ordinary inline style, so
 * below that width the control did nothing — on the live site too.
 *
 * The widths themselves are a browser measurement (jsdom has no layout);
 * these assert the variables the fix in _builder-react-overrides.css reads,
 * without which it has nothing to honour.
 */
describe("a cell publishes its padding, so no breakpoint can replace it", () => {
  it("publishes all four sides as one box value", () => {
    const html = renderRows([bannerRow({ cellPadding: { left: "4", right: "4" } })]);

    expect(html).toContain("--builder-cell-padding-box:4px 4px 4px 4px");
  });

  it("publishes zero as zero rather than leaving the variable unset", () => {
    // Unset was the bug: the narrow-screen rule had nothing to read and fell
    // back to its own hardcoded 12px.
    const html = renderRows([bannerRow({ cellPadding: { left: "0", right: "0" } })]);

    expect(html).toContain("--builder-cell-padding-box:0px 0px 0px 0px");
  });

  it("keeps the sides apart in the published value", () => {
    const html = renderRows([
      bannerRow({ cellPadding: { left: "18", right: "18" }, cellVerticalPadding: { left: "0" } })
    ]);

    expect(html).toContain("--builder-cell-padding-box:0px 18px 0px 18px");
  });

  it("agrees with the inline padding it sets — the two cannot drift", () => {
    const html = renderRows([bannerRow({ cellPadding: { left: "7", right: "7" } })]);

    expect(html).toContain("--builder-cell-padding-box:7px 7px 7px 7px");
    expect(html).toContain("padding:7px 7px 7px 7px");
  });

  it("publishes the radius the same way", () => {
    const html = renderRows([
      bannerRow({ cellPadding: { left: "4", right: "4" }, cellBorderRadius: { left: "24", right: "24" } })
    ]);

    expect(html).toContain("--builder-cell-radius:24px");
  });

  it("leaves the left-side variable PR 176 added alone", () => {
    // Its consumer is a margin-inline rule on an overlay slot; the box value
    // would be the wrong number there.
    const html = renderRows([bannerRow({ cellPadding: { left: "9", right: "9" } })]);

    expect(html).toContain("--builder-cell-padding:9px");
  });
});
