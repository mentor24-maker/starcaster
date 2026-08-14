import { describe, expect, it } from "vitest";
import {
  buildNumberSelectOptions,
  normalizeNumberSelectValue,
  resolveNumberSelectOptions
} from "./builder-inline-number-select";

describe("buildNumberSelectOptions", () => {
  it("counts in steps", () => {
    expect(buildNumberSelectOptions(0, 20, 5)).toEqual(["0", "5", "10", "15", "20"]);
  });

  it("shrinks a wide range to something scrollable", () => {
    // The Site Search Field Width dropdown, before and after.
    expect(buildNumberSelectOptions(0, 1200, 1)).toHaveLength(1201);
    expect(buildNumberSelectOptions(0, 1200, 5)).toHaveLength(241);
  });

  it("lands on multiples of the step, not on multiples offset by the floor", () => {
    // Feature Cards Icon Size: 16–160 in fives read 16, 21, 26, 31 …
    // (operator, 2026-08-12: "a bunch of odd options").
    const options = buildNumberSelectOptions(16, 160, 5);

    expect(options.slice(0, 3)).toEqual(["20", "25", "30"]);
    expect(options.every((option) => Number(option) % 5 === 0)).toBe(true);
  });

  it("leaves a step of one alone — every integer is already round", () => {
    expect(buildNumberSelectOptions(3, 7)).toEqual(["3", "4", "5", "6", "7"]);
  });

  it("leaves a fractional step alone rather than dividing into rounding dust", () => {
    // Tractor Nav speed counts in tenths from 1.
    expect(buildNumberSelectOptions(1, 1.4, 0.1)[0]).toBe("1");
  });

  it("still offers the floor when no aligned value fits the range", () => {
    expect(buildNumberSelectOptions(21, 24, 5)).toEqual(["21"]);
  });
});

describe("resolveNumberSelectOptions", () => {
  it("selects a value that sits on the grid, adding nothing", () => {
    const { options, selected } = resolveNumberSelectOptions("400", "0", 0, 1200, 5);
    expect(selected).toBe("400");
    expect(options).toHaveLength(241);
  });

  it("moves an off-grid saved value to the next option DOWN", () => {
    // A width saved at 403 before the control counted in fives (operator,
    // 2026-08-12: "change it to the next lowest number that is").
    const { options, selected, off } = resolveNumberSelectOptions("403", "0", 0, 1200, 5);
    expect(selected).toBe("400");
    expect(options).not.toContain("403");
    expect(options).toHaveLength(241);
    // `off` is how the control knows to write 400 back, so the document
    // stops disagreeing with the panel.
    expect(off).toBe(true);
  });

  it("takes the lowest option when the value sits below the whole list", () => {
    // Icon Size at 16, on a list that now starts at 20. There is nothing
    // below to fall to, and 15 is under the floor the renderer clamps to.
    expect(resolveNumberSelectOptions("16", "48", 16, 160, 5).selected).toBe("20");
  });

  it("asks for no write when the value is empty — empty is not a number", () => {
    // A blank size means "use the default" on a lot of these settings.
    // Writing the fallback into it would invent a choice nobody made.
    expect(resolveNumberSelectOptions("", "120", 60, 240, 5).off).toBe(false);
    expect(resolveNumberSelectOptions(undefined, "120", 60, 240, 5).off).toBe(false);
  });

  it("asks for no write when the value already sits on the grid", () => {
    expect(resolveNumberSelectOptions("400", "0", 0, 1200, 5).off).toBe(false);
  });

  it("clamps an out-of-range value into the range", () => {
    expect(resolveNumberSelectOptions("9999", "0", 0, 1200, 5).selected).toBe("1200");
    expect(resolveNumberSelectOptions("-40", "0", 0, 1200, 5).selected).toBe("0");
  });

  it("falls back when the value is not a number at all", () => {
    expect(resolveNumberSelectOptions("", "120", 60, 240, 5).selected).toBe("120");
    expect(resolveNumberSelectOptions(undefined, "120", 60, 240, 5).selected).toBe("120");
    expect(resolveNumberSelectOptions("wide", "120", 60, 240, 5).selected).toBe("120");
  });

  it("snaps down on the controls that step by more than five too", () => {
    // navMegaWidth counts in 40s; a stored 700 is not on that grid. Rounding
    // would have shown 720 — a size the operator never picked and larger
    // than what the page is doing.
    const { options, selected } = resolveNumberSelectOptions("700", "320", 320, 1600, 40);
    expect(selected).toBe("680");
    expect(options).not.toContain("700");
  });

  it("still snaps through normalizeNumberSelectValue, which callers rely on", () => {
    // The snapping helper is unchanged — only the DISPLAY stopped using it.
    expect(normalizeNumberSelectValue("403", "0", 0, 1200, 5)).toBe("405");
  });
});
