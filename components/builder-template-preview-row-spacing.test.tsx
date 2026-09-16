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

/*
 * A row with no background of its own takes the theme band's vertical spacing.
 * That used to be written as an inline `padding-top`, which outranks the
 * stylesheet rule reading `--builder-section-padding-top` — so the operator's
 * Top/Bottom Padding did nothing at all on those rows, on every site.
 * Measured on builder-preview.html at 1440px on 2026-09-15: Top Padding 18,
 * computed `--builder-section-padding-top` 18px, computed `padding-top` 0px.
 */
const PLAIN_ROW = {
  id: "row-plain",
  title: "Plain Band",
  layout: "single",
  background: { mode: "none" },
  modules: [{ id: "m1", type: "text", column: "main", text: "561-243-7360" }]
};

describe("row padding on a row with no background", () => {
  it("writes no inline padding, which is what used to outrank the operator's setting", () => {
    const html = renderRows([PLAIN_ROW]);

    // A real `padding-top` declaration, not the custom property whose NAME
    // ends in the same eleven characters — the whole point is which of the two
    // is written, so the test has to be able to tell them apart.
    expect(html).not.toMatch(/[;"]padding-top:/);
    expect(html).not.toMatch(/[;"]padding-bottom:/);
  });

  it("still takes the band's spacing when he has not changed the padding, so no saved page moves", () => {
    const html = renderRows([PLAIN_ROW]);

    expect(html).toContain("--builder-section-padding-top:var(--lp-band-padding, 0px)");
    expect(html).toContain("--builder-section-padding-bottom:var(--lp-band-padding, 0px)");
  });

  it("honours the padding he did set, instead of the band's", () => {
    const html = renderRows([{ ...PLAIN_ROW, paddingTop: "40", paddingBottom: "40" }]);

    expect(html).toContain("--builder-section-padding-top:40px");
    expect(html).toContain("--builder-section-padding-bottom:40px");
    expect(html).not.toContain("var(--lp-band-padding");
  });

  it("decides the two edges separately — a top he set, a bottom he left alone", () => {
    const html = renderRows([{ ...PLAIN_ROW, paddingTop: "40" }]);

    expect(html).toContain("--builder-section-padding-top:40px");
    expect(html).toContain("--builder-section-padding-bottom:var(--lp-band-padding, 0px)");
  });

  it("leaves a row that has its own background alone — it never wore a band", () => {
    const html = renderRows([TEXT_ROW]);

    expect(html).toContain("--builder-section-padding-top:18px");
    expect(html).not.toContain("var(--lp-band-padding");
  });

  it("leaves a navigation-only row flush, which is chrome rather than a band", () => {
    const html = renderRows([
      {
        id: "nav",
        title: "Menu",
        layout: "single",
        background: { mode: "none" },
        modules: [{ id: "n1", type: "navigation", column: "main" }]
      }
    ]);

    expect(html).not.toContain("var(--lp-band-padding");
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
