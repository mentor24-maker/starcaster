import { describe, expect, it } from "vitest";

import {
  getLayoutColumns,
  getLayoutGridTemplate,
  normalizeLayout
} from "@/lib/builder-template";

import { layoutOptions } from "./builder-types";

/**
 * The row-layout picker and the template layer are two separate lists that
 * have to agree. `one-four-one` shipped in the template layer — type, grid
 * template, column keys, legacy `1-4-1` mapping and all — but was never
 * added to `layoutOptions`, so no operator could reach it: a layout that
 * existed everywhere except the one list the UI reads.
 *
 * These assertions are the guard for growing the set. A new layout that is
 * added to the picker but not taught to `getLayoutGridTemplate` silently
 * falls back to a single full-width column, which looks like the builder
 * ignoring the click rather than like a missing case.
 */
describe("layoutOptions", () => {
  it("offers only layouts the template layer recognizes", () => {
    for (const option of layoutOptions) {
      expect(normalizeLayout(option.value), option.value).toBe(option.value);
    }
  });

  it("gives every layout its own column count and track sizing", () => {
    for (const option of layoutOptions) {
      const tracks = getLayoutGridTemplate(option.value).split(/\s+/).filter(Boolean);
      expect(tracks.length, `${option.value} track count`).toBe(getLayoutColumns(option.value).length);
    }
  });

  it("does not fall back to a single column for any non-single layout", () => {
    for (const option of layoutOptions) {
      if (option.value === "single") continue;
      expect(getLayoutGridTemplate(option.value), option.value).not.toBe("1fr");
    }
  });

  it("lists no layout twice", () => {
    const values = layoutOptions.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("includes the 1 / 4 / 1 centre-focus row", () => {
    const option = layoutOptions.find((entry) => entry.value === "one-four-one");
    expect(option).toBeDefined();
    expect(getLayoutColumns("one-four-one")).toEqual(["left", "center", "right"]);
    expect(getLayoutGridTemplate("one-four-one")).toBe("1fr 4fr 1fr");
    // The vanilla builder and imported documents both spell it `1-4-1`.
    expect(normalizeLayout("1-4-1")).toBe("one-four-one");
  });

  /**
   * Past three columns the keys EXTEND left/center/right (col4…col6) rather
   * than renaming to col1…colN — renaming would orphan every stored
   * left/center/right cell record. A row narrowed from six columns to three
   * must keep its first three cells intact, key for key.
   */
  it("extends the persisted column keys past three columns", () => {
    expect(getLayoutColumns("four-column")).toEqual(["left", "center", "right", "col4"]);
    expect(getLayoutColumns("five-column")).toEqual(["left", "center", "right", "col4", "col5"]);
    expect(getLayoutColumns("six-column")).toEqual(["left", "center", "right", "col4", "col5", "col6"]);
  });

  it("hands out a fresh column array each call", () => {
    const first = getLayoutColumns("three-column");
    first.push("bogus");
    expect(getLayoutColumns("three-column")).toEqual(["left", "center", "right"]);
  });

  /**
   * The set tracks Divi's column structures (docs/SECTION_LAYOUTS.md). These
   * are the ratios, spelled out, so a typo in LAYOUT_SPECS — `2fr 3fr` where
   * `3fr 2fr` was meant — fails here instead of shipping a mirrored row.
   */
  it("sizes every layout to the fractions its label claims", () => {
    const expected: Record<string, string> = {
      single: "1fr",
      "two-column": "1fr 1fr",
      "two-four": "2fr 4fr",
      "four-two": "4fr 2fr",
      "one-three": "1fr 3fr",
      "three-one": "3fr 1fr",
      "two-three": "2fr 3fr",
      "three-two": "3fr 2fr",
      "one-five": "1fr 5fr",
      "five-one": "5fr 1fr",
      "three-column": "1fr 1fr 1fr",
      "one-two-one": "1fr 2fr 1fr",
      "one-three-one": "1fr 3fr 1fr",
      "one-four-one": "1fr 4fr 1fr",
      "two-one-one": "2fr 1fr 1fr",
      "one-one-two": "1fr 1fr 2fr",
      "three-one-one": "3fr 1fr 1fr",
      "one-one-three": "1fr 1fr 3fr",
      "four-column": "1fr 1fr 1fr 1fr",
      "five-column": "1fr 1fr 1fr 1fr 1fr",
      "six-column": "1fr 1fr 1fr 1fr 1fr 1fr"
    };

    // Both directions: every layout is checked, and nothing is offered that
    // this list has not thought about.
    expect(layoutOptions.map((option) => option.value).sort()).toEqual(Object.keys(expected).sort());

    for (const [value, grid] of Object.entries(expected)) {
      expect(getLayoutGridTemplate(value as never), value).toBe(grid);
    }
  });

  it("labels each layout distinctly", () => {
    const labels = layoutOptions.map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
