import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultBackgroundSettings,
  createEmptySection,
  normalizeLayoutSections
} from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";
import { getBuilderThemePageMarginStyle } from "./builder/builder-utils";

function renderRows(rows: unknown[]) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections(rows)}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

const TEXT_ROW = {
  id: "row-1",
  title: "Contact Strip",
  layout: "single",
  background: { mode: "color", color: "#021e3e" },
  modules: [{ id: "m1", type: "text", column: "main", text: "561-243-7360" }]
};

describe("row padding", () => {
  it("defaults to the 18px the stylesheet used to hard-code, so saved rows do not move", () => {
    const section = createEmptySection("single");
    expect(section.paddingTop).toBe("18");
    expect(section.paddingBottom).toBe("18");

    // A row stored before the control existed carries no padding keys at all.
    const [normalized] = normalizeLayoutSections([{ id: "old", layout: "single", modules: [] }]);
    expect(normalized.paddingTop).toBe("18");
    expect(normalized.paddingBottom).toBe("18");
  });

  it("publishes the operator's top and bottom values as row tokens", () => {
    const html = renderRows([{ ...TEXT_ROW, paddingTop: "7", paddingBottom: "7" }]);

    expect(html).toContain("--builder-section-padding-top:7px");
    expect(html).toContain("--builder-section-padding-bottom:7px");
  });

  it("takes the two edges separately", () => {
    const html = renderRows([{ ...TEXT_ROW, paddingTop: "0", paddingBottom: "40" }]);

    expect(html).toContain("--builder-section-padding-top:0px");
    expect(html).toContain("--builder-section-padding-bottom:40px");
  });

  it("clamps out of range values rather than emitting them", () => {
    const [normalized] = normalizeLayoutSections([
      { id: "wild", layout: "single", paddingTop: "-40", paddingBottom: "9999", modules: [] }
    ]);

    expect(normalized.paddingTop).toBe("0");
    expect(normalized.paddingBottom).toBe("160");
  });
});

describe("row minimum height", () => {
  it("releases the 56px floor once a row holds something", () => {
    const html = renderRows([TEXT_ROW]);

    expect(html).toContain("--builder-section-min-height:0px");
  });

  it("keeps the floor on an empty row, which still has to be a drop target", () => {
    const html = renderRows([{ id: "blank", title: "Blank", layout: "single", modules: [] }]);

    expect(html).not.toContain("--builder-section-min-height");
  });
});

describe("site-wide content width", () => {
  it("is off by default, and off means a 100% token that centres to a zero inset", () => {
    const style = getBuilderThemePageMarginStyle({}) as Record<string, string>;

    expect(style["--bx-content-width"]).toBe("100%");
  });

  it("publishes the operator's width so every row centres its content on it", () => {
    const style = getBuilderThemePageMarginStyle({ contentWidth: 1180 }) as Record<string, string>;

    expect(style["--bx-content-width"]).toBe("1180px");
  });

  it("treats a negative width as off rather than inverting the inset", () => {
    const style = getBuilderThemePageMarginStyle({ contentWidth: -200 }) as Record<string, string>;

    expect(style["--bx-content-width"]).toBe("100%");
  });
});
