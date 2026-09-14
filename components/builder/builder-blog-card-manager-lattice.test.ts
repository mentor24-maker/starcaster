import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * W0 ON THE CARD TEMPLATE DESIGNER — guarded in the SOURCE, because that is
 * the only place it can be guarded at all.
 *
 * Panel sweep 14/15, ticket 86bbjt1be. The designer's control groups became a
 * real two-track grid; before that they were a wrapping flex bar whose seven
 * Structure controls sat at seven different left edges across three lines.
 *
 * The browser gate (`npm run check:panels`) measures the fixed panel and fails
 * on the broken one — all three breaks were watched to fail before this was
 * believed. But CI has no browser, so that gate only ever runs if a person
 * runs it, and the two things most likely to undo this change are both plain
 * text a reviewer's eye slides over:
 *
 *   1. an inline `width` creeping back onto a field. An inline style beats
 *      every stylesheet rule there is, so ONE of them silently takes a control
 *      out of its track — which is exactly how this panel got into the state
 *      the ticket describes (three call sites carried 110px, 64px and 56px).
 *   2. the `data-lattice-pairs` declaration going missing. Without it the
 *      whole designer drops out of `check:panels` and the panel goes back to
 *      being ABSENT from a green run rather than passing it.
 *
 * Neither needs a DOM to detect, and this repo has no DOM-rendering test
 * harness (no @testing-library/react), so a source assertion is not a
 * second-best here — it is the enforceable form of the rule.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const PREVIEW = path.join(ROOT, "components", "builder-template-preview.tsx");
const OVERRIDES = path.join(ROOT, "src", "css", "_builder-react-overrides.css");

/** Just the designer, so an inline width elsewhere in a 9,000-line file is not this test's business. */
function designerSource() {
  const src = fs.readFileSync(PREVIEW, "utf8");
  const start = src.indexOf("export function BlogCardManagerPreview()");
  expect(start, "BlogCardManagerPreview has been renamed or removed").toBeGreaterThan(-1);
  const end = src.indexOf("\nexport ", start + 1);
  return src.slice(start, end === -1 ? undefined : end);
}

/** The comment that closes the controls bar. Asserted, not assumed — see below. */
const END_OF_CONTROLS_BAR = "{/* ── Two-column";

/**
 * An inline width, in every spelling React accepts.
 *
 * Round 1 of this ticket's review broke the previous pattern on purpose. It was
 * `/\bwidth:\s*\d/`, which needs a digit IMMEDIATELY after the colon: it caught
 * `width: 110` — the unquoted form that happened to be in the code this change
 * replaced — and sailed straight past `width: "110px"`, which is the commoner
 * React spelling of exactly the same defect. A guard that only catches the
 * spelling already removed guards nothing.
 *
 * `maxWidth` is here because a ceiling on an individual field takes it out of
 * its track just as surely as a width does (W9 says bound the BLOCK, not the
 * control). `minWidth` is deliberately NOT here: `minWidth: 0` is the standard
 * grid-shrink idiom and appears in this panel's own CSS.
 *
 * Case-sensitive on purpose — `tpl.imageSideWidth` and
 * `setField("cardBorderWidth", ...)` are legitimate and must not read as
 * offenders.
 */
const INLINE_WIDTH = /\b(?:width|maxWidth)\s*(?::|=)\s*\{?\s*["'`]?[\d.]/;

/** The controls bar only — the row editor and live preview below it are not on this lattice. */
function controlsBarSource() {
  const src = designerSource();
  const start = src.indexOf('className="bcm-controls-bar"');
  expect(start, "the controls bar has been renamed or removed").toBeGreaterThan(-1);
  // Both ends are asserted. An unguarded end marker does not fail when it goes
  // missing — `indexOf` returns -1, `slice` widens to the whole rest of the
  // file, and the test quietly starts measuring the row editor and the live
  // preview instead of the controls bar. Measuring the wrong thing and passing
  // is worse than failing (round 1 of this ticket's review).
  const end = src.indexOf(END_OF_CONTROLS_BAR, start);
  expect(end, `the controls bar's end marker (${END_OF_CONTROLS_BAR}) has been renamed or removed`).toBeGreaterThan(
    start
  );
  return src.slice(start, end);
}

describe("the Card Template designer sits on a lattice", () => {
  it("puts no width on an individual field (W0)", () => {
    const offenders = controlsBarSource()
      .split("\n")
      .filter((line) => INLINE_WIDTH.test(line));
    expect(
      offenders,
      "a hard-coded width on a field overrides its grid track — width belongs to the track (W0)"
    ).toEqual([]);
  });

  it("declares its pair-columns so check:panels measures it rather than skipping it", () => {
    const bar = controlsBarSource();
    const groups = bar.match(/className="bcm-group-controls"[^>]*/g) || [];
    expect(groups.length, "expected the Content / Structure / Frame groups").toBe(3);
    for (const g of groups) {
      expect(g, "an undeclared group is absent from check:panels, not passing it").toContain(
        'data-lattice-pairs="2"'
      );
    }
  });

  it("declares the same number of columns the CSS actually renders", () => {
    // These two numbers are one decision written in two files. If they drift,
    // `check:panels` fails with "declares 2 pair-column(s) but its labels start
    // at 3 different x-positions" — loud, but only for whoever runs a browser.
    // Here it is loud in CI.
    const css = fs.readFileSync(OVERRIDES, "utf8");
    const at = css.indexOf(".bcm-group-controls {");
    expect(at, "the designer's group-grid rule has been renamed or removed").toBeGreaterThan(-1);
    // To the rule's OWN closing brace, not to the end of the stylesheet. Slicing
    // to the end binds to the first `repeat()` that happens to sit below this
    // rule — correct today only because no other one does (round 1 review).
    const close = css.indexOf("}", at);
    expect(close, "the group-grid rule is unclosed").toBeGreaterThan(at);
    const rule = css.slice(at, close);
    const tracks = rule.match(/grid-template-columns:\s*repeat\((\d+),/);
    expect(tracks?.[1], "the designer's group grid is no longer a fixed repeat()").toBe("2");
  });
});
