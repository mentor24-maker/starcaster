import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE INVENTORY OF UNMEASURED ITEM MANAGERS, PINNED TO THE SOURCES.
 *
 * `check_panels` excludes two classes from its ordinary field measurement by
 * name — `.builder-slider-item-grid` and `.builder-item-grid` — because an
 * item manager runs its own lattice (L6a) and must not be compared against the
 * axis column containing it. A manager opts back IN by declaring
 * `data-lattice-pairs` (the labelled block) or `data-lattice-columns` (the
 * titled-column grid). One that carries an excluded class and declares neither
 * is measured by no browser gate at all: the sweep reports a clean pass over a
 * manager nobody has looked inside.
 *
 * That is not hypothetical. Three blog managers sat in exactly that state from
 * the day `check_panels` was written until panel sweep 12/15 converted them,
 * every sweep reporting OK the whole time, with fields rendering at x=0.
 *
 * The list of what is LEFT lives in `docs/UI_RULES.md` (rule L6a), and it is
 * read by the sweeps that come next to find out what is still theirs. On
 * 2026-09-13 that list was wrong: it named `blog-category-filter` as the last
 * one when social-share and both of Program List's nested grids were in the
 * same state — so sweep 13/15 would have read it, converted the one panel it
 * named, and left the other three behind. That is the same mechanism that made
 * the managers unmeasured in the first place, one level up: a written
 * inventory nothing checks.
 *
 * So it is checked. This test derives the inventory from the sources and pins
 * it to the doc's table. Converting one of these, or adding a fifth, fails
 * here until `docs/UI_RULES.md` is updated to match.
 */

const COMPONENTS = path.resolve(__dirname);
const UI_RULES = path.resolve(__dirname, "..", "..", "docs", "UI_RULES.md");
const CHECK_PANELS = path.resolve(__dirname, "..", "..", "scripts", "ui", "check_panels.mjs");

/** The two classes `check_panels` drops from its field measurement, by name. */
const EXCLUDED = ["builder-slider-item-grid", "builder-item-grid"];

/** Every `className="..."` literal in a file, with where it starts. */
const CLASS_ATTR = /className="([^"]*)"/g;

/**
 * Whole CLASS TOKENS, never a substring. `builder-item-grid-actions` and
 * `builder-slider-item-grid-full` both contain an excluded name and are
 * neither of them the grid — the first is the button strip inside one, the
 * second a modifier on a label. A `\b`-anchored regex counts both, because a
 * hyphen is a word boundary, and it reported 28 managers where there are four.
 */
function carriesExcludedClass(classList: string): boolean {
  const tokens = classList.split(/\s+/).filter(Boolean);
  return EXCLUDED.some((name) => tokens.includes(name));
}

/**
 * Every element in the builder's settings components that carries an excluded
 * manager class and declares NEITHER opt-in attribute on the same tag.
 *
 * Read off the opening tag rather than the file, so a file holding one
 * measured manager and one unmeasured one — Program List, exactly — reports
 * the unmeasured one instead of being cleared by its neighbour.
 */
function unmeasuredManagers(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(COMPONENTS).sort()) {
    if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) continue;
    const source = readFileSync(path.join(COMPONENTS, file), "utf8");
    for (const match of source.matchAll(CLASS_ATTR)) {
      if (!carriesExcludedClass(match[1])) continue;
      // The opening tag this className belongs to: back to the nearest `<`,
      // forward to the `>` that closes it.
      const open = source.lastIndexOf("<", match.index);
      const close = source.indexOf(">", match.index);
      const tag = source.slice(open, close);
      if (tag.includes("data-lattice-pairs") || tag.includes("data-lattice-columns")) continue;
      // The class list identifies WHICH manager, since one file can hold
      // several (`--sessions` and `--prices` are two).
      found.push(`${file} ${match[1].trim()}`);
    }
  }
  return found.sort();
}

describe("the lattice inventory", () => {
  it("names every manager that no browser gate measures", () => {
    /*
     * Measured 2026-09-13 from the sources. Each of these renders fields that
     * `check_panels` cannot see. Converting one means DELETING its line here
     * and from the table in docs/UI_RULES.md — the two move together on
     * purpose, so the doc cannot go stale without a test going red.
     */
    expect(unmeasuredManagers()).toEqual([
      "builder-blog-category-filter-module-settings.tsx builder-slider-item-grid",
      "builder-module-card.tsx builder-slider-item-grid",
      "builder-program-list-module-settings.tsx builder-item-grid builder-item-grid--prices",
      "builder-program-list-module-settings.tsx builder-item-grid builder-item-grid--sessions"
    ]);
  });

  it("is the same list the doc tells the next sweep to work from", () => {
    const doc = readFileSync(UI_RULES, "utf8");
    /*
     * Not a word-for-word comparison — the doc names panels in the operator's
     * language ("social-share (platform list)") and the code names files. What
     * is pinned is that every unmeasured FILE appears in the doc's table, so a
     * manager cannot be in the code inventory and missing from the one a human
     * reads.
     *
     * REVIEW ROUND 3 (2026-09-14) — this used to find the table with
     * `indexOf("Four manager shapes are still unmeasured")` and slice from it.
     * That sentence counts the rows, so the next sweep to convert one WILL
     * reword it; `indexOf` would then return -1, `slice(-1)` would yield the
     * document's last character, and every assertion below would fail saying
     * the table omits every file — blaming the table for an anchor that had
     * moved. The anchor is now a marker comment that carries no facts, and
     * the test proves it FOUND it before concluding anything from what
     * follows.
     */
    const MARKER = "<!-- LATTICE-INVENTORY-TABLE";
    const at = doc.indexOf(MARKER);
    expect(
      at,
      `docs/UI_RULES.md no longer carries the ${MARKER} marker — put it back ` +
        "directly above the inventory table. Until it is there this test cannot " +
        "tell a missing panel from a moved anchor."
    ).toBeGreaterThan(-1);

    const table = doc.slice(at);
    for (const entry of unmeasuredManagers()) {
      const file = entry.split(" ")[0];
      expect(table, `docs/UI_RULES.md does not name ${file}`).toContain(file);
    }
  });

  /*
   * THE OTHER BLIND SPOT, pinned the same way and for the same reason.
   *
   * A manager can be unmeasured (above). So can a single FIELD: `check_panels`
   * drops a `full`-width field from its field list entirely unless the group
   * around it declares `data-lattice-pairs`, and that drop runs before any
   * comparison. An image picker in an ordinary column is therefore measured by
   * nothing — its slot can reach the block edge correctly while the entry box
   * inside it is a third of its neighbours.
   *
   * Sweep 12/15's round-3 review found three panels in exactly that state and
   * asked for the exemption to be written down rather than fixed outside its
   * scope. A written exemption nothing checks is how the manager inventory
   * above went stale, so this pins the doc section to the line of code that
   * makes the claim true: the day that drop stops happening, this test fails
   * and the doc is forced to stop describing it.
   */
  it("does not let the doc keep describing a blind spot the code has closed", () => {
    const doc = readFileSync(UI_RULES, "utf8");
    const checker = readFileSync(CHECK_PANELS, "utf8");

    const documented = doc.includes("<!-- CHECKER-BLIND-SPOTS -->");
    // The drop itself, matched on its shape rather than on a line number.
    const drops = /full\s*&&\s*!group\.hasAttribute\(\s*['"]data-lattice-pairs['"]\s*\)/.test(
      checker
    );

    expect(
      documented,
      drops
        ? "check_panels still drops a `full` field outside a declared manager, " +
            "but docs/UI_RULES.md no longer carries the <!-- CHECKER-BLIND-SPOTS --> " +
            "section describing it. An undocumented exemption is indistinguishable " +
            "from an oversight (ticket 86bbjt1bc)."
        : "check_panels no longer drops a `full` field outside a declared manager — " +
            "good. Now delete the <!-- CHECKER-BLIND-SPOTS --> section from " +
            "docs/UI_RULES.md, which still tells the next sweep that it does."
    ).toBe(drops);
  });
});
