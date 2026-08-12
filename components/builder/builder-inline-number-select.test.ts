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
});

describe("resolveNumberSelectOptions", () => {
  it("selects a value that sits on the grid, adding nothing", () => {
    const { options, selected } = resolveNumberSelectOptions("400", "0", 0, 1200, 5);
    expect(selected).toBe("400");
    expect(options).toHaveLength(241);
  });

  it("shows an off-grid saved value instead of quietly rounding it", () => {
    // A width saved at 403 before the control counted in fives. Snapping the
    // display to 405 would leave the panel disagreeing with the live page.
    const { options, selected } = resolveNumberSelectOptions("403", "0", 0, 1200, 5);
    expect(selected).toBe("403");
    expect(options).toContain("403");
    expect(options).toHaveLength(242);
  });

  it("keeps the injected value in numeric order, not string order", () => {
    const { options } = resolveNumberSelectOptions("403", "0", 0, 1200, 5);
    const at = options.indexOf("403");
    expect(options[at - 1]).toBe("400");
    expect(options[at + 1]).toBe("405");
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

  it("protects the controls that already stepped by more than one", () => {
    // navMegaWidth counts in 40s; a stored 700 is not on that grid and was
    // being shown as 720 before this existed.
    const { options, selected } = resolveNumberSelectOptions("700", "320", 320, 1600, 40);
    expect(selected).toBe("700");
    expect(options).toContain("700");
  });

  it("still snaps through normalizeNumberSelectValue, which callers rely on", () => {
    // The snapping helper is unchanged — only the DISPLAY stopped using it.
    expect(normalizeNumberSelectValue("403", "0", 0, 1200, 5)).toBe("405");
  });
});
