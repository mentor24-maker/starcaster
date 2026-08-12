import { describe, expect, it } from "vitest";
import { getSectionColumnPercent } from "./builder-utils";
import { sizesForWidthPercent } from "@/lib/image-renditions";
import type { BuilderTemplateSection } from "@/lib/builder-template";

/**
 * The Delray home page was paired into two-column rows and the download did not
 * budge: an image set to "100" is 100% of its COLUMN, but it was telling the
 * browser to expect the full page width. These tests pin the arithmetic that
 * closes that gap.
 */

const section = (extra: Partial<BuilderTemplateSection>) =>
  ({ id: "s", layout: "single", modules: [], ...extra }) as unknown as BuilderTemplateSection;

describe("column share of a row", () => {
  it("a single-column row is the whole width", () => {
    expect(getSectionColumnPercent(section({ layout: "single" }), "main")).toBe(100);
  });

  it("an even two-column row is half each", () => {
    const s = section({ layout: "two-column" });
    expect(getSectionColumnPercent(s, "left")).toBe(50);
    expect(getSectionColumnPercent(s, "right")).toBe(50);
  });

  it("an uneven preset splits by its own proportions", () => {
    // "two-four" is 2fr 4fr — a third and two thirds.
    const s = section({ layout: "two-four" });
    expect(getSectionColumnPercent(s, "left")).toBe(33);
    expect(getSectionColumnPercent(s, "right")).toBe(67);
  });

  it("three columns are a third each", () => {
    const s = section({ layout: "three-column" });
    expect(getSectionColumnPercent(s, "left")).toBe(33);
    expect(getSectionColumnPercent(s, "center")).toBe(33);
  });

  it("the operator's own column widths win over the preset", () => {
    const s = section({ layout: "two-column", columnWidths: { left: "70", right: "30" } });
    expect(getSectionColumnPercent(s, "left")).toBe(70);
    expect(getSectionColumnPercent(s, "right")).toBe(30);
  });

  it("a half-set of custom widths falls back to the preset rather than guessing", () => {
    const s = section({ layout: "two-column", columnWidths: { left: "70" } });
    expect(getSectionColumnPercent(s, "left")).toBe(50);
  });

  it("a column that is not in this layout does not shrink the image to nothing", () => {
    expect(getSectionColumnPercent(section({ layout: "single" }), "right")).toBe(100);
  });
});

describe("the slot an image actually occupies", () => {
  const slot = (moduleWidth: number, columnPercent: number) => (moduleWidth * columnPercent) / 100;

  it("full-width image in a two-column row asks for half the page", () => {
    // This is the Delray case: 25 images at "100" that became half-width.
    expect(sizesForWidthPercent(slot(100, 50))).toBe("(max-width: 1200px) 50vw, 600px");
  });

  it("full-width image in a single-column row is unchanged", () => {
    expect(sizesForWidthPercent(slot(100, 100))).toBe("(max-width: 1200px) 100vw, 1200px");
  });

  it("a half-width module inside a half-width column asks for a quarter", () => {
    expect(sizesForWidthPercent(slot(50, 50))).toBe("(max-width: 1200px) 25vw, 300px");
  });

  it("a third-width column lands on the 400px range", () => {
    expect(sizesForWidthPercent(slot(100, 33))).toBe("(max-width: 1200px) 33vw, 396px");
  });
});
