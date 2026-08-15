import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createDefaultBackgroundSettings,
  normalizeLayoutSections,
  resolveRenderTheme
} from "@/lib/builder-template";
import { BuilderTemplatePreview } from "./builder-template-preview";
import { getThemeRootVars } from "./builder/builder-utils";

/**
 * A theme edit has to reach pages that already exist (2026-08-15).
 *
 * Assigning a theme copies its typography into the page, and every renderer
 * read that copy — while the SAME renderers read colours and margins from the
 * live theme record the server sends alongside. So a theme edit moved a
 * published page's background and left its type alone, which reads as a broken
 * control. These cover the whole chain the two surfaces share: resolve the
 * theme, emit the tokens, land them in the markup.
 */

const STORED = { typography: { scale: { baseSize: 16, ratio: 0, baseLineHeight: 1.8 } } };
const LIVE = { typography: { scale: { baseSize: 16, ratio: 0, baseLineHeight: 1.3 } } };

function renderPage(theme: ReturnType<typeof resolveRenderTheme>) {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Body",
          layout: "single",
          modules: [{ id: "m1", type: "text", column: "main", text: "<p>Delray Beach</p>" }]
        }
      ])}
      pageBackground={createDefaultBackgroundSettings()}
      theme={theme}
    />
  );
}

describe("live theme typography", () => {
  it("emits the live theme's line height, not the copy frozen into the page", () => {
    const vars = getThemeRootVars(resolveRenderTheme(STORED, LIVE)) as Record<string, string>;

    expect(vars["--bx-line-base"]).toBe("1.3");
  });

  it("lands that token in the rendered page, which is what the stylesheet reads", () => {
    // `_builder-theme.css` resolves `line-height: var(--bx-line-base, 1.6)` on
    // every text block, so the token being present IS the feature working.
    expect(renderPage(resolveRenderTheme(STORED, LIVE))).toContain("--bx-line-base:1.3");
  });

  it("still renders the page's own values when it names no theme", () => {
    expect(renderPage(resolveRenderTheme(STORED, null))).toContain("--bx-line-base:1.8");
  });

  it("emits no token at all for an unthemed page, leaving the baseline alone", () => {
    const html = renderPage(resolveRenderTheme(null, null));

    expect(html).not.toContain("--bx-line-base");
  });
});
