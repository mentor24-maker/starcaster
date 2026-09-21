// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BUILDER_PHONE_MAX_WIDTH } from "@/lib/builder-device-overrides";
import { BuilderTemplatePreview } from "./builder-template-preview";

/**
 * The old per-field phone settings — a column's "Hide on Mobile", a module's
 * "Hide Module on Mobile", "Mobile Alignment" and "Mobile Font Size" — fire at
 * the Phone width (86bc1ecxx). Their original `-mobile-*` rules sit at 900px in
 * the regenerated `_builder-react.css`, which may not be edited, so the
 * renderer emits `-phone-*` classes whose rules live at 767px in the overrides
 * file. These tests hold both halves: the class the renderer writes, and a
 * Phone-width rule existing for it. A browser holds the widths themselves
 * (`scripts/ui/render-contracts.mjs`, the `legacy` contracts at 420px/800px).
 */
function markup() {
  return renderToStaticMarkup(
    <BuilderTemplatePreview
      pageBackground={createDefaultBackgroundSettings()}
      layoutSections={normalizeLayoutSections([
        {
          id: "row-1",
          title: "Row",
          layout: "single",
          cellMobileHidden: { main: "true" },
          modules: [
            {
              id: "m-1",
              type: "heading",
              column: "main",
              name: "",
              text: "Old phone fields",
              settings: { mobileHidden: "true", mobileAlignment: "center", mobileFontSize: "18" },
            },
          ],
        },
      ] as never)}
    />
  );
}

const PHONE_CLASSES = [
  "builder-preview-column-phone-hidden",
  "builder-preview-module-phone-hidden",
  "builder-preview-module-phone-align-center",
  "builder-preview-module-phone-font-size",
];

describe("The old phone fields render on the Phone-width classes", () => {
  it("writes the -phone-* classes and none of the 900px -mobile-* ones", () => {
    const html = markup();
    for (const name of PHONE_CLASSES) expect(html).toContain(name);
    expect(html).not.toMatch(/builder-preview-(column|module)-mobile-(hidden|align|font-size)/);
  });

  it("has a rule for every one of those classes inside the Phone-width media query", () => {
    const css = readFileSync(resolve(__dirname, "../src/css/_builder-react-overrides.css"), "utf8")
      // Comments name these classes too; only real rules count.
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Every Phone-width block, each ending at the first brace that closes it
    // at column 0.
    const opener = `@media (max-width: ${BUILDER_PHONE_MAX_WIDTH}px) {`;
    const blocks: string[] = [];
    for (let at = css.indexOf(opener); at !== -1; at = css.indexOf(opener, at + 1)) {
      blocks.push(css.slice(at, css.indexOf("\n}", at)));
    }
    expect(blocks.length).toBeGreaterThan(0);
    const phoneRules = blocks.join("\n");
    for (const name of PHONE_CLASSES) expect(phoneRules).toContain(`.${name}`);
  });
});
