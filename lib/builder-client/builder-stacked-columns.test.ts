import { describe, expect, it } from "vitest";
import { lineIndexes, planStackedColumnLabels } from "./builder-stacked-columns";

describe("planStackedColumnLabels", () => {
  it("floors the wrapped column to the one above it (Messaging Topic List at 1440)", () => {
    // Content / Structure / Text on line one, Frame wrapped under Content.
    // Content's fields start at 232, Frame's at 175 — 57px apart.
    const plan = planStackedColumnLabels([
      { left: 93, top: 100, label: 139 },
      { left: 846, top: 100, label: 120 },
      { left: 1139, top: 100, label: 90 },
      { left: 93, top: 400, label: 82 }
    ]);
    expect(plan).toEqual([null, null, null, 139]);
  });

  it("floors the UPPER column when the wrapped one has the longer labels", () => {
    const plan = planStackedColumnLabels([
      { left: 93, top: 100, label: 82 },
      { left: 600, top: 100, label: 120 },
      { left: 93, top: 400, label: 139 }
    ]);
    expect(plan).toEqual([139, null, null]);
  });

  it("leaves a single line alone — side-by-side columns are separate lattices", () => {
    expect(
      planStackedColumnLabels([
        { left: 93, top: 100, label: 82 },
        { left: 600, top: 100, label: 139 },
        { left: 1000, top: 100.5, label: 60 }
      ])
    ).toEqual([null, null, null]);
  });

  it("leaves a wrapped column alone when nothing sits directly above it", () => {
    // space-between puts the second item of a two-item line flush RIGHT.
    expect(
      planStackedColumnLabels([
        { left: 93, top: 100, label: 139 },
        { left: 700, top: 100, label: 100 },
        { left: 93, top: 400, label: 139 },
        { left: 1200, top: 400, label: 50 }
      ])
    ).toEqual([null, null, null, null]);
  });

  it("treats a three-deep chain as ONE stack with one edge", () => {
    const plan = planStackedColumnLabels([
      { left: 93, top: 100, label: 100 },
      { left: 93, top: 300, label: 150 },
      { left: 93, top: 500, label: 80 }
    ]);
    expect(plan).toEqual([150, null, 150]);
  });

  it("lines up absolute field edges when the columns sit a pixel apart", () => {
    const plan = planStackedColumnLabels([
      { left: 93, top: 100, label: 139 },
      { left: 94.5, top: 400, label: 82 }
    ]);
    expect(plan).toEqual([null, 137.5]);
  });

  it("does not stamp a floor that would change nothing", () => {
    expect(
      planStackedColumnLabels([
        { left: 93, top: 100, label: 139 },
        { left: 93, top: 400, label: 139 }
      ])
    ).toEqual([null, null]);
  });
});

describe("lineIndexes", () => {
  it("groups by top edge with sub-pixel slack and numbers lines top-down", () => {
    expect(
      lineIndexes([
        { left: 0, top: 400, label: 0 },
        { left: 0, top: 100, label: 0 },
        { left: 0, top: 101.5, label: 0 },
        { left: 0, top: 700, label: 0 }
      ])
    ).toEqual([1, 0, 0, 2]);
  });
});
