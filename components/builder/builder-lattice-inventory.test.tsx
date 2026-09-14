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
     */
    const table = doc.slice(doc.indexOf("Four manager shapes are still unmeasured"));
    for (const entry of unmeasuredManagers()) {
      const file = entry.split(" ")[0];
      expect(table, `docs/UI_RULES.md does not name ${file}`).toContain(file);
    }
  });
});
