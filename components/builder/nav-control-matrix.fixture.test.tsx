import { existsSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { it } from "vitest";
import { createDefaultBackgroundSettings, normalizeLayoutSections } from "@/lib/builder-template";
import { BuilderTemplatePreview } from "@/components/builder-template-preview";
import { CONTROLS, NAV_BASE } from "../../scripts/ui/nav-control-matrix.mjs";

/*
 * Writes the fixture `npm run check:nav-controls` measures. It is a test
 * file because that is the only way to reach the React renderer with the
 * repo's aliases; it asserts nothing itself — the assertions are in
 * scripts/ui/check_nav_controls.mjs, which needs a browser to make them.
 */
const OUT = process.env.NAV_MATRIX_OUT
  || path.join(os.tmpdir(), "starcaster-nav-control-matrix");

function variant(id: string, settings: Record<string, string>) {
  return `<div class="builder-react-root" data-variant="${id}">` +
    renderToStaticMarkup(
      <BuilderTemplatePreview
        layoutSections={normalizeLayoutSections([{
          id: "r", layout: "single",
          modules: [{ id: "n", type: "navigation", column: "main", text: "", settings }],
        }])}
        pageBackground={createDefaultBackgroundSettings()}
        showShell={false}
      />
    ) + `</div>`;
}

/*
 * `public/styles.css` is a gitignored build artifact, and CI runs the unit
 * tests without building it — this file asked for it and failed the whole
 * suite on PR 180. It is a fixture generator, not an assertion, so it stands
 * down when the stylesheet is not there. `npm run check:nav-controls` builds
 * the stylesheet before invoking this, so the real check never skips.
 */
const STYLESHEET = "public/styles.css";

it.skipIf(!existsSync(STYLESHEET))("writes the control matrix for check:nav-controls", () => {
  const blocks: string[] = [];
  for (const c of CONTROLS as Array<Record<string, any>>) {
    const base = { ...NAV_BASE, ...(c.base ?? {}) };
    // Baseline and changed differ by exactly ONE control, so any difference
    // in the rendered page is attributable to it and nothing else.
    const id = c.id ?? c.key;
    blocks.push(variant(`${id}::base`, base));
    blocks.push(variant(`${id}::set`, { ...base, [c.key]: c.value, ...(c.extra ?? {}) }));
  }
  const css = readFileSync(STYLESHEET, "utf8");
  writeFileSync(`${OUT}.html`,
    `<!doctype html><meta charset="utf-8"><style>${css}</style><body style="margin:0;background:#fff">${blocks.join("")}</body>`);
});
