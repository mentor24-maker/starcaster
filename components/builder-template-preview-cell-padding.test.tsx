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

    expect(html).toContain("padding:18px 18px");
  });

  it("drops the top and bottom without losing the left and right", () => {
    const html = renderRows([
      bannerRow({ cellPadding: { left: "18", right: "18" }, cellVerticalPadding: { left: "0" } })
    ]);

    expect(html).toContain("padding:0px 18px");
  });

  it("drops the left and right without losing the top and bottom", () => {
    const html = renderRows([
      bannerRow({ cellPadding: { left: "18", right: "18" }, cellHorizontalPadding: { left: "0" } })
    ]);

    expect(html).toContain("padding:18px 0px");
  });
});
