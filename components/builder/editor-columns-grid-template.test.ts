import { describe, expect, it } from "vitest";

import { getLayoutGridTemplate } from "@/lib/builder-template";

import { layoutOptions } from "./builder-types";
import { getEditorColumnsGridTemplate } from "./builder-utils";

/**
 * Task 86bcgjy02: a bare `1fr` track is never narrower than its widest
 * content, so in the page editor one wide control in a cell pushed the cell
 * past the row card and Save Cell, Saved Modules and the module buttons were
 * clipped. Every track the editor sets inline must be `minmax(0, …)`, with
 * the preset's proportions untouched.
 */
describe("getEditorColumnsGridTemplate", () => {
  it("wraps every track of every layout in minmax(0, …)", () => {
    for (const option of layoutOptions) {
      const tracks = getEditorColumnsGridTemplate(option.value).split(/\s*(?=minmax)/).filter(Boolean);
      expect(tracks.length, option.value).toBe(getLayoutGridTemplate(option.value).split(/\s+/).length);
      for (const track of tracks) {
        expect(track.trim(), option.value).toMatch(/^minmax\(0, \d+fr\)$/);
      }
    }
  });

  it("keeps the preset's proportions", () => {
    expect(getEditorColumnsGridTemplate("two-column")).toBe("minmax(0, 1fr) minmax(0, 1fr)");
    expect(getEditorColumnsGridTemplate("four-two")).toBe("minmax(0, 4fr) minmax(0, 2fr)");
    expect(getEditorColumnsGridTemplate("single")).toBe("minmax(0, 1fr)");
  });
});
