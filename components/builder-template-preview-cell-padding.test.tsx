import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * Cell padding and radius reach the page as VARIABLES as well as inline
 * properties, which is what lets the narrow-screen rules honour them.
 *
 * Operator, 2026-08-12: "The buttons in the right column of the menu row are
 * set to have cellpadding of 4, but it is clearly much larger than that."
 * Below 560px the generated stylesheet forced `padding: 12px !important` on
 * every cell — and an `!important` in a stylesheet beats an ordinary inline
 * style, so the control did nothing at all on a phone.
 *
 * These assert the variables exist, because the fix in
 * _builder-react-overrides.css has nothing to read without them. The widths
 * themselves are a browser measurement (there is no layout in jsdom) — see
 * the numbers recorded in that CSS comment.
 */

const NAV = JSON.stringify([{ id: "h", label: "Home", href: "/" }]);

function render(cellPadding: Record<string, string>, extras: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "menu-row",
          layout: "four-two",
          cellPadding,
          modules: [
            { id: "nav", type: "navigation", column: "left", text: "", settings: { navItems: NAV } },
            { id: "b1", type: "button", column: "right", text: "Book Now", settings: {} },
          ],
          ...extras,
        },
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      showShell={false}
    />
  );
}

describe("a cell publishes its own padding, so no breakpoint can replace it", () => {
  it("publishes the number the operator set", () => {
    expect(render({ left: "4", right: "4" })).toContain("--builder-cell-padding:4px");
  });

  it("publishes zero as zero rather than leaving the variable unset", () => {
    // Unset was the bug: the narrow-screen rule had nothing to read and fell
    // back to its hardcoded 12px.
    expect(render({ left: "0", right: "0" })).toContain("--builder-cell-padding:0px");
  });

  it("publishes the radius the same way", () => {
    const html = render({ left: "4", right: "4" }, { cellBorderRadius: { left: "24", right: "24" } });
    expect(html).toContain("--builder-cell-radius:24px");
  });

  it("agrees with the inline padding it sets — the two can never drift", () => {
    const html = render({ left: "7", right: "7" });
    expect(html).toContain("--builder-cell-padding:7px");
    expect(html).toContain("padding:7px");
  });

  it("still keeps a menu cell flush, by its own value", () => {
    // The left column is navigation-only, so it publishes 0px rather than
    // relying on a second rule to contradict the first.
    expect(render({ left: "18", right: "18" })).toContain("--builder-cell-padding:0px");
  });
});
