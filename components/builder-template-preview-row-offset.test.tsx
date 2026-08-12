import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultBackgroundSettings,
  createEmptySection,
  normalizeLayoutSections
} from "@/lib/builder-template";
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

const CARD_ROW = {
  id: "row-1",
  title: "4 - Feature Cards",
  layout: "single",
  background: { mode: "color", color: "#ffffff" },
  modules: [{ id: "m1", type: "text", column: "main", text: "Card" }]
};

describe("row offset", () => {
  it("is zero on a new row and on every row saved before the control existed", () => {
    const section = createEmptySection("single");
    expect(section.verticalOffset).toBe("0");
    expect(section.horizontalOffset).toBe("0");

    const [normalized] = normalizeLayoutSections([{ id: "old", layout: "single", modules: [] }]);
    expect(normalized.verticalOffset).toBe("0");
    expect(normalized.horizontalOffset).toBe("0");
  });

  it("emits no transform at all while both offsets are zero", () => {
    expect(renderRows([CARD_ROW])).not.toContain("transform:translate");
  });

  it("moves the row UP on a positive vertical offset, which is how a card band overlaps the banner above it", () => {
    const html = renderRows([{ ...CARD_ROW, verticalOffset: "56" }]);

    expect(html).toContain("transform:translate(0px, -56px)");
  });

  it("moves the row down on a negative vertical offset", () => {
    const html = renderRows([{ ...CARD_ROW, verticalOffset: "-30" }]);

    expect(html).toContain("transform:translate(0px, 30px)");
  });

  it("moves the row right on a positive horizontal offset, and takes both axes at once", () => {
    const html = renderRows([{ ...CARD_ROW, horizontalOffset: "24", verticalOffset: "12" }]);

    expect(html).toContain("transform:translate(24px, -12px)");
  });

  it("lifts an offset row above its neighbours so it overlaps rather than hides behind", () => {
    const html = renderRows([{ ...CARD_ROW, verticalOffset: "40" }]);

    expect(html).toContain("z-index:2");
  });

  it("clamps a wild value instead of storing it", () => {
    const [normalized] = normalizeLayoutSections([
      { id: "wild", layout: "single", verticalOffset: "9999", horizontalOffset: "-9999", modules: [] }
    ]);

    expect(normalized.verticalOffset).toBe("500");
    expect(normalized.horizontalOffset).toBe("-500");
  });
});
